const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { checkRateLimit } = require('../utils/rateLimiter');

/**
 * searchTenantsCF — Busca locatarios por email ou CPF, restrita ao locador autenticado.
 *
 * Substitui queries client-side diretas no Firestore que expunham dados de todos os
 * locatarios. Retorna apenas dados minimos necessarios para atribuicao (Q1.6).
 *
 * Input:  { query } — email (minimo 3 chars) ou CPF (apenas digitos)
 * Output: [{ id, name, email }]
 */
exports.searchTenantsCF = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }
  await checkRateLimit(request.auth.uid, 'searchTenantsCF', 20, 60000);

  // Validar que o caller e locador
  const db = admin.firestore();
  const callerDoc = await db.collection('users').doc(request.auth.uid).get();
  if (!callerDoc.exists || callerDoc.data().role !== 'locador') {
    throw new HttpsError('permission-denied', 'Apenas locadores podem buscar locatarios.');
  }

  const { query } = request.data || {};
  if (!query || String(query).trim().length < 3) {
    throw new HttpsError('invalid-argument', 'Digite pelo menos 3 caracteres.');
  }

  const q = String(query).trim().toLowerCase();
  const cleanQ = q.replace(/\D/g, '');
  // CPF search: input formado apenas por digitos, pontos, hifens e espacos (formatos comuns de CPF) E com 11 digitos limpos
  // Evita tratar emails com 11 digitos (ex: pedro12345678901@gmail.com) como CPF
  const isCpfSearch = /^[\d.\-\s]+$/.test(q) && cleanQ.length === 11;

  if (isCpfSearch) {
    // Busca por CPF na subcollection private (admin SDK)
    const snap = await db.collectionGroup('private').where('cpf', '==', cleanQ).limit(5).get();
    if (snap.empty) return [];

    // Buscar docs publicos em paralelo (performance)
    const results = (await Promise.all(
      snap.docs.map(async (privateDoc) => {
        const userRef = privateDoc.ref.parent.parent;
        const userDoc = await userRef.get();
        if (userDoc.exists && userDoc.data().role === 'locatario') {
          return { id: userDoc.id, name: userDoc.data().name || '', email: userDoc.data().email || '' };
        }
        return null;
      })
    )).filter(res => res !== null);
    return results;
  }

  // Busca por email (prefixo)
  const snap = await db.collection('users')
    .where('role', '==', 'locatario')
    .where('email', '>=', q)
    .where('email', '<=', q + '\uf8ff')
    .limit(10)
    .get();

  return snap.docs.map(doc => ({
    id: doc.id,
    name: doc.data().name || '',
    email: doc.data().email || '',
  }));
});
