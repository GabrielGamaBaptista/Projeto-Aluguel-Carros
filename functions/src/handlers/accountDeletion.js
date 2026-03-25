/**
 * accountDeletion.js — Cloud Function para exclusao de conta com cascade (Q5.4 / LGPD).
 *
 * Rate limit: 2 chamadas/min por usuario (operacao destrutiva).
 *
 * LOCADOR — cascata completa:
 *   1. Para cada carro com tenantId: cancela contrato/cobranças no Asaas + notifica locatario + libera carro
 *   2. Deleta todos os carros do locador
 *   3. Deleta tasks, tenantRequests, mural_posts, notifications, charges, rentalContracts onde landlordId == uid
 *   4. Deleta asaasAccounts/{uid} (registro Firestore — nao a subconta Asaas em si)
 *   5. Deleta users/{uid}/private/data e users/{uid}
 *   6. Deleta conta no Firebase Auth
 *
 * LOCATARIO — cascata controlada:
 *   1. Para cada carro vinculado: cancela contrato/cobranças no Asaas + notifica locador + libera carro
 *   2. Anonimiza charges onde tenantId == uid (locador precisa do historico financeiro)
 *   3. Deleta tasks, tenantRequests, notifications onde tenantId == uid
 *   4. Deleta users/{uid}/private/data e users/{uid}
 *   5. Deleta conta no Firebase Auth
 *
 * Operacoes de cascade sao best-effort: falha parcial nao impede exclusao da conta.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { createSubaccountClient } = require('../asaas/client');
const { checkRateLimit } = require('../utils/rateLimiter');

const BATCH_LIMIT = 490;

async function deleteInChunks(db, refs) {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const chunk = refs.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

/**
 * Cancela cobranças PENDING/OVERDUE de um carro no Asaas e no Firestore.
 * Usa best-effort: 404 = ja cancelado (ok). Outras falhas sao logadas mas ignoradas.
 */
async function cancelCarCharges(db, carId, landlordId, asaasClient) {
  const chargesSnap = await db.collection('charges')
    .where('carId', '==', carId)
    .where('landlordId', '==', landlordId)
    .get();

  const cancelable = chargesSnap.docs.filter((d) =>
    ['PENDING', 'OVERDUE'].includes(d.data().status)
  );

  if (cancelable.length === 0) return;

  // Cancelar no Asaas (best-effort)
  if (asaasClient) {
    await Promise.allSettled(
      cancelable.map(async (d) => {
        const pid = d.data().asaasPaymentId;
        if (!pid) return;
        try {
          await asaasClient.delete(`/payments/${pid}`);
        } catch (err) {
          if (err.response?.status !== 404) {
            console.warn(`[deleteAccountCF] Falha Asaas ao cancelar cobranca ${pid}:`, err.message);
          }
        }
      })
    );
  }

  // Atualizar status no Firestore
  const CANCELLABLE = ['PENDING', 'OVERDUE'];
  const batch = db.batch();
  for (const d of cancelable) {
    const fresh = await db.collection('charges').doc(d.id).get();
    if (fresh.exists && CANCELLABLE.includes(fresh.data().status)) {
      batch.update(d.ref, {
        status: 'CANCELLED',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
  await batch.commit();
}

/**
 * Cascade para exclusao de conta de LOCADOR.
 */
async function _deleteLandlord(db, uid) {
  // Obter apiKey do Asaas (pode nao existir se nunca fez onboarding)
  let asaasClient = null;
  try {
    const accountDoc = await db.collection('asaasAccounts').doc(uid).get();
    if (accountDoc.exists) {
      asaasClient = createSubaccountClient(accountDoc.data().apiKey);
    }
  } catch (e) {
    console.warn('[deleteAccountCF] Erro ao obter conta Asaas do locador:', e.message);
  }

  // 1. Processar cada carro do locador
  const carsSnap = await db.collection('cars').where('landlordId', '==', uid).get();

  await Promise.allSettled(
    carsSnap.docs.map(async (carDoc) => {
      const carData = carDoc.data();
      const carId = carDoc.id;
      const tenantId = carData.tenantId;
      const carInfo = `${carData.brand} ${carData.model} (${carData.plate})`;

      try {
        // 1a. Cancelar contrato ativo no Firestore
        const contractSnap = await db.collection('rentalContracts')
          .where('carId', '==', carId)
          .where('active', '==', true)
          .limit(1)
          .get();
        if (!contractSnap.empty) {
          await contractSnap.docs[0].ref.update({
            active: false,
            cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        // 1b. Cancelar cobranças PENDING/OVERDUE no Asaas e Firestore
        await cancelCarCharges(db, carId, uid, asaasClient);

        // 1c. Liberar carro (nao sera deletado aqui — sera deletado em massa no passo 2)
        // Apenas notificar locatario se havia vinculo
        if (tenantId) {
          try {
            await db.collection('notifications').add({
              userId: tenantId,
              title: 'Conta do locador encerrada',
              body: `O locador encerrou a conta. Seu vinculo com o veiculo ${carInfo} foi desfeito.`,
              data: { type: 'account_deleted', carId },
              read: false,
              sent: false,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          } catch (notifErr) {
            console.warn('[deleteAccountCF] Erro ao notificar locatario:', notifErr.message);
          }
        }
      } catch (carErr) {
        console.warn(`[deleteAccountCF] Erro ao processar carro ${carId}:`, carErr.message);
      }
    })
  );

  // 2. Deletar todos os carros do locador
  try {
    await deleteInChunks(db, carsSnap.docs.map((d) => d.ref));
  } catch (e) { console.warn('[deleteAccountCF] Erro ao deletar carros:', e.message); }

  // 3. Deletar tasks onde landlordId == uid
  try {
    const tasksSnap = await db.collection('tasks').where('landlordId', '==', uid).get();
    await deleteInChunks(db, tasksSnap.docs.map((d) => d.ref));
  } catch (e) { console.warn('[deleteAccountCF] Erro ao deletar tasks:', e.message); }

  // 4. Deletar tenantRequests onde landlordId == uid
  try {
    const reqSnap = await db.collection('tenantRequests').where('landlordId', '==', uid).get();
    await deleteInChunks(db, reqSnap.docs.map((d) => d.ref));
  } catch (e) { console.warn('[deleteAccountCF] Erro ao deletar tenantRequests:', e.message); }

  // 5. Deletar mural_posts onde landlordId == uid
  try {
    const muralSnap = await db.collection('mural_posts').where('landlordId', '==', uid).get();
    await deleteInChunks(db, muralSnap.docs.map((d) => d.ref));
  } catch (e) { console.warn('[deleteAccountCF] Erro ao deletar mural_posts:', e.message); }

  // 6. Deletar notifications onde userId == uid
  try {
    const notifSnap = await db.collection('notifications').where('userId', '==', uid).get();
    await deleteInChunks(db, notifSnap.docs.map((d) => d.ref));
  } catch (e) { console.warn('[deleteAccountCF] Erro ao deletar notifications:', e.message); }

  // 7. Deletar charges onde landlordId == uid
  try {
    const chargesSnap = await db.collection('charges').where('landlordId', '==', uid).get();
    await deleteInChunks(db, chargesSnap.docs.map((d) => d.ref));
  } catch (e) { console.warn('[deleteAccountCF] Erro ao deletar charges:', e.message); }

  // 8. Deletar rentalContracts onde landlordId == uid
  try {
    const contractsSnap = await db.collection('rentalContracts').where('landlordId', '==', uid).get();
    await deleteInChunks(db, contractsSnap.docs.map((d) => d.ref));
  } catch (e) { console.warn('[deleteAccountCF] Erro ao deletar rentalContracts:', e.message); }

  // 9. Deletar asaasAccounts/{uid}
  try {
    await db.collection('asaasAccounts').doc(uid).delete();
  } catch (e) { console.warn('[deleteAccountCF] Erro ao deletar asaasAccounts:', e.message); }
}

/**
 * Cascade para exclusao de conta de LOCATARIO.
 */
async function _deleteTenant(db, uid) {
  // 1. Processar cada carro vinculado ao locatario
  const carsSnap = await db.collection('cars').where('tenantId', '==', uid).get();

  await Promise.allSettled(
    carsSnap.docs.map(async (carDoc) => {
      const carData = carDoc.data();
      const carId = carDoc.id;
      const landlordId = carData.landlordId;
      const carInfo = `${carData.brand} ${carData.model} (${carData.plate})`;

      try {
        // Obter apiKey do locador para cancelar no Asaas
        let asaasClient = null;
        try {
          const accountDoc = await db.collection('asaasAccounts').doc(landlordId).get();
          if (accountDoc.exists) {
            asaasClient = createSubaccountClient(accountDoc.data().apiKey);
          }
        } catch (e) {
          console.warn('[deleteAccountCF] Erro ao obter Asaas do locador:', e.message);
        }

        // 1a. Cancelar contrato ativo
        const contractSnap = await db.collection('rentalContracts')
          .where('carId', '==', carId)
          .where('active', '==', true)
          .limit(1)
          .get();
        if (!contractSnap.empty) {
          await contractSnap.docs[0].ref.update({
            active: false,
            cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        // 1b. Cancelar cobranças PENDING/OVERDUE
        await cancelCarCharges(db, carId, landlordId, asaasClient);

        // 1c. Liberar carro
        await carDoc.ref.update({
          tenantId: null,
          status: 'available',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // 1d. Notificar locador
        try {
          await db.collection('notifications').add({
            userId: landlordId,
            title: 'Locatario encerrou a conta',
            body: `O locatario do veiculo ${carInfo} encerrou a conta. O veiculo esta disponivel novamente.`,
            data: { type: 'tenant_account_deleted', carId },
            read: false,
            sent: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (notifErr) {
          console.warn('[deleteAccountCF] Erro ao notificar locador:', notifErr.message);
        }
      } catch (carErr) {
        console.warn(`[deleteAccountCF] Erro ao processar carro ${carId}:`, carErr.message);
      }
    })
  );

  // 2. Anonimizar charges onde tenantId == uid (locador precisa do historico financeiro)
  try {
    const chargesSnap = await db.collection('charges').where('tenantId', '==', uid).get();
    for (let i = 0; i < chargesSnap.docs.length; i += BATCH_LIMIT) {
      const chunk = chargesSnap.docs.slice(i, i + BATCH_LIMIT);
      const batch = db.batch();
      chunk.forEach((d) => {
        batch.update(d.ref, {
          tenantId: 'deleted_user',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
    }
  } catch (e) { console.warn('[deleteAccountCF] Erro ao anonimizar charges:', e.message); }

  // 3a. Anonimizar rentalContracts onde tenantId == uid (LGPD: remover tenantName)
  try {
    const contractsSnap = await db.collection('rentalContracts').where('tenantId', '==', uid).get();
    for (let i = 0; i < contractsSnap.docs.length; i += BATCH_LIMIT) {
      const chunk = contractsSnap.docs.slice(i, i + BATCH_LIMIT);
      const batch = db.batch();
      chunk.forEach((d) => {
        batch.update(d.ref, {
          tenantId: 'deleted_user',
          tenantName: 'Usuario Excluido',
          active: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
    }
  } catch (e) { console.warn('[deleteAccountCF] Erro ao anonimizar rentalContracts:', e.message); }

  // 4. Deletar tasks onde tenantId == uid
  try {
    const tasksSnap = await db.collection('tasks').where('tenantId', '==', uid).get();
    await deleteInChunks(db, tasksSnap.docs.map((d) => d.ref));
  } catch (e) { console.warn('[deleteAccountCF] Erro ao deletar tasks:', e.message); }

  // 5. Deletar tenantRequests onde tenantId == uid
  try {
    const reqSnap = await db.collection('tenantRequests').where('tenantId', '==', uid).get();
    await deleteInChunks(db, reqSnap.docs.map((d) => d.ref));
  } catch (e) { console.warn('[deleteAccountCF] Erro ao deletar tenantRequests:', e.message); }

  // 6. Deletar notifications onde userId == uid
  try {
    const notifSnap = await db.collection('notifications').where('userId', '==', uid).get();
    await deleteInChunks(db, notifSnap.docs.map((d) => d.ref));
  } catch (e) { console.warn('[deleteAccountCF] Erro ao deletar notifications:', e.message); }
}

exports.deleteAccountCF = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }
  await checkRateLimit(request.auth.uid, 'deleteAccountCF', 2, 60000);

  const db = admin.firestore();
  const uid = request.auth.uid;

  // Verificar existencia e role do usuario
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) {
    throw new HttpsError('not-found', 'Usuario nao encontrado.');
  }
  const role = userDoc.data().role;

  // Cascade por role
  if (role === 'locador') {
    await _deleteLandlord(db, uid);
  } else {
    await _deleteTenant(db, uid);
  }

  // Deletar sub-colecao private/data
  try {
    await db.collection('users').doc(uid).collection('private').doc('data').delete();
  } catch (e) { console.warn('[deleteAccountCF] Erro ao deletar private/data:', e.message); }

  // Deletar doc publico do usuario
  await db.collection('users').doc(uid).delete();

  // Deletar conta no Firebase Auth (ultimo passo — irreversivel)
  await admin.auth().deleteUser(uid);

  return { success: true };
});
