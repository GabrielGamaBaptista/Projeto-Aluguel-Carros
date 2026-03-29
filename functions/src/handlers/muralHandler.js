const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const { checkRateLimit } = require('../utils/rateLimiter');

const VALID_CATEGORIES = ['geral', 'pagamento', 'contato', 'regras', 'aviso', 'urgente'];

/**
 * createMuralPostCF — Cria post no mural com validacao server-side de relacionamento.
 *
 * SEC-03: tenantIds populado server-side com os locatarios reais do locador —
 *   impede que locatarios vejam posts de locadores com quem nao tem relacao.
 * SEC-08: targetTenantId validado contra cars do locador —
 *   impede direcionamento a locatarios arbitrarios.
 *
 * Input: { title?, content, category?, targetType?, targetTenantId?, targetCarId?, pinned? }
 * Output: { success: true, id: postId }
 */
exports.createMuralPostCF = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }
  await checkRateLimit(request.auth.uid, 'createMuralPost', 30, 60000);

  const db = admin.firestore();
  const uid = request.auth.uid;

  // Validar que o caller e locador
  const callerDoc = await db.collection('users').doc(uid).get();
  if (!callerDoc.exists || callerDoc.data().role !== 'locador') {
    throw new HttpsError('permission-denied', 'Apenas locadores podem criar posts no mural.');
  }

  const { title, content, category, targetType, targetTenantId, targetCarId, pinned } = request.data || {};

  // Validacao de campos obrigatorios e limites
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'content e obrigatorio.');
  }
  if (title && String(title).length > 200) {
    throw new HttpsError('invalid-argument', 'title excede 200 caracteres.');
  }
  if (String(content).length > 2000) {
    throw new HttpsError('invalid-argument', 'content excede 2000 caracteres.');
  }
  if (category && !VALID_CATEGORIES.includes(category)) {
    throw new HttpsError('invalid-argument', 'category invalida.');
  }
  const resolvedTargetType = targetType || 'all';
  if (!['all', 'specific'].includes(resolvedTargetType)) {
    throw new HttpsError('invalid-argument', 'targetType deve ser "all" ou "specific".');
  }

  let tenantIds = [];
  let resolvedTargetTenantId = null;

  if (resolvedTargetType === 'specific') {
    if (!targetTenantId) {
      throw new HttpsError('invalid-argument', 'targetTenantId e obrigatorio para targetType "specific".');
    }
    // SEC-08: valida que o targetTenantId e locatario de um carro do locador
    const carSnap = await db.collection('cars')
      .where('landlordId', '==', uid)
      .where('tenantId', '==', targetTenantId)
      .limit(1)
      .get();
    if (carSnap.empty) {
      throw new HttpsError(
        'permission-denied',
        'O locatario especificado nao esta atribuido a nenhum dos seus carros.'
      );
    }
    tenantIds = [targetTenantId];
    resolvedTargetTenantId = targetTenantId;
  } else {
    // SEC-03: para posts 'all', obter todos os locatarios dos carros do locador server-side
    const carsSnap = await db.collection('cars')
      .where('landlordId', '==', uid)
      .get();
    tenantIds = [...new Set(
      carsSnap.docs
        .map(d => d.data().tenantId)
        .filter(Boolean)
    )];
  }

  // Criar post com tenantIds populado server-side
  const docRef = await db.collection('mural_posts').add({
    landlordId: uid,
    title: title || '',
    content: content.trim(),
    category: category || 'geral',
    targetType: resolvedTargetType,
    targetTenantId: resolvedTargetTenantId,
    targetCarId: targetCarId || null,
    pinned: pinned || false,
    tenantIds, // SEC-03: controla visibilidade no nivel de documento
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Notificar locatarios (nao-critico — falha silenciosamente)
  if (tenantIds.length > 0) {
    try {
      const notifTitle = title || 'Novo aviso no mural';
      const notifBody = content.substring(0, 100);
      await Promise.all(
        tenantIds.map(tid =>
          db.collection('notifications').add({
            userId: tid,
            title: notifTitle,
            body: notifBody,
            data: { type: 'mural_post', postId: docRef.id },
            read: false,
            sent: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        )
      );
    } catch (notifErr) {
      logger.error('createMuralPostCF.notifError', { error: notifErr.message, postId: docRef.id });
    }
  }

  return { success: true, id: docRef.id };
});
