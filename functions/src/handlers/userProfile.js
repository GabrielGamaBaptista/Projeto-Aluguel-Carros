const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const { checkRateLimit } = require('../utils/rateLimiter');

/**
 * Helper: mescla doc publico + sub-doc private/data de um usuario.
 * Usa fallback para o doc publico se private/data nao existir (periodo de migracao).
 */
async function getUserMerged(db, userId) {
  const publicDoc = await db.collection('users').doc(userId).get();
  if (!publicDoc.exists) return null;

  const privateDoc = await db.collection('users').doc(userId)
    .collection('private').doc('data').get();

  // Filtrar undefined/null para nao sobrescrever valores validos do doc publico
  const rawPrivate = privateDoc.exists ? privateDoc.data() : {};
  const privateData = Object.fromEntries(
    Object.entries(rawPrivate).filter(([, v]) => v !== undefined && v !== null)
  );
  return { id: userId, ...publicDoc.data(), ...privateData };
}

/**
 * CF Callable: retorna dados completos (publico + PII) de um locatario.
 * Apenas o locador de um carro onde o locatario esta atribuido pode chamar.
 * Rate limit: 30/min (Q1.10).
 */
exports.getTenantDetailsCF = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }

  await checkRateLimit(request.auth.uid, 'getTenantDetailsCF', 30, 60000);

  const { tenantId } = request.data;
  if (!tenantId || typeof tenantId !== 'string') {
    throw new HttpsError('invalid-argument', 'tenantId e obrigatorio.');
  }

  const db = admin.firestore();
  const callerId = request.auth.uid;

  // Verificar que o caller e locador de um carro onde este locatario esta atribuido
  const carsSnap = await db.collection('cars')
    .where('landlordId', '==', callerId)
    .where('tenantId', '==', tenantId)
    .limit(1)
    .get();

  if (carsSnap.empty) {
    throw new HttpsError(
      'permission-denied',
      'Acesso negado: voce nao e o locador de um carro atribuido a este locatario.'
    );
  }

  // SEC-19: audit log de acesso a PII do locatario
  logger.info('pii.access', {
    type: 'getTenantDetails',
    callerId,
    tenantId,
    timestamp: new Date().toISOString(),
  });

  // Buscar dados completos do locatario (publico + private)
  const tenantData = await getUserMerged(db, tenantId);
  if (!tenantData) {
    throw new HttpsError('not-found', 'Locatario nao encontrado.');
  }

  // Whitelist de campos que o locador pode ver (nao expor campos internos ou futuros)
  const safeData = {
    // Dados publicos
    id: tenantData.id,
    name: tenantData.name,
    email: tenantData.email,
    role: tenantData.role,
    profilePhoto: tenantData.profilePhoto || null,
    // Dados privados relevantes para o locador
    phone: tenantData.phone,
    cpf: tenantData.cpf,
    birthDate: tenantData.birthDate,
    cep: tenantData.cep,
    street: tenantData.street,
    number: tenantData.number,
    complement: tenantData.complement,
    neighborhood: tenantData.neighborhood,
    city: tenantData.city,
    state: tenantData.state,
    address: tenantData.address,
    // CNH (locatario)
    cnhNumber: tenantData.cnhNumber,
    cnhCategory: tenantData.cnhCategory,
    cnhExpiry: tenantData.cnhExpiry,
    cnhFrontPhoto: tenantData.cnhFrontPhoto,
    cnhBackPhoto: tenantData.cnhBackPhoto,
    residenceProofPhoto: tenantData.residenceProofPhoto,
  };

  return { success: true, data: safeData };
});
