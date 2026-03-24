const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { checkRateLimit } = require('../utils/rateLimiter');

/**
 * Cloud Function Callable para aceitar uma solicitacao de vínculo e atribuir
 * o locatario ao carro de forma atomica e segura (Q1.4).
 *
 * Elimina a vulnerabilidade de self-assignment client-side — o Caso 3 das
 * Firestore rules foi removido apos esta funcao entrar em producao.
 */
exports.assignTenant = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }
  await checkRateLimit(request.auth.uid, 'assignTenantCF', 10, 60000);

  const { requestId } = request.data;
  if (!requestId) {
    throw new HttpsError('invalid-argument', 'requestId e obrigatorio.');
  }

  const db = admin.firestore();
  const uid = request.auth.uid;

  // Pre-check: tenant nao pode ter outro carro (query nao suportada dentro de transacao)
  const existingCars = await db.collection('cars')
    .where('tenantId', '==', uid)
    .limit(1)
    .get();

  if (!existingCars.empty) {
    const car = existingCars.docs[0].data();
    throw new HttpsError(
      'failed-precondition',
      `Voce ja esta atribuido ao carro ${car.brand} ${car.model} (${car.plate}). Cada locatario so pode ter um carro.`
    );
  }

  // Transacao atomica: validar request + carro + atribuir
  let transactionResult;
  try {
    transactionResult = await db.runTransaction(async (tx) => {
      const requestRef = db.collection('tenantRequests').doc(requestId);
      const requestDoc = await tx.get(requestRef);

      if (!requestDoc.exists) {
        throw new HttpsError('not-found', 'Solicitacao nao encontrada.');
      }

      const requestData = requestDoc.data();

      // Validar que o caller e o locatario alvo
      if (requestData.tenantId !== uid) {
        throw new HttpsError('permission-denied', 'Apenas o locatario alvo pode aceitar esta solicitacao.');
      }

      // Validar que a solicitacao ainda esta pendente
      if (requestData.status !== 'pending') {
        throw new HttpsError('failed-precondition', 'Solicitacao ja foi respondida.');
      }

      const carRef = db.collection('cars').doc(requestData.carId);
      const carDoc = await tx.get(carRef);

      if (!carDoc.exists) {
        throw new HttpsError('not-found', 'Carro nao encontrado.');
      }

      const carData = carDoc.data();

      // Validar que o carro ainda esta disponivel (race condition guard)
      if (carData.tenantId) {
        throw new HttpsError('failed-precondition', 'Este carro ja possui um locatario atribuido.');
      }

      // Aceitar a solicitacao
      tx.update(requestRef, {
        status: 'accepted',
        respondedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Atribuir locatario ao carro
      tx.update(carRef, {
        tenantId: uid,
        status: 'rented',
        rentedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        carId: requestData.carId,
        landlordId: requestData.landlordId,
        carInfo: requestData.carInfo,
      };
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('Erro na transacao de assignTenant:', error);
    throw new HttpsError('internal', 'Erro interno. Tente novamente.');
  }

  // Post-transacao: cancelar outros requests pendentes para o mesmo carro (nao-critico)
  try {
    const otherPending = await db.collection('tenantRequests')
      .where('carId', '==', transactionResult.carId)
      .where('status', '==', 'pending')
      .get();

    if (!otherPending.empty) {
      const batch = db.batch();
      otherPending.docs.forEach(doc => {
        batch.update(doc.ref, {
          status: 'cancelled',
          respondedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
    }
  } catch (cancelErr) {
    console.warn('Nao foi possivel cancelar outros requests pendentes:', cancelErr.message);
  }

  // Post-transacao: notificar locador (nao-critico)
  try {
    await db.collection('notifications').add({
      userId: transactionResult.landlordId,
      title: 'Solicitacao Aceita',
      body: `O locatario aceitou a atribuicao do carro ${transactionResult.carInfo}.`,
      data: { type: 'request_accepted', carId: transactionResult.carId },
      read: false,
      sent: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (notifErr) {
    console.error('Erro ao criar notificacao de aceite:', notifErr.message);
  }

  return { success: true };
});
