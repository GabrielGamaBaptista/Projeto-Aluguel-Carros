// functions/src/handlers/createNotification.js
// SEC-01: Cloud Function segura para criar notificacoes.
// Substitui o write direto do cliente para a colecao notifications/.
// Garante que apenas usuarios com relacionamento valido (locador <-> locatario)
// possam criar notificacoes um para o outro.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { checkRateLimit } = require('../utils/rateLimiter');

/**
 * Verifica se caller e target possuem relacionamento valido.
 * Aceita: par landlord-tenant em cars/ OU tenantRequests/ (qualquer status).
 */
async function hasValidRelationship(callerId, targetId) {
  const db = admin.firestore();

  // Verificar em paralelo: cars (landlord->tenant) e cars (tenant->landlord)
  const [landlordQuery, tenantQuery, requestQuery1, requestQuery2] = await Promise.all([
    // caller e locador, target e locatario
    db.collection('cars')
      .where('landlordId', '==', callerId)
      .where('tenantId', '==', targetId)
      .limit(1)
      .get(),
    // caller e locatario, target e locador
    db.collection('cars')
      .where('tenantId', '==', callerId)
      .where('landlordId', '==', targetId)
      .limit(1)
      .get(),
    // solicitacao de vinculo: caller enviou para target
    db.collection('tenantRequests')
      .where('landlordId', '==', callerId)
      .where('tenantId', '==', targetId)
      .limit(1)
      .get(),
    // solicitacao de vinculo: target enviou para caller
    db.collection('tenantRequests')
      .where('landlordId', '==', targetId)
      .where('tenantId', '==', callerId)
      .limit(1)
      .get(),
  ]);

  return (
    !landlordQuery.empty ||
    !tenantQuery.empty ||
    !requestQuery1.empty ||
    !requestQuery2.empty
  );
}

exports.createNotificationCF = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'O usuario deve estar autenticado.');
  }

  await checkRateLimit(request.auth.uid, 'createNotification', 30, 60000);

  const { targetUserId, title, body, data = {} } = request.data;

  // Validacao de entrada
  if (!targetUserId || typeof targetUserId !== 'string') {
    throw new HttpsError('invalid-argument', 'targetUserId e obrigatorio.');
  }
  if (!title || typeof title !== 'string') {
    throw new HttpsError('invalid-argument', 'title e obrigatorio.');
  }
  if (title.length > 200) {
    throw new HttpsError('invalid-argument', 'title excede 200 caracteres.');
  }
  if (!body || typeof body !== 'string') {
    throw new HttpsError('invalid-argument', 'body e obrigatorio.');
  }
  if (body.length > 500) {
    throw new HttpsError('invalid-argument', 'body excede 500 caracteres.');
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpsError('invalid-argument', 'data deve ser um objeto.');
  }

  // Validar relacionamento: caller e target devem ter vinculo no sistema
  const valid = await hasValidRelationship(request.auth.uid, targetUserId);
  if (!valid) {
    throw new HttpsError('permission-denied', 'Sem relacionamento valido para enviar notificacao.');
  }

  // Escrever via admin SDK (bypassa Firestore Rules)
  await admin.firestore().collection('notifications').add({
    userId: targetUserId,
    title,
    body,
    data,
    read: false,
    sent: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});
