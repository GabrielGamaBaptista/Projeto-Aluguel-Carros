const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { createSubaccount } = require('../asaas/accounts');
const { createSubaccountClient, config } = require('../asaas/client');

/**
 * Cloud Function Callable para criar uma subconta no Asaas para o locador.
 * Salva a apiKey retornada no Firestore para uso posterior em cobranças.
 */
exports.createAsaasSubaccount = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'O usuário deve estar autenticado.');
  }

  const uid = request.auth.uid;

  try {
    // 2. Verificar se já existe uma conta Asaas para este usuário
    const accountDoc = await admin.firestore().collection('asaasAccounts').doc(uid).get();
    if (accountDoc.exists) {
      const accountData = accountDoc.data();
      return {
        success: true,
        accountId: accountData.asaasAccountId,
        walletId: accountData.walletId,
        status: accountData.status
      };
    }

    // 3. Trava atomica para evitar race condition (double-click / multiplas chamadas)
    const db = admin.firestore();
    const lockRef = db.collection('asaasAccounts').doc(uid);
    const lockSet = await db.runTransaction(async (tx) => {
      const doc = await tx.get(lockRef);
      if (doc.exists) return false; // ja existe, abortar criacao
      tx.set(lockRef, { isCreating: true, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });

    if (!lockSet) {
      // Outra chamada ja iniciou a criacao — verificar estado da trava
      const existing = await lockRef.get();
      const d = existing.data();

      if (d.isCreating !== true) {
        // Conta ja foi criada com sucesso em chamada anterior
        return { success: true, accountId: d.asaasAccountId, walletId: d.walletId, status: d.status };
      }

      // Trava ativa (isCreating === true): verificar TTL de 10 minutos
      const createdAtMs = d.createdAt ? d.createdAt.toMillis() : 0;
      const tenMinutesMs = 10 * 60 * 1000;
      const elapsed = Date.now() - createdAtMs;

      if (elapsed > tenMinutesMs) {
        // Trava expirada: limpar e pedir nova tentativa
        try {
          await lockRef.delete();
        } catch (deleteError) {
          console.error('Erro ao deletar trava expirada:', deleteError);
        }
        throw new HttpsError('internal', 'Tempo de criacao expirado. Tente novamente.');
      }

      // Trava recente: criacao em andamento por outra instancia
      throw new HttpsError('already-exists', 'Criacao de conta em andamento. Aguarde e tente novamente.');
    }

    // 4. Buscar dados do locador no Firestore (coleção users)
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      throw new HttpsError('not-found', 'Dados do locador não encontrados no Firestore.');
    }

    const userData = userDoc.data();

    // 4. Mapear dados para o formato do Asaas
    const isPf = !userData.personType || userData.personType === 'pf';
    const cpfCnpj = isPf ? (userData.cpf || '') : (userData.cnpj || '');

    if (!cpfCnpj) {
      console.error('cpfCnpj vazio para usuario', uid, '| personType:', userData.personType, '| cpf:', userData.cpf, '| cnpj:', userData.cnpj);
      const fieldName = isPf ? 'CPF' : 'CNPJ';
      throw new HttpsError(
        'failed-precondition',
        `${fieldName} nao encontrado no seu cadastro. Acesse seu Perfil, complete o campo ${fieldName} e tente novamente.`
      );
    }

    // Para PJ/MEI, usar razao social como nome da conta Asaas; fallback para nome pessoal
    const accountName = isPf ? userData.name : (userData.companyName || userData.name);

    const subaccountData = {
      name: accountName,
      email: userData.email,
      cpfCnpj,
      personType: userData.personType,
      mobilePhone: userData.phone,
      address: userData.street,
      addressNumber: userData.number,
      neighborhood: userData.neighborhood,
      postalCode: userData.cep,
      city: userData.city,
      state: userData.state,
      incomeValue: 10000,
      ...(isPf && userData.birthDate ? { birthDate: userData.birthDate } : {}),
    };

    const maskedCpfCnpj = cpfCnpj.length <= 4 ? '****' : cpfCnpj.slice(0, -4).replace(/./g, '*') + cpfCnpj.slice(-4);
    console.log('Criando subconta Asaas | uid:', uid, '| personType:', userData.personType, '| cpfCnpj:', maskedCpfCnpj, '| name:', accountName);

    // 5. Chamar o módulo Asaas para criar a subconta
    const result = await createSubaccount(subaccountData);

    // 6. Salvar os dados da subconta no Firestore (sobrescreve o doc de trava)
    // CRITICO: a apiKey deve ser salva agora, pois nao e possivel recupera-la depois.
    const asaasAccountInfo = {
      asaasAccountId: result.id,
      walletId: result.walletId,
      apiKey: result.apiKey,
      status: result.accountStatus || 'PENDING',
      isCreating: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await lockRef.set(asaasAccountInfo);

    // 7. Registrar webhook na subconta para receber eventos de pagamento
    if (config.webhook_url && config.webhook_token) {
      try {
        const subaccountClient = createSubaccountClient(result.apiKey);
        await subaccountClient.post('/webhooks', {
          name: 'AluguelCarrosApp Webhook',
          url: config.webhook_url,
          email: userData.email,
          enabled: true,
          interrupted: false,
          authToken: config.webhook_token,
          sendType: 'NON_SEQUENTIALLY',
          events: [
            'PAYMENT_RECEIVED',
            'PAYMENT_CONFIRMED',
            'PAYMENT_OVERDUE',
            'PAYMENT_DELETED',
            'PAYMENT_REFUNDED',
          ],
        });
        console.log('Webhook registrado com sucesso na subconta do locador', uid);
      } catch (webhookError) {
        // Nao falhar o onboarding por causa do webhook — logar e continuar
        console.error('Erro ao registrar webhook na subconta:', webhookError?.response?.data || webhookError.message);
      }
    }

    return {
      success: true,
      accountId: result.id,
      walletId: result.walletId
    };

  } catch (error) {
    // Re-lançar HttpsErrors diretamente sem tentar cleanup (ex: already-exists, internal do TTL)
    if (error instanceof HttpsError) throw error;

    // Apenas para erros reais (falha Asaas, rede, etc.) tenta limpar a trava
    try {
      const lockDoc = await admin.firestore().collection('asaasAccounts').doc(uid).get();
      if (lockDoc.exists && lockDoc.data().isCreating === true) {
        await admin.firestore().collection('asaasAccounts').doc(uid).delete();
      }
    } catch (cleanupError) {
      console.error('Erro ao remover trava de onboarding:', cleanupError);
    }
    console.error('Erro ao criar subconta para o usuario', uid, ':', error);
    throw new HttpsError('internal', 'Erro ao processar criacao de subconta.');
  }
});

// ─── checkOnboarding ──────────────────────────────────────────────────────────
// Verificar se locador ja tem subconta Asaas — lido server-side para nao expor apiKey ao cliente
exports.checkOnboarding = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }

  const uid = request.auth.uid;

  try {
    const doc = await admin.firestore().collection('asaasAccounts').doc(uid).get();
    if (!doc.exists) {
      return { exists: false };
    }
    if (doc.data().isCreating === true) {
      return { exists: false, creating: true };
    }
    const d = doc.data();
    return { exists: true, status: d.status, accountId: d.asaasAccountId, walletId: d.walletId };
  } catch (error) {
    console.error('Erro ao verificar onboarding:', error);
    throw new HttpsError('internal', 'Erro interno. Tente novamente mais tarde.');
  }
});
