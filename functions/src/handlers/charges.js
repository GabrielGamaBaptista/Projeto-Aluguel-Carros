const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const { createOrGetCustomer } = require('../asaas/customers');
const { createPayment } = require('../asaas/payments');

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

  // 2. Buscar os dados do locatario
  const tenantDoc = await admin.firestore().collection('users').doc(tenantId).get();
  if (!tenantDoc.exists) {
    throw new Error(`Dados do locatario ${tenantId} nao encontrados.`);
  }
  const tenantData = tenantDoc.data();

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

    for (const dueDate of datesToCreate) {
      // Fix 2b: idempotencia ignorando cobranças CANCELLED
      const existing = await db.collection('charges')
        .where('contractId', '==', contractId)
        .where('dueDate', '==', dueDate)
        .limit(1)
        .get();

      if (!existing.empty && existing.docs[0].data().status !== 'CANCELLED') continue;

      try {
        await _createChargeInternal({
          contractId,
          carId,
          tenantId,
          landlordId,
          amount: rentAmount,
          billingType: billingType || 'BOLETO',
          dueDate,
          description: `Aluguel de veiculo - Contrato ${contractId}`,
          carInfo: carInfo || null,
        });
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

    try {
      await _createChargeInternal({
        contractId,
        carId,
        tenantId,
        landlordId,
        amount: rentAmount,
        billingType: billingType || 'BOLETO',
        dueDate: afterDate,
        description: `Aluguel de veiculo - Contrato ${contractId}`,
        carInfo: carInfo || null,
      });

      const nextDateStr = calcNextDueDate(afterDate, 'BIWEEKLY', null);
      await db.collection('rentalContracts').doc(contractId).update({
        nextDueDate: nextDateStr,
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

    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const lastDayOfMonthStr = lastDayOfMonth.toISOString().split('T')[0];

    const sixteenDaysFromNow = new Date(now);
    sixteenDaysFromNow.setDate(now.getDate() + 16);
    const sixteenDaysStr = sixteenDaysFromNow.toISOString().split('T')[0];

    const fiveDaysFromNow = new Date(now);
    fiveDaysFromNow.setDate(now.getDate() + 5);
    const fiveDaysStr = fiveDaysFromNow.toISOString().split('T')[0];

    // Buscar TODOS os contratos ativos — filtramos por frequencia client-side
    const activeContracts = await db.collection('rentalContracts')
      .where('active', '==', true)
      .get();

    console.log(`Verificando ${activeContracts.size} contratos ativos para recorrencia.`);

    const promises = [];
    let processedCount = 0;
    let errorCount = 0;

    activeContracts.forEach(doc => {
      const contract = doc.data();
      const contractId = doc.id;
      const { nextDueDate, frequency, dayOfMonth } = contract;

      const processContract = async () => {
        try {
          if (frequency === 'WEEKLY') {
            // Semanal: processar se nextDueDate <= ultimo dia do mes atual
            if (nextDueDate <= lastDayOfMonthStr) {
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
      };

      promises.push(processContract());
    });

    await Promise.all(promises);
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
