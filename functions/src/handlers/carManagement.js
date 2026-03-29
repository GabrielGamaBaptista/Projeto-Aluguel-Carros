const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { createSubaccountClient } = require('../asaas/client');
const { checkRateLimit } = require('../utils/rateLimiter');

const BATCH_LIMIT = 490;

/**
 * Deleta referencias em chunks para respeitar o limite de 500 ops por batch do Firestore.
 */
async function deleteInChunks(db, refs) {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const chunk = refs.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    chunk.forEach(ref => batch.delete(ref));
    await batch.commit();
  }
}

/**
 * Cloud Function Callable para excluir um carro e todos os dados relacionados (Q2.3).
 *
 * Cascata completa:
 *   1. Cancela contrato ativo + cobranças PENDING/OVERDUE no Asaas
 *   2. Marca cobranças PENDING/OVERDUE como CANCELLED no Firestore
 *   3. Notifica locatario se havia vinculo ativo
 *   4. Deleta TODAS as tasks do carro (pending + completed)
 *   5. Deleta tenantRequests do carro
 *   6. Deleta mural_posts direcionados a este carro
 *   7. Deleta contratos inativos do carro
 *   8. Deleta o documento do carro
 *
 * Operacoes 4-7 sao best-effort (falha nao impede exclusao do carro).
 */
exports.deleteCarCF = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }
  await checkRateLimit(request.auth.uid, 'deleteCarCF', 5, 60000);

  const { carId } = request.data;
  if (!carId) {
    throw new HttpsError('invalid-argument', 'carId e obrigatorio.');
  }

  const db = admin.firestore();
  const uid = request.auth.uid;

  // 1. Verificar ownership do carro
  const carDoc = await db.collection('cars').doc(carId).get();
  if (!carDoc.exists) {
    throw new HttpsError('not-found', 'Carro nao encontrado.');
  }
  const carData = carDoc.data();
  if (carData.landlordId !== uid) {
    throw new HttpsError('permission-denied', 'Apenas o locador dono pode excluir este carro.');
  }

  const tenantId = carData.tenantId || null;
  const carInfo = `${carData.brand} ${carData.model} (${carData.plate})`;

  // 2. Cancelar contrato ativo + cobranças no Asaas (best-effort)
  try {
    // 2a. Marcar contrato ativo como inativo
    const contractSnap = await db.collection('rentalContracts')
      .where('carId', '==', carId)
      .where('active', '==', true)
      .limit(1)
      .get();

    if (!contractSnap.empty) {
      const contractRef = contractSnap.docs[0].ref;
      await contractRef.update({
        active: false,
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // 2b. Buscar TODAS as cobranças do carro e filtrar as cancelaveis
    // Usa o indice existente landlordId + carId (+ dueDate); filtra status in memory
    const allChargesSnap = await db.collection('charges')
      .where('landlordId', '==', uid)
      .where('carId', '==', carId)
      .get();

    const cancelableCharges = allChargesSnap.docs.filter(
      d => ['PENDING', 'OVERDUE'].includes(d.data().status)
    );

    if (cancelableCharges.length > 0) {
      // 2c. Cancelar no Asaas (best-effort — 404 = ja cancelado, ok)
      const accountDoc = await db.collection('asaasAccounts').doc(uid).get();
      if (accountDoc.exists) {
        const { apiKey } = accountDoc.data();
        const asaasClient = createSubaccountClient(apiKey);

        await Promise.allSettled(
          cancelableCharges.map(async (d) => {
            const pid = d.data().asaasPaymentId;
            if (!pid) return;
            try {
              await asaasClient.delete(`/payments/${pid}`);
            } catch (err) {
              if (err.response?.status !== 404) {
                console.warn(`[deleteCarCF] Falha ao cancelar cobranca ${pid} no Asaas:`, err.message);
              }
            }
          })
        );
      }

      // 2d. Atualizar cobranças no Firestore — re-ler para evitar sobrescrever RECEIVED/CONFIRMED
      const CANCELLABLE = ['PENDING', 'OVERDUE'];
      const chargeBatch = db.batch();
      for (const d of cancelableCharges) {
        const fresh = await db.collection('charges').doc(d.id).get();
        if (fresh.exists && CANCELLABLE.includes(fresh.data().status)) {
          chargeBatch.update(d.ref, {
            status: 'CANCELLED',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
      await chargeBatch.commit();
    }
  } catch (cancelErr) {
    console.warn('[deleteCarCF] Erro ao cancelar contrato/cobranças (continuando):', cancelErr.message);
  }

  // 3. Notificar locatario se havia vinculo ativo
  if (tenantId) {
    try {
      await db.collection('notifications').add({
        userId: tenantId,
        title: 'Veiculo removido',
        body: `O locador removeu o veiculo ${carInfo} do sistema.`,
        data: { type: 'car_deleted', carId },
        read: false,
        sent: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (notifErr) {
      console.warn('[deleteCarCF] Erro ao notificar locatario:', notifErr.message);
    }

    // Limpar currentLandlordId do locatario pois o vinculo foi encerrado (SEC-09)
    try {
      await db.collection('users').doc(tenantId).update({
        currentLandlordId: null,
      });
    } catch (linkErr) {
      console.warn('[deleteCarCF] Nao foi possivel limpar currentLandlordId:', linkErr.message);
    }
  }

  // 4. Deletar TODAS as tasks do carro (pending + completed)
  try {
    const tasksSnap = await db.collection('tasks').where('carId', '==', carId).get();
    await deleteInChunks(db, tasksSnap.docs.map(d => d.ref));
  } catch (err) {
    console.warn('[deleteCarCF] Erro ao deletar tasks:', err.message);
  }

  // 5. Deletar tenantRequests do carro
  try {
    const reqSnap = await db.collection('tenantRequests').where('carId', '==', carId).get();
    await deleteInChunks(db, reqSnap.docs.map(d => d.ref));
  } catch (err) {
    console.warn('[deleteCarCF] Erro ao deletar tenantRequests:', err.message);
  }

  // 6. Deletar mural_posts direcionados a este carro
  try {
    const muralSnap = await db.collection('mural_posts')
      .where('targetCarId', '==', carId)
      .get();
    await deleteInChunks(db, muralSnap.docs.map(d => d.ref));
  } catch (err) {
    console.warn('[deleteCarCF] Erro ao deletar mural posts:', err.message);
  }

  // 7. Deletar TODOS os contratos do carro (ativo ja foi marcado inativo no passo 2a)
  try {
    const contractsSnap = await db.collection('rentalContracts')
      .where('carId', '==', carId)
      .get();
    await deleteInChunks(db, contractsSnap.docs.map(d => d.ref));
  } catch (err) {
    console.warn('[deleteCarCF] Erro ao deletar contratos:', err.message);
  }

  // 8. Deletar despesas associadas ao carro
  try {
    const expensesSnap = await db.collection('expenses')
      .where('carId', '==', carId)
      .get();
    await deleteInChunks(db, expensesSnap.docs.map(d => d.ref));
  } catch (err) {
    console.warn('[deleteCarCF] Erro ao deletar despesas:', err.message);
  }

  // 10. Deletar o documento do carro
  await db.collection('cars').doc(carId).delete();

  return { success: true };
});
