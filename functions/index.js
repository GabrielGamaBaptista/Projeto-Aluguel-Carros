const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

// Inicializar admin SDK
admin.initializeApp();

// Importar handlers
const onboarding = require('./src/handlers/onboarding');
const charges = require('./src/handlers/charges');
const webhooks = require('./src/handlers/webhooks');
const { getPixQrCode: asaasGetPixQrCode, createPayment } = require('./src/asaas/payments');
const { createOrGetCustomer } = require('./src/asaas/customers');
const { config, createSubaccountClient } = require('./src/asaas/client');

/**
 * EXPORTS - Cloud Functions v2 API
 */

// Onboarding
exports.createAsaasSubaccount = onboarding.createAsaasSubaccount;

// Cobranças
exports.createCharge = charges.createCharge;
exports.generateRecurringCharges = charges.generateRecurringCharges;

// Cancelar cobrança — só permitido se status != RECEIVED e != CONFIRMED
exports.cancelCharge = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }

  const { chargeId } = request.data;
  if (!chargeId) {
    throw new HttpsError('invalid-argument', 'chargeId e obrigatorio.');
  }

  const db = admin.firestore();

  try {
    const chargeDoc = await db.collection('charges').doc(chargeId).get();
    if (!chargeDoc.exists) {
      throw new HttpsError('not-found', 'Cobranca nao encontrada.');
    }

    const { status, landlordId, asaasPaymentId } = chargeDoc.data();

    if (request.auth.uid !== landlordId) {
      throw new HttpsError('permission-denied', 'Apenas o locador pode cancelar esta cobranca.');
    }

    // Regra de negocio: nao pode cancelar se ja foi pago/confirmado
    if (status === 'RECEIVED' || status === 'CONFIRMED') {
      throw new HttpsError('failed-precondition', 'Nao e possivel cancelar uma cobranca ja paga ou confirmada.');
    }

    // Guard: cobranca pode nao ter asaasPaymentId se houve falha parcial na criacao
    if (asaasPaymentId) {
      // Buscar apiKey do locador
      const landlordDoc = await db.collection('asaasAccounts').doc(landlordId).get();
      if (!landlordDoc.exists) {
        throw new HttpsError('not-found', 'Conta Asaas do locador nao encontrada.');
      }
      const { apiKey } = landlordDoc.data();
      const asaasClient = createSubaccountClient(apiKey);

      // Cancelar no Asaas
      try {
        await asaasClient.delete(`/payments/${asaasPaymentId}`);
      } catch (asaasError) {
        const httpStatus = asaasError.response?.status;

        if (httpStatus === 404) {
          // Ja deletado no Asaas — seguimos para atualizar o Firestore
        } else {
          // Pode ser que o pagamento ja foi recebido no Asaas mas o webhook nao chegou ainda.
          // Busca o status real no Asaas para sincronizar o Firestore antes de responder.
          try {
            const paymentResp = await asaasClient.get(`/payments/${asaasPaymentId}`);
            const realStatus = paymentResp.data?.status;
            const PAID_STATUSES = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];

            if (realStatus && PAID_STATUSES.includes(realStatus)) {
              // Sincroniza Firestore com o status real (o webhook pode ter falhado)
              await db.collection('charges').doc(chargeId).update({
                status: realStatus === 'RECEIVED_IN_CASH' ? 'RECEIVED' : realStatus,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              throw new HttpsError(
                'failed-precondition',
                'Nao e possivel cancelar uma cobranca ja paga ou confirmada.'
              );
            }
          } catch (syncError) {
            if (syncError instanceof HttpsError) throw syncError;
            console.error('Erro ao buscar status real no Asaas:', syncError.message);
          }

          throw asaasError;
        }
      }
    }

    // Atualizar status no Firestore
    await db.collection('charges').doc(chargeId).update({
      status: 'CANCELLED',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Notificar locatario sobre cancelamento da cobranca
    try {
      const { tenantId, amount, dueDate, carInfo } = chargeDoc.data();
      if (tenantId && dueDate) {
        const formattedAmount = (amount || 0).toFixed(2).replace('.', ',');
        const [yr, mo, dy] = dueDate.split('-');
        const dueDateBR = `${dy}/${mo}/${yr}`;
        await db.collection('notifications').add({
          userId: tenantId,
          title: `Cobranca cancelada — ${carInfo || ''}`,
          body: `A cobranca de R$ ${formattedAmount} com vencimento em ${dueDateBR} foi cancelada pelo locador.`,
          data: { type: 'charge_cancelled', chargeId },
          read: false,
          sent: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch (notifErr) {
      console.error('Erro ao criar notificacao de cancelamento de cobranca:', notifErr.message);
    }

    return { success: true };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('Erro ao cancelar cobranca:', error);
    throw new HttpsError('internal', 'Erro interno. Tente novamente mais tarde.');
  }
});

exports.editCharge = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }

  const { chargeId, contractId, newAmount, newDueDate } = request.data;

  if (!chargeId && !contractId) {
    throw new HttpsError('invalid-argument', 'chargeId ou contractId e obrigatorio.');
  }
  // Pelo menos um campo de alteracao deve ser fornecido
  if (newAmount == null && !newDueDate) {
    throw new HttpsError('invalid-argument', 'Informe newAmount ou newDueDate para editar a cobranca.');
  }
  // Validar newAmount se fornecido
  let parsedAmount;
  if (newAmount != null) {
    parsedAmount = Number(newAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      throw new HttpsError('invalid-argument', 'newAmount deve ser um numero maior que zero.');
    }
  }
  // Validar newDueDate se fornecido: deve ser data futura no formato YYYY-MM-DD
  if (newDueDate) {
    const today = new Date().toISOString().split('T')[0];
    if (newDueDate < today) {
      throw new HttpsError('invalid-argument', 'A data de vencimento nao pode ser no passado.');
    }
  }

  const db = admin.firestore();

  try {
    let targetChargeId = chargeId;

    // Se contractId fornecido sem chargeId, buscar a cobrança PENDING mais proxima
    if (!chargeId && contractId) {
      const chargesSnap = await db.collection('charges')
        .where('contractId', '==', contractId)
        .where('landlordId', '==', request.auth.uid)
        .get();

      const pendingCharges = chargesSnap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(c => c.status === 'PENDING')
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

      if (pendingCharges.length === 0) {
        throw new HttpsError('not-found', 'Nenhuma cobranca PENDING encontrada para este contrato.');
      }
      targetChargeId = pendingCharges[0].id;
    }

    const chargeDoc = await db.collection('charges').doc(targetChargeId).get();
    if (!chargeDoc.exists) {
      throw new HttpsError('not-found', 'Cobranca nao encontrada.');
    }

    const chargeData = chargeDoc.data();
    const { status, landlordId, asaasPaymentId, dueDate, billingType, description, tenantId } = chargeData;

    // Resolver valores efetivos: usar o novo se fornecido, senao manter o existente
    const effectiveAmount = parsedAmount ?? chargeData.amount;
    const effectiveDueDate = newDueDate || dueDate;

    if (request.auth.uid !== landlordId) {
      throw new HttpsError('permission-denied', 'Apenas o locador pode editar esta cobranca.');
    }

    if (status === 'RECEIVED' || status === 'CONFIRMED') {
      throw new HttpsError('failed-precondition', 'Nao e possivel editar uma cobranca ja paga ou confirmada.');
    }

    if (!asaasPaymentId) {
      throw new HttpsError('failed-precondition', 'Esta cobranca nao possui ID Asaas vinculado.');
    }

    const landlordDoc = await db.collection('asaasAccounts').doc(landlordId).get();
    if (!landlordDoc.exists) {
      throw new HttpsError('not-found', 'Conta Asaas do locador nao encontrada.');
    }
    const { apiKey } = landlordDoc.data();
    const asaasClient = createSubaccountClient(apiKey);

    // 1. Buscar/criar customer do locatario na subconta
    const tenantDoc = await db.collection('users').doc(tenantId).get();
    if (!tenantDoc.exists) {
      throw new HttpsError('not-found', 'Dados do locatario nao encontrados.');
    }
    const tenantData = tenantDoc.data();
    const asaasCustomerId = await createOrGetCustomer(apiKey, {
      name: tenantData.name,
      email: tenantData.email,
      cpfCnpj: tenantData.cpf || tenantData.cnpj,
      mobilePhone: tenantData.phone,
    });

    // 2. Criar nova cobrança no Asaas ANTES de cancelar a antiga (evita inconsistencia)
    const newAsaasResult = await createPayment(apiKey, {
      customer: asaasCustomerId,
      billingType: billingType || 'BOLETO',
      value: effectiveAmount,
      dueDate: effectiveDueDate,
      description: description || `Aluguel de veiculo`,
      externalReference: targetChargeId,
    });

    // 3. Atualizar Firestore com novo asaasPaymentId ANTES de deletar o antigo no Asaas.
    // Isso garante que quando o Asaas disparar o webhook PAYMENT_DELETED para a cobranca antiga,
    // o Firestore ja tenha o novo asaasPaymentId — permitindo que o webhook handler ignore o evento.
    await db.collection('charges').doc(targetChargeId).update({
      amount: effectiveAmount,
      dueDate: effectiveDueDate,
      asaasPaymentId: newAsaasResult.id,
      invoiceUrl: newAsaasResult.invoiceUrl || null,
      bankSlipUrl: newAsaasResult.bankSlipUrl || null,
      pixQrCodeUrl: null,
      pixCopiaECola: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 4. Cancelar cobrança antiga no Asaas — somente apos Firestore ja ter o novo ID
    try {
      await asaasClient.delete(`/payments/${asaasPaymentId}`);
    } catch (asaasError) {
      if (asaasError.response?.status !== 404) {
        // Nova cobranca ja foi criada e Firestore ja foi atualizado — nao falha, mas loga
        console.error('Aviso: nao foi possivel cancelar cobranca antiga no Asaas:', asaasError.response?.data || asaasError.message);
      }
    }

    // Notificar locatario sobre alteracao na cobranca
    try {
      const formattedAmount = effectiveAmount.toFixed(2).replace('.', ',');
      const [yr, mo, dy] = (effectiveDueDate || '').split('-');
      const dueDateBR = `${dy}/${mo}/${yr}`;
      const changeDesc = [];
      if (parsedAmount != null) changeDesc.push(`valor para R$ ${formattedAmount}`);
      if (newDueDate) changeDesc.push(`vencimento para ${dueDateBR}`);
      const changeText = changeDesc.length > 0 ? changeDesc.join(' e ') : `valor para R$ ${formattedAmount}`;
      await admin.firestore().collection('notifications').add({
        userId: tenantId,
        title: `Cobranca atualizada — ${chargeData.carInfo || ''}`,
        body: `Sua cobranca teve o ${changeText} atualizado(s).`,
        data: { type: 'charge_edited', chargeId: targetChargeId },
        read: false,
        sent: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (notifErr) {
      console.error('Erro ao criar notificacao de edicao de cobranca:', notifErr.message);
    }

    return { success: true, chargeId: targetChargeId };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('Erro ao editar cobranca:', error.response?.data || error.message);
    throw new HttpsError('internal', 'Erro interno. Tente novamente mais tarde.');
  }
});

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

// Webhooks (HTTPS onRequest)
exports.asaasWebhook = webhooks.asaasWebhook;

/**
 * Cloud Function Callable para obter o QR Code Pix de uma cobrança.
 * Chama a API do Asaas na subconta do locador.
 */
exports.getPixQrCode = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  const { chargeId } = request.data;

  if (!chargeId) {
    throw new HttpsError('invalid-argument', 'chargeId é obrigatório.');
  }

  try {
    const db = admin.firestore();

    // 1. Buscar a cobrança para obter landlordId e asaasPaymentId
    const chargeDoc = await db.collection('charges').doc(chargeId).get();
    if (!chargeDoc.exists) {
      throw new HttpsError('not-found', 'Cobrança não encontrada no Firestore.');
    }
    const { landlordId, tenantId, asaasPaymentId } = chargeDoc.data();

    if (request.auth.uid !== tenantId && request.auth.uid !== landlordId) {
      throw new HttpsError('permission-denied', 'Acesso negado a esta cobranca.');
    }

    // 2. Buscar a API Key do locador
    const landlordAccountDoc = await db.collection('asaasAccounts').doc(landlordId).get();
    if (!landlordAccountDoc.exists) {
      throw new HttpsError('not-found', 'Configuração Asaas do locador não encontrada.');
    }
    const landlordApiKey = landlordAccountDoc.data().apiKey;

    if (!asaasPaymentId) {
      throw new HttpsError('failed-precondition', 'Esta cobrança não possui um ID de pagamento vinculado no Asaas.');
    }

    // 3. Chamar o módulo Asaas para buscar o QR Code
    const result = await asaasGetPixQrCode(landlordApiKey, asaasPaymentId);

    return {
      success: true,
      encodedImage: result.encodedImage,
      payload: result.payload,
      expirationDate: result.expirationDate
    };

  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error(`Erro ao obter QR Code Pix para a cobranca ${chargeId}:`, error);
    throw new HttpsError('internal', 'Erro interno. Tente novamente mais tarde.');
  }
});

const cloudinarySign = require('./src/handlers/cloudinarySign');
exports.getCloudinarySignature = cloudinarySign.getCloudinarySignature;

/**
 * Firestore trigger: envia push notification quando um documento e criado em notifications/{notifId}.
 */
exports.sendPushNotification = onDocumentCreated(
  { document: 'notifications/{notifId}', region: 'us-central1' },
  async (event) => {
    const data = event.data.data();
    const { userId, title, body, sent } = data;

    if (sent) return null; // ja enviado (idempotencia)

    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) return null;
    const { fcmToken } = userDoc.data();
    if (!fcmToken) {
      console.warn(`sendPushNotification: usuario ${userId} sem fcmToken. Notificacao "${title}" nao enviada.`);
      return null;
    }

    try {
      await admin.messaging().send({
        token: fcmToken,
        notification: { title, body },
        data: data.data
          ? Object.fromEntries(Object.entries(data.data).map(([k, v]) => [k, String(v)]))
          : {},
        android: {
          priority: 'high',
          notification: { channelId: 'tarefas' },
        },
      });
      await event.data.ref.update({ sent: true });
    } catch (err) {
      if (
        err.code === 'messaging/registration-token-not-registered' ||
        err.code === 'messaging/invalid-registration-token'
      ) {
        try {
          await admin.firestore().collection('users').doc(userId).update({ fcmToken: null });
        } catch (cleanupErr) {
          console.error('Erro ao limpar fcmToken invalido:', cleanupErr.message);
        }
      }
      console.error('Erro ao enviar push:', err.message);
    }
    return null;
  }
);

const contracts = require('./src/handlers/contracts');
exports.createContractCF = contracts.createContract;
exports.cancelContract = contracts.cancelContract;

const taskNotifications = require('./src/handlers/taskNotifications');
exports.notifyOverdueTasks = taskNotifications.notifyOverdueTasks;

// Editar contrato: apenas rentAmount permanente
exports.editContract = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }

  const { contractId, rentAmount } = request.data;

  if (!contractId) {
    throw new HttpsError('invalid-argument', 'contractId e obrigatorio.');
  }
  if (rentAmount == null) {
    throw new HttpsError('invalid-argument', 'rentAmount e obrigatorio.');
  }

  const parsed = Number(rentAmount);
  if (isNaN(parsed) || parsed <= 0) {
    throw new HttpsError('invalid-argument', 'rentAmount deve ser um numero maior que zero.');
  }

  const db = admin.firestore();

  try {
    const contractDoc = await db.collection('rentalContracts').doc(contractId).get();
    if (!contractDoc.exists) {
      throw new HttpsError('not-found', 'Contrato nao encontrado.');
    }

    const contract = contractDoc.data();

    if (request.auth.uid !== contract.landlordId) {
      throw new HttpsError('permission-denied', 'Apenas o locador pode editar este contrato.');
    }
    if (!contract.active) {
      throw new HttpsError('failed-precondition', 'Nao e possivel editar um contrato inativo.');
    }

    await db.collection('rentalContracts').doc(contractId).update({
      rentAmount: parsed,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Notificar locatario sobre alteracao no contrato
    try {
      const formattedAmount = parsed.toFixed(2).replace('.', ',');
      await db.collection('notifications').add({
        userId: contract.tenantId,
        title: `Contrato atualizado — ${contract.carInfo || ''}`,
        body: `O valor do aluguel do veiculo ${contract.carInfo || ''} foi alterado para R$ ${formattedAmount}.`,
        data: { type: 'contract_edited', contractId },
        read: false,
        sent: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (notifErr) {
      console.error('Erro ao criar notificacao de edicao de contrato:', notifErr.message);
    }

    return { success: true };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('Erro ao editar contrato:', error);
    throw new HttpsError('internal', 'Erro interno. Tente novamente mais tarde.');
  }
});
