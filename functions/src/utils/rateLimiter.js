const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');

/**
 * Rate limiter baseado em Firestore (Q1.10).
 *
 * Armazena contadores em `rateLimits/{uid}_{action}` com janela deslizante fixa.
 * Usa transacao Firestore para atomicidade — previne race conditions em chamadas simultaneas.
 *
 * @param {string} uid      - UID do usuario autenticado
 * @param {string} action   - Identificador da acao (ex: 'createCharge')
 * @param {number} maxCalls - Maximo de chamadas permitidas na janela
 * @param {number} windowMs - Tamanho da janela em milissegundos (ex: 60000 = 1 minuto)
 * @throws {HttpsError} 'resource-exhausted' se o limite for excedido
 */
async function checkRateLimit(uid, action, maxCalls, windowMs) {
  const db = admin.firestore();
  const docId = `${uid}_${action}`;
  const ref = db.collection('rateLimits').doc(docId);
  const now = Date.now();

  // TTL: documentos expiram 10 janelas apos a janela atual (limpeza automatica via Firestore TTL policy)
  const ttlAt = admin.firestore.Timestamp.fromMillis(now + windowMs * 10);

  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);

    if (!doc.exists) {
      // Primeira chamada: inicializar contador
      tx.set(ref, { count: 1, windowStart: now, ttlAt });
      return;
    }

    const { count, windowStart } = doc.data();

    if (now - windowStart > windowMs) {
      // Janela expirada: resetar
      tx.update(ref, { count: 1, windowStart: now, ttlAt });
      return;
    }

    if (count >= maxCalls) {
      throw new HttpsError(
        'resource-exhausted',
        `Muitas requisicoes. Tente novamente em alguns instantes.`
      );
    }

    tx.update(ref, { count: count + 1 });
  });
}

module.exports = { checkRateLimit };
