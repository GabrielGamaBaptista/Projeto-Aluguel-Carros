const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { generateBatchCharges, _createChargeInternal, calcNextDueDate } = require('./charges');
const { createSubaccountClient, ASAAS_PLATFORM_WALLET_ID } = require('../asaas/client');
const { checkRateLimit } = require('../utils/rateLimiter');

/**
 * Cancela atomicamente um contrato ativo e todas as cobranças PENDING/OVERDUE.
 * Se alguma cobrança falhar no Asaas, o contrato NÃO é marcado como inativo.
 */
exports.cancelContract = onCall({ cors: true, invoker: 'public', secrets: [ASAAS_PLATFORM_WALLET_ID] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }
  await checkRateLimit(request.auth.uid, 'cancelContract', 10, 60000);

  const { contractId, carId } = request.data;

  if (!contractId && !carId) {
    throw new HttpsError('invalid-argument', 'contractId ou carId e obrigatorio.');
  }

  const db = admin.firestore();

  try {
    // 1. Localizar o contrato ativo
    let contractDoc;
    let resolvedContractId;

    if (contractId) {
      contractDoc = await db.collection('rentalContracts').doc(contractId).get();
      if (!contractDoc.exists) {
        throw new HttpsError('not-found', 'Contrato nao encontrado.');
      }
      resolvedContractId = contractId;
    } else {
      const snap = await db.collection('rentalContracts')
        .where('carId', '==', carId)
        .where('active', '==', true)
        .limit(1)
        .get();
      if (snap.empty) {
        // Nao ha contrato ativo — nao e erro, apenas nao havia nada para cancelar
        return { success: true, cancelled: false };
      }
      contractDoc = snap.docs[0];
      resolvedContractId = contractDoc.id;
    }

    const contractData = contractDoc.data();

    if (request.auth.uid !== contractData.landlordId) {
      throw new HttpsError('permission-denied', 'Apenas o locador pode cancelar este contrato.');
    }

    if (!contractData.active) {
      return { success: true, cancelled: false };
    }

    // 2. Buscar conta Asaas do locador
    const landlordAccountDoc = await db.collection('asaasAccounts').doc(contractData.landlordId).get();
    if (!landlordAccountDoc.exists) {
      throw new HttpsError('not-found', 'Conta Asaas do locador nao encontrada.');
    }
    const { apiKey } = landlordAccountDoc.data();
    const asaasClient = createSubaccountClient(apiKey);

    // 3. Buscar cobranças canceláveis do contrato
    const chargesSnap = await db.collection('charges')
      .where('contractId', '==', resolvedContractId)
      .where('landlordId', '==', contractData.landlordId)
      .get();

    const cancelableCharges = chargesSnap.docs
      .filter(doc => ['PENDING', 'OVERDUE'].includes(doc.data().status))
      .map(doc => ({ id: doc.id, ...doc.data() }));

    // 4. Cancelar todas no Asaas com Promise.allSettled (tenta todas, registra falhas)
    const cancelResults = await Promise.allSettled(
      cancelableCharges.map(async (charge) => {
        if (!charge.asaasPaymentId) return { chargeId: charge.id, ok: true };
        try {
          await asaasClient.delete(`/payments/${charge.asaasPaymentId}`);
          return { chargeId: charge.id, ok: true };
        } catch (err) {
          if (err.response?.status === 404) {
            // Já deletado no Asaas — tudo certo
            return { chargeId: charge.id, ok: true };
          }
          return { chargeId: charge.id, ok: false, reason: err.response?.data || err.message };
        }
      })
    );

    // Separar sucessos de falhas
    const successfulIds = new Set(
      cancelResults
        .filter(r => r.status === 'fulfilled' && r.value.ok)
        .map(r => r.value.chargeId)
    );
    const failures = cancelResults
      .filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok))
      .map(r => r.status === 'rejected'
        ? { chargeId: undefined, reason: r.reason?.message }
        : { chargeId: r.value.chargeId, reason: r.value.reason }
      );

    // 5. Commitar no Firestore o que foi cancelado com sucesso no Asaas.
    // IMPORTANTE: dentro da transacao, verificar se a cobranca ainda e PENDING/OVERDUE antes de
    // marcar como CANCELLED, evitando sobrescrever status RECEIVED/CONFIRMED (race com webhook).
    const allCancelled = failures.length === 0;

    if (successfulIds.size > 0 || allCancelled) {
      const batch = db.batch();

      // Apenas marcar contrato inativo se todas as cobranças foram canceladas com sucesso
      if (allCancelled) {
        batch.update(db.collection('rentalContracts').doc(resolvedContractId), {
          active: false,
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Atualizar status das cobranças que foram canceladas no Asaas,
      // mas apenas se ainda estiverem em status cancelável (proteção contra race condition com webhook)
      const CANCELLABLE_STATUSES = ['PENDING', 'OVERDUE'];
      for (const charge of cancelableCharges) {
        if (!successfulIds.has(charge.id)) continue;
        // Re-ler status atual para evitar sobrescrever RECEIVED/CONFIRMED que chegou via webhook
        const freshDoc = await db.collection('charges').doc(charge.id).get();
        if (freshDoc.exists && CANCELLABLE_STATUSES.includes(freshDoc.data().status)) {
          batch.update(db.collection('charges').doc(charge.id), {
            status: 'CANCELLED',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }

      await batch.commit();
    }

    if (failures.length > 0) {
      console.error(`[cancelContract] ${failures.length} cobranças falharam ao cancelar no Asaas:`, failures);
      throw new HttpsError(
        'internal',
        `Nao foi possivel cancelar ${failures.length} cobranca(s) no Asaas. Contrato nao encerrado.`
      );
    }

    // 6. Notificar locatário
    try {
      await db.collection('notifications').add({
        userId: contractData.tenantId,
        title: `Contrato encerrado — ${contractData.carInfo || ''}`,
        body: `Seu contrato de aluguel do veiculo ${contractData.carInfo || ''} foi encerrado pelo locador.`,
        data: { type: 'contract_cancelled', contractId: resolvedContractId, carId: contractData.carId },
        read: false,
        sent: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (notifErr) {
      console.error('Erro ao criar notificacao de cancelamento de contrato:', notifErr.message);
    }

    return { success: true, cancelled: true, chargesCancelled: successfulIds.size };

  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('Erro ao cancelar contrato:', error);
    throw new HttpsError('internal', 'Erro interno ao cancelar contrato.');
  }
});

exports.createContract = onCall({ cors: true, invoker: 'public', secrets: [ASAAS_PLATFORM_WALLET_ID] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }
  await checkRateLimit(request.auth.uid, 'createContractCF', 10, 60000);

  const { carId, tenantId, landlordId, rentAmount, frequency, startDate, nextDueDate, dayOfMonth, billingType, carInfo, tenantName, landlordName } = request.data;

  if (request.auth.uid !== landlordId) {
    throw new HttpsError('permission-denied', 'Apenas o locador pode criar um contrato.');
  }

  if (!carId || !tenantId || !rentAmount || !frequency || !startDate || !nextDueDate) {
    throw new HttpsError('invalid-argument', 'Campos obrigatorios ausentes.');
  }

  const db = admin.firestore();

  try {
    const carDoc = await db.collection('cars').doc(carId).get();
    if (!carDoc.exists) {
      throw new HttpsError('not-found', 'Carro nao encontrado.');
    }
    const carDocData = carDoc.data();
    if (carDocData.landlordId !== landlordId) {
      throw new HttpsError('permission-denied', 'Este carro nao pertence ao locador informado.');
    }
    if (carDocData.tenantId !== tenantId) {
      throw new HttpsError('failed-precondition', 'O locatario informado nao esta atribuido a este carro.');
    }

    // Busca por 2 campos (sem indice composto) e filtra status client-side
    const requestsSnapshot = await db.collection('tenantRequests')
      .where('carId', '==', carId)
      .where('tenantId', '==', tenantId)
      .get();

    const hasAcceptedRequest = requestsSnapshot.docs.some(
      doc => doc.data().status === 'accepted'
    );
    if (!hasAcceptedRequest) {
      throw new HttpsError('failed-precondition', 'Nao existe solicitacao aceita entre este locatario e carro.');
    }

    const newContract = {
      carId,
      tenantId,
      landlordId,
      rentAmount: Number(rentAmount),
      frequency,
      billingType: billingType || 'PIX',
      startDate,
      nextDueDate,
      dayOfMonth: dayOfMonth || null,
      carInfo: carInfo || '',
      tenantName: tenantName || '',
      landlordName: landlordName || '',
      active: true,
      pausedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Fix 6: usar runTransaction para reduzir race condition de contrato duplicado
    let contractId;
    await db.runTransaction(async (transaction) => {
      const existingSnap = await transaction.get(
        db.collection('rentalContracts').where('carId', '==', carId).where('active', '==', true).limit(1)
      );
      if (!existingSnap.empty) {
        throw new HttpsError('already-exists', 'Ja existe um contrato ativo para este carro.');
      }
      const newRef = db.collection('rentalContracts').doc();
      contractId = newRef.id;
      transaction.set(newRef, newContract);
    });

    // Notificar locatario sobre novo contrato
    try {
      await db.collection('notifications').add({
        userId: tenantId,
        title: 'Novo contrato de aluguel',
        body: `${landlordName || 'Seu locador'} criou um contrato para o veiculo ${carInfo || ''}.`,
        data: { type: 'contract_created', contractId },
        read: false,
        sent: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (notifErr) {
      console.error('Erro ao criar notificacao de contrato:', notifErr.message);
    }

    // Gerar cobranças iniciais em lote logo após criar o contrato
    const today = new Date().toISOString().split('T')[0];

    if (frequency === 'WEEKLY' || frequency === 'BIWEEKLY') {
      // generateBatchCharges cria a 1a cobrança e todo o lote inicial
      try {
        await generateBatchCharges(contractId, newContract, nextDueDate, db);
      } catch (err) {
        console.error(`[createContract] Erro ao gerar cobranças iniciais para contrato ${contractId}:`, err);
        // Nao falha a criacao do contrato — cron vai tentar novamente
      }
    } else {
      // Mensal: criar a 1a cobrança imediatamente se startDate == hoje
      if (startDate === today) {
        try {
          await _createChargeInternal({
            contractId,
            carId,
            tenantId,
            landlordId,
            amount: Number(rentAmount),
            billingType: billingType || 'PIX',
            dueDate: startDate,
            description: `Aluguel de veiculo - Contrato ${contractId}`,
            carInfo: carInfo || null,
          });
          // Avançar nextDueDate apos criar a 1a cobranca
          const nextDateStr = calcNextDueDate(startDate, frequency, dayOfMonth || null);
          await db.collection('rentalContracts').doc(contractId).update({
            nextDueDate: nextDateStr,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (err) {
          console.error(`[createContract] Erro ao criar primeira cobranca mensal para contrato ${contractId}:`, err);
        }
      }
    }

    return { success: true, contractId };

  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('Erro ao criar contrato:', error);
    throw new HttpsError('internal', 'Erro interno ao criar contrato.');
  }
});

// ─── pauseContract ────────────────────────────────────────────────────────────
// Alterna entre pausado (pausedAt != null) e ativo (pausedAt = null).
// Contratos pausados sao ignorados pelo cron de cobranças recorrentes.
exports.pauseContract = onCall({ cors: true, invoker: 'public', secrets: [ASAAS_PLATFORM_WALLET_ID] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }
  await checkRateLimit(request.auth.uid, 'pauseContract', 10, 60000);

  const { contractId } = request.data;
  if (!contractId) {
    throw new HttpsError('invalid-argument', 'contractId e obrigatorio.');
  }

  const db = admin.firestore();

  try {
    const contractDoc = await db.collection('rentalContracts').doc(contractId).get();
    if (!contractDoc.exists) {
      throw new HttpsError('not-found', 'Contrato nao encontrado.');
    }

    const contract = contractDoc.data();

    if (request.auth.uid !== contract.landlordId) {
      throw new HttpsError('permission-denied', 'Apenas o locador pode pausar/retomar este contrato.');
    }
    if (!contract.active) {
      throw new HttpsError('failed-precondition', 'Nao e possivel pausar/retomar um contrato inativo.');
    }

    // Usar transacao para garantir atomicidade do toggle (evita race condition)
    let isPaused;
    await db.runTransaction(async (tx) => {
      const freshDoc = await tx.get(db.collection('rentalContracts').doc(contractId));
      if (!freshDoc.exists) throw new HttpsError('not-found', 'Contrato nao encontrado.');
      const freshData = freshDoc.data();
      if (!freshData.active) throw new HttpsError('failed-precondition', 'Contrato inativo.');
      isPaused = !!freshData.pausedAt;
      const updateData = isPaused
        ? { pausedAt: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() }
        : { pausedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      tx.update(db.collection('rentalContracts').doc(contractId), updateData);
    });

    // Notificar locatario sobre a mudanca de estado do contrato
    try {
      const action = isPaused ? 'retomado' : 'pausado';
      await db.collection('notifications').add({
        userId: contract.tenantId,
        title: `Contrato ${action} — ${contract.carInfo || ''}`,
        body: `Seu contrato de aluguel do veiculo ${contract.carInfo || ''} foi ${action} pelo locador.`,
        data: { type: isPaused ? 'contract_resumed' : 'contract_paused', contractId },
        read: false,
        sent: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (notifErr) {
      console.error('Erro ao criar notificacao de pausa/retomada de contrato:', notifErr.message);
    }

    return { success: true, paused: !isPaused };

  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('Erro ao pausar/retomar contrato:', error);
    throw new HttpsError('internal', 'Erro interno ao pausar/retomar contrato.');
  }
});

// ─── editContract ─────────────────────────────────────────────────────────────
// Editar contrato: apenas rentAmount permanente
exports.editContract = onCall({ cors: true, invoker: 'public', secrets: [ASAAS_PLATFORM_WALLET_ID] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }
  await checkRateLimit(request.auth.uid, 'editContract', 10, 60000);

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
