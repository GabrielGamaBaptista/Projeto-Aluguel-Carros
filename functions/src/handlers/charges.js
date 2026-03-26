const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const { createOrGetCustomer } = require('../asaas/customers');
const { createPayment, getPixQrCode: asaasGetPixQrCode } = require('../asaas/payments');
const { createSubaccountClient } = require('../asaas/client');
const { checkRateLimit } = require('../utils/rateLimiter');

/**
 * Função interna para criação de cobrança no Asaas e no Firestore.
 * Pode ser chamada pela callable createCharge ou pela cron generateRecurringCharges.
 */
const _createChargeInternal = async (data) => {
  const { contractId, carId, tenantId, landlordId, amount, billingType, dueDate, description, carInfo } = data;

  // 1. Buscar a API Key do locador
  const landlordAccountDoc = await admin.firestore().collection('asaasAccounts').doc(landlordId).get();
  if (!landlordAccountDoc.exists) {
    throw new Error(`Configuracao do Asaas para o locador ${landlordId} nao encontrada.`);
  }
  const landlordApiKey = landlordAccountDoc.data().apiKey;

  // 2. Buscar os dados do locatario (doc publico + private/data para CPF/phone)
  const tenantDoc = await admin.firestore().collection('users').doc(tenantId).get();
  if (!tenantDoc.exists) {
    throw new Error(`Dados do locatario ${tenantId} nao encontrados.`);
  }
  const tenantPrivateDoc = await admin.firestore().collection('users').doc(tenantId)
    .collection('private').doc('data').get();
  const tenantPrivateData = tenantPrivateDoc.exists ? tenantPrivateDoc.data() : {};
  // Merge: private sobrescreve publico para campos PII (cpf, phone, etc.)
  const tenantData = { ...tenantDoc.data(), ...tenantPrivateData };

  // 3. Obter ou criar o customer na subconta do locador
  const asaasCustomerId = await createOrGetCustomer(landlordApiKey, {
    name: tenantData.name,
    email: tenantData.email,
    cpfCnpj: tenantData.cpf || tenantData.cnpj,
    mobilePhone: tenantData.phone
  });

  // 4. Gerar ID do documento antes de chamar o Asaas (para usar como externalReference)
  const chargeRef = admin.firestore().collection('charges').doc();
  const chargeId = chargeRef.id;

  // 5. Chamar o Asaas PRIMEIRO — so prosseguir se confirmado
  const asaasResult = await createPayment(landlordApiKey, {
    customer: asaasCustomerId,
    billingType,
    value: Number(amount),
    dueDate,
    description,
    externalReference: chargeId
  });

  // 6. Asaas confirmou — criar documento no Firestore com todos os dados de uma vez (sem zombie)
  const chargeDoc = {
    contractId,
    carId,
    landlordId,
    tenantId,
    amount: Number(amount),
    netAmount: null,
    platformFee: null,
    billingType,
    status: 'PENDING',
    asaasPaymentId: asaasResult.id,
    invoiceUrl: asaasResult.invoiceUrl || null,
    bankSlipUrl: asaasResult.bankSlipUrl || null,
    pixQrCodeUrl: null,
    pixCopiaECola: null,
    dueDate,
    paymentDate: null,
    description,
    carInfo: carInfo || null,
    processedEvents: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await chargeRef.set(chargeDoc);

  // Notificar locatario sobre nova cobranca (avulsa ou de contrato)
  try {
    const formattedAmount = Number(amount).toFixed(2).replace('.', ',');
    const [year, month, day] = dueDate.split('-');
    const dueDateBR = `${day}/${month}/${year}`;
    const notifTitle = contractId
      ? `Cobranca de aluguel — ${carInfo || ''}`
      : `Nova cobranca — ${carInfo || ''}`;
    const notifBody = contractId
      ? `Sua cobranca de aluguel de R$ ${formattedAmount} vence em ${dueDateBR}.`
      : `Voce recebeu uma cobranca de R$ ${formattedAmount} com vencimento em ${dueDateBR}.`;
    await admin.firestore().collection('notifications').add({
      userId: tenantId,
      title: notifTitle,
      body: notifBody,
      data: { type: 'charge_created', chargeId, contractId: contractId || null },
      read: false,
      sent: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (notifErr) {
    console.error('Erro ao criar notificacao de cobranca:', notifErr.message);
  }

  return {
    success: true,
    chargeId,
    invoiceUrl: asaasResult.invoiceUrl
  };
};

/**
 * Cloud Function Callable para criação manual de cobrança.
 */
exports.createCharge = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'O usuário deve estar autenticado.');
  }
  await checkRateLimit(request.auth.uid, 'createCharge', 30, 60000);

  const data = request.data;

  if (!data.landlordId) {
    throw new HttpsError('invalid-argument', 'landlordId e obrigatorio.');
  }
  if (request.auth.uid !== data.landlordId) {
    throw new HttpsError('permission-denied', 'Apenas o locador pode criar cobrancas.');
  }

  // Fix 1: validar que o carro pertence ao locador autenticado E que o locatário está vinculado
  if (data.carId) {
    const carDoc = await admin.firestore().collection('cars').doc(data.carId).get();
    if (!carDoc.exists) {
      throw new HttpsError('not-found', 'Carro nao encontrado.');
    }
    const carData = carDoc.data();
    // Verificar ownership do carro
    if (carData.landlordId !== data.landlordId) {
      throw new HttpsError('permission-denied', 'Este carro nao pertence ao locador informado.');
    }
    // Verificar vinculo do locatario (se fornecido)
    if (data.tenantId && carData.tenantId !== data.tenantId) {
      throw new HttpsError('failed-precondition', 'O locatario nao esta vinculado ao carro informado.');
    }
  }

  try {
    // Fix 2a: idempotencia ignorando cobranças CANCELLED
    if (data.contractId && data.dueDate) {
      const existing = await admin.firestore().collection('charges')
        .where('contractId', '==', data.contractId)
        .where('dueDate', '==', data.dueDate)
        .limit(1)
        .get();
      if (!existing.empty && existing.docs[0].data().status !== 'CANCELLED') {
        const existingDoc = existing.docs[0];
        return { success: true, chargeId: existingDoc.id, invoiceUrl: existingDoc.data().invoiceUrl || null, alreadyExists: true };
      }
    }

    const result = await _createChargeInternal(data);

    // Bug 1 fix: se contractId foi fornecido e dueDate === contract.nextDueDate, avanca nextDueDate
    if (data.contractId && data.dueDate) {
      try {
        const contractDoc = await admin.firestore().collection('rentalContracts').doc(data.contractId).get();
        if (contractDoc.exists) {
          const contractData = contractDoc.data();
          if (contractData.nextDueDate === data.dueDate) {
            const nextDateStr = calcNextDueDate(data.dueDate, contractData.frequency, contractData.dayOfMonth);
            await admin.firestore().collection('rentalContracts').doc(data.contractId).update({
              nextDueDate: nextDateStr,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        }
      } catch (err) {
        console.error('Erro ao avancar nextDueDate apos createCharge:', err);
      }
    }

    return result;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('Erro ao criar cobranca:', error);
    throw new HttpsError('internal', 'Erro interno. Tente novamente mais tarde.');
  }
});

/**
 * Calcula a proxima data de vencimento com base na frequencia e dia alvo.
 */
const calcNextDueDate = (currentDueDateStr, frequency, dayOfMonth) => {
  const currentDueDate = new Date(currentDueDateStr + 'T12:00:00');
  let nextDate;

  if (frequency === 'WEEKLY') {
    nextDate = new Date(currentDueDate);
    nextDate.setDate(currentDueDate.getDate() + 7);
  } else if (frequency === 'BIWEEKLY') {
    nextDate = new Date(currentDueDate);
    nextDate.setDate(currentDueDate.getDate() + 14);
  } else if (frequency === 'MONTHLY') {
    const targetDay = dayOfMonth || currentDueDate.getDate();
    const nextMonth = currentDueDate.getMonth() + 1;
    const nextYear = currentDueDate.getFullYear() + (nextMonth > 11 ? 1 : 0);
    const normalizedMonth = nextMonth % 12;
    const lastDayOfTargetMonth = new Date(nextYear, normalizedMonth + 1, 0).getDate();
    const safeDay = Math.min(targetDay, lastDayOfTargetMonth);
    nextDate = new Date(nextYear, normalizedMonth, safeDay, 12, 0, 0);
  } else {
    nextDate = new Date(currentDueDate);
    nextDate.setMonth(currentDueDate.getMonth() + 1);
  }

  return nextDate.toISOString().split('T')[0];
};

/**
 * Gera cobranças em lote para contratos semanais e quinzenais.
 * Mensal nao faz nada (cron cuida de 1 cobranca por vez).
 * @param {string} contractId
 * @param {object} contractData - dados do contrato
 * @param {string} afterDate - YYYY-MM-DD, data da proxima cobranca a criar (nextDueDate atual)
 * @param {object} db - admin.firestore() instance
 */
const generateBatchCharges = async (contractId, contractData, afterDate, db) => {
  const { frequency, dayOfMonth, billingType, carId, tenantId, landlordId, rentAmount, carInfo } = contractData;
  // Q5.9: override pontual de valor — aplicado na primeira cobranca do lote
  // Usar != null (nao ||) para suportar overrideAmount = 0 (cobranca gratuita)
  const overrideAmount = contractData.nextChargeOverride?.amount != null
    ? contractData.nextChargeOverride.amount
    : null;

  if (frequency === 'MONTHLY') return;

  const now = new Date();

  if (frequency === 'WEEKLY') {
    // Calcular todas as datas semanais de afterDate ate o ultimo dia do mes da afterDate
    // (nao de 'now', para cobrir casos onde afterDate e no proximo mes)
    const afterDateObj = new Date(afterDate + 'T12:00:00');
    const lastDayOfMonth = new Date(afterDateObj.getFullYear(), afterDateObj.getMonth() + 1, 0);
    lastDayOfMonth.setHours(23, 59, 59, 999);

    const datesToCreate = [];
    let currentDate = new Date(afterDate + 'T12:00:00');

    while (currentDate <= lastDayOfMonth) {
      datesToCreate.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 7);
    }

    if (datesToCreate.length === 0) return;

    // Fix 3: rastrear a primeira data que falhou para corrigir nextDueDate
    let firstFailedDate = null;
    // Q5.9: rastrear se o override foi consumido (aplica so na primeira cobranca)
    let overrideUsed = false;

    for (const dueDate of datesToCreate) {
      // Fix 2b: idempotencia ignorando cobranças CANCELLED
      const existing = await db.collection('charges')
        .where('contractId', '==', contractId)
        .where('dueDate', '==', dueDate)
        .limit(1)
        .get();

      if (!existing.empty && existing.docs[0].data().status !== 'CANCELLED') continue;

      // Q5.9: usar override apenas na primeira cobranca criada do lote
      const chargeAmount = (!overrideUsed && overrideAmount !== null) ? overrideAmount : rentAmount;

      try {
        await _createChargeInternal({
          contractId,
          carId,
          tenantId,
          landlordId,
          amount: chargeAmount,
          billingType: billingType || 'BOLETO',
          dueDate,
          description: `Aluguel de veiculo - Contrato ${contractId}`,
          carInfo: carInfo || null,
        });
        // Marcar override como consumido apos primeira criacao bem-sucedida
        if (!overrideUsed && overrideAmount !== null) overrideUsed = true;
      } catch (err) {
        console.error(`[generateBatchCharges] Erro ao criar cobranca semanal ${dueDate} para contrato ${contractId}:`, err);
        // Fix 3: registrar a primeira data que falhou
        if (!firstFailedDate) firstFailedDate = dueDate;
      }
    }

    // Fix 3: se houve falha, nextDueDate aponta para a primeira falha (cron retentara)
    // Se tudo ok, avanca para o primeiro dia do proximo lote mensal
    const lastDateInBatch = datesToCreate[datesToCreate.length - 1];
    const nextDueDateStr = firstFailedDate
      ? firstFailedDate
      : calcNextDueDate(lastDateInBatch, 'WEEKLY', null);

    await db.collection('rentalContracts').doc(contractId).update({
      nextDueDate: nextDueDateStr,
      // Q5.9: limpar override apos consumo
      ...(overrideUsed ? { nextChargeOverride: null } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

  } else if (frequency === 'BIWEEKLY') {
    const todayStr = now.toISOString().split('T')[0];

    // Verificar se ja existe 1 cobranca futura pendente alem de hoje
    const chargesSnap = await db.collection('charges')
      .where('contractId', '==', contractId)
      .where('landlordId', '==', landlordId)
      .get();

    const hasFuturePending = chargesSnap.docs.some(doc => {
      const d = doc.data();
      return d.status === 'PENDING' && d.dueDate > todayStr;
    });

    if (hasFuturePending) return;

    // Fix 2c: idempotencia ignorando cobranças CANCELLED
    const existing = await db.collection('charges')
      .where('contractId', '==', contractId)
      .where('dueDate', '==', afterDate)
      .limit(1)
      .get();

    if (!existing.empty && existing.docs[0].data().status !== 'CANCELLED') {
      // Ja existe (nao cancelada) — apenas avanca nextDueDate
      const nextDateStr = calcNextDueDate(afterDate, 'BIWEEKLY', null);
      await db.collection('rentalContracts').doc(contractId).update({
        nextDueDate: nextDateStr,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    // Q5.9: aplicar override se existir (cobranca unica quinzenal); suporta valor 0
    const chargeAmount = overrideAmount !== null ? overrideAmount : rentAmount;

    try {
      await _createChargeInternal({
        contractId,
        carId,
        tenantId,
        landlordId,
        amount: chargeAmount,
        billingType: billingType || 'BOLETO',
        dueDate: afterDate,
        description: `Aluguel de veiculo - Contrato ${contractId}`,
        carInfo: carInfo || null,
      });

      const nextDateStr = calcNextDueDate(afterDate, 'BIWEEKLY', null);
      await db.collection('rentalContracts').doc(contractId).update({
        nextDueDate: nextDateStr,
        // Q5.9: limpar override apos uso (cirurgico — so escreve se havia override)
        ...(overrideAmount !== null ? { nextChargeOverride: null } : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error(`[generateBatchCharges] Erro ao criar cobranca quinzenal ${afterDate} para contrato ${contractId}:`, err);
      // Nao avanca nextDueDate — cron retentara no proximo ciclo
    }
  }
};

/**
 * Scheduled Function (Cron) para geração automática de cobranças recorrentes.
 * Executa todos os dias às 08h00 no fuso horário de São Paulo.
 */
exports.generateRecurringCharges = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'America/Sao_Paulo' },
  async (event) => {
    const db = admin.firestore();
    const now = new Date();

    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(now.getDate() + 7);
    const sevenDaysStr = sevenDaysFromNow.toISOString().split('T')[0];

    const sixteenDaysFromNow = new Date(now);
    sixteenDaysFromNow.setDate(now.getDate() + 16);
    const sixteenDaysStr = sixteenDaysFromNow.toISOString().split('T')[0];

    const fiveDaysFromNow = new Date(now);
    fiveDaysFromNow.setDate(now.getDate() + 5);
    const fiveDaysStr = fiveDaysFromNow.toISOString().split('T')[0];

    // Buscar contratos ativos e nao pausados (Q5.12: pausedAt==null exclui pausados)
    const activeContracts = await db.collection('rentalContracts')
      .where('active', '==', true)
      .where('pausedAt', '==', null)
      .get();

    const contractDocs = activeContracts.docs;

    console.log(`Verificando ${contractDocs.length} contratos ativos para recorrencia.`);

    // Q2.7: processar contratos em batches de 5 para evitar rate limit no Asaas
    const BATCH_SIZE = 5;
    const BATCH_DELAY_MS = 1500;

    let processedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < contractDocs.length; i += BATCH_SIZE) {
      const batchDocs = contractDocs.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(batchDocs.map(async (doc) => {
        const contract = doc.data();
        const contractId = doc.id;
        const { nextDueDate, frequency, dayOfMonth } = contract;

        try {
          if (frequency === 'WEEKLY') {
            // Semanal: processar se nextDueDate <= hoje + 7 dias (antecedencia para boleto)
            if (nextDueDate <= sevenDaysStr) {
              await generateBatchCharges(contractId, contract, nextDueDate, db);
            }
          } else if (frequency === 'BIWEEKLY') {
            // Quinzenal: processar se nextDueDate <= hoje + 16 dias
            if (nextDueDate <= sixteenDaysStr) {
              await generateBatchCharges(contractId, contract, nextDueDate, db);
            }
          } else {
            // Mensal: logica original — processar se nextDueDate <= hoje + 5 dias
            if (nextDueDate > fiveDaysStr) return;

            // Fix 2d: idempotencia ignorando cobranças CANCELLED
            const existingChargeQuery = await db.collection('charges')
              .where('contractId', '==', contractId)
              .where('dueDate', '==', nextDueDate)
              .limit(1)
              .get();

            if (!existingChargeQuery.empty && existingChargeQuery.docs[0].data().status !== 'CANCELLED') {
              console.log(`Cobranca ja existe para contrato ${contractId} no vencimento ${nextDueDate}. Atualizando nextDueDate.`);
              const nextDateStr = calcNextDueDate(nextDueDate, frequency, dayOfMonth);
              await db.collection('rentalContracts').doc(contractId).update({
                nextDueDate: nextDateStr,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
              return;
            }

            // Usar override pontual se existir, senao usar o valor padrao do contrato
            const chargeAmount = contract.nextChargeOverride?.amount || contract.rentAmount;

            await _createChargeInternal({
              contractId,
              carId: contract.carId,
              tenantId: contract.tenantId,
              landlordId: contract.landlordId,
              amount: chargeAmount,
              billingType: contract.billingType || 'BOLETO',
              dueDate: nextDueDate,
              description: `Aluguel de veiculo - Contrato ${contractId}`,
              carInfo: contract.carInfo || null
            });

            const nextDateStr = calcNextDueDate(nextDueDate, frequency, dayOfMonth);

            await db.collection('rentalContracts').doc(contractId).update({
              nextDueDate: nextDateStr,
              nextChargeOverride: null,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log(`Contrato ${contractId} processado. Novo vencimento: ${nextDateStr}`);
          }
          processedCount++;
        } catch (err) {
          errorCount++;
          console.error(`Erro ao processar contrato recorrente ${contractId}:`, err);
          try {
            await db.collection('rentalContracts').doc(contractId).update({
              lastRecurringError: err.message || 'Erro desconhecido',
              lastRecurringErrorAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          } catch (updateErr) {
            console.error(`Erro ao registrar falha no contrato ${contractId}:`, updateErr);
          }
        }
      }));

      // Delay entre batches (exceto apos o ultimo)
      if (i + BATCH_SIZE < contractDocs.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    console.log(`[generateRecurringCharges] Concluido: ${processedCount} contratos processados, ${errorCount} com erro de ${activeContracts.size} ativos.`);

    // Notificar locatarios sobre cobranças próximas do vencimento (3 dias)
    try {
      const todayStr = now.toISOString().split('T')[0];
      const threeDaysFromNow = new Date(now);
      threeDaysFromNow.setDate(now.getDate() + 3);
      const threeDaysStr = threeDaysFromNow.toISOString().split('T')[0];

      const upcomingCharges = await db.collection('charges')
        .where('status', '==', 'PENDING')
        .where('dueDate', '==', threeDaysStr)
        .get();

      console.log(`Verificando ${upcomingCharges.size} cobrancas com vencimento em 3 dias.`);

      for (const doc of upcomingCharges.docs) {
        const chargeData = doc.data();
        // Idempotencia: pular se o aviso de 3 dias ja foi enviado
        if (chargeData.notificationFlags?.warning3Days) continue;
        const { tenantId, amount, dueDate, carInfo } = chargeData;
        if (!tenantId) continue;
        try {
          const formattedAmount = (amount || 0).toFixed(2).replace('.', ',');
          const [yr, mo, dy] = (dueDate || '').split('-');
          const dueDateBR = `${dy}/${mo}/${yr}`;
          await db.collection('notifications').add({
            userId: tenantId,
            title: `Cobranca vence em 3 dias — ${carInfo || ''}`,
            body: `Sua cobranca de R$ ${formattedAmount} vence em ${dueDateBR}. Efetue o pagamento para evitar atraso.`,
            data: { type: 'charge_due_soon', chargeId: doc.id },
            read: false,
            sent: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          // Marcar flag para nao re-enviar
          await doc.ref.update({
            'notificationFlags.warning3Days': true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (notifErr) {
          console.error(`Erro ao criar notificacao de vencimento proximo para cobranca ${doc.id}:`, notifErr.message);
        }
      }
    } catch (upcomingErr) {
      console.error('Erro ao verificar cobrancas proximas do vencimento:', upcomingErr.message);
    }

    return null;
  });

// Exports internos para uso em contracts.js
exports._createChargeInternal = _createChargeInternal;
exports.generateBatchCharges = generateBatchCharges;
exports.calcNextDueDate = calcNextDueDate;

// ─── cancelCharge ─────────────────────────────────────────────────────────────
// Cancelar cobrança — só permitido se status != RECEIVED e != CONFIRMED
exports.cancelCharge = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }
  await checkRateLimit(request.auth.uid, 'cancelCharge', 20, 60000);

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

// ─── editCharge ───────────────────────────────────────────────────────────────
exports.editCharge = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }
  await checkRateLimit(request.auth.uid, 'editCharge', 20, 60000);

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

// ─── getPixQrCode ─────────────────────────────────────────────────────────────
exports.getPixQrCode = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }
  await checkRateLimit(request.auth.uid, 'getPixQrCode', 30, 60000);

  const { chargeId } = request.data;
  if (!chargeId) {
    throw new HttpsError('invalid-argument', 'chargeId e obrigatorio.');
  }

  try {
    const db = admin.firestore();

    // 1. Buscar a cobrança para obter landlordId e asaasPaymentId
    const chargeDoc = await db.collection('charges').doc(chargeId).get();
    if (!chargeDoc.exists) {
      throw new HttpsError('not-found', 'Cobranca nao encontrada no Firestore.');
    }
    const { landlordId, tenantId, asaasPaymentId } = chargeDoc.data();

    if (request.auth.uid !== tenantId && request.auth.uid !== landlordId) {
      throw new HttpsError('permission-denied', 'Acesso negado a esta cobranca.');
    }

    // 2. Buscar a API Key do locador
    const landlordAccountDoc = await db.collection('asaasAccounts').doc(landlordId).get();
    if (!landlordAccountDoc.exists) {
      throw new HttpsError('not-found', 'Configuracao Asaas do locador nao encontrada.');
    }
    const landlordApiKey = landlordAccountDoc.data().apiKey;

    if (!asaasPaymentId) {
      throw new HttpsError('failed-precondition', 'Esta cobranca nao possui um ID de pagamento vinculado no Asaas.');
    }

    // 3. Chamar o módulo Asaas para buscar o QR Code
    const result = await asaasGetPixQrCode(landlordApiKey, asaasPaymentId);

    return {
      success: true,
      encodedImage: result.encodedImage,
      payload: result.payload,
      expirationDate: result.expirationDate,
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error(`Erro ao obter QR Code Pix para a cobranca ${chargeId}:`, error);
    throw new HttpsError('internal', 'Erro interno. Tente novamente mais tarde.');
  }
});
