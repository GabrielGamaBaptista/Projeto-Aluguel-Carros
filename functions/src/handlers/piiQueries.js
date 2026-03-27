const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { checkRateLimit } = require('../utils/rateLimiter');

// Validacao de digitos verificadores (mod11) — evita queries ao Firestore com CPFs/CNPJs invalidos
function isValidCpf(cpf) {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  if (parseInt(cpf[9]) !== d1) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  return parseInt(cpf[10]) === d2;
}

function isValidCnpj(cnpj) {
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const w1 = [5,4,3,2,9,8,7,6,5,4,3,2];
  const sum1 = cnpj.slice(0,12).split('').reduce((acc, d, i) => acc + parseInt(d) * w1[i], 0);
  let d1 = 11 - (sum1 % 11); if (d1 >= 10) d1 = 0;
  if (parseInt(cnpj[12]) !== d1) return false;
  const w2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  const sum2 = cnpj.slice(0,13).split('').reduce((acc, d, i) => acc + parseInt(d) * w2[i], 0);
  let d2 = 11 - (sum2 % 11); if (d2 >= 10) d2 = 0;
  return parseInt(cnpj[13]) === d2;
}

/**
 * checkPiiUniqueCF — Verifica unicidade de CPF/CNPJ/phone via admin SDK.
 *
 * Queries na subcollection `private` (collection group) — dados nao expostos
 * ao cliente apos Q1.2 Fase C. Sem autenticacao requerida (usado no cadastro,
 * antes do usuario ter conta). Rate limit por IP: 10/min.
 *
 * Input:  { cpf?, cnpj?, phone? }
 * Output: { cpfExists?, cnpjExists?, phoneExists? }
 */
exports.checkPiiUniqueCF = onCall({ cors: true, invoker: 'public' }, async (request) => {
  const ip = request.rawRequest?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
    || request.rawRequest?.ip
    || 'unknown';
  await checkRateLimit(`ip_${ip}`, 'checkPiiUnique', 10, 60000);

  const { cpf, cnpj, phone } = request.data || {};
  if (!cpf && !cnpj && !phone) {
    throw new HttpsError('invalid-argument', 'Pelo menos um identificador (cpf, cnpj ou phone) e obrigatorio.');
  }

  const db = admin.firestore();
  const result = {};

  if (cpf) {
    const cleanCpf = String(cpf).replace(/\D/g, '');
    if (!isValidCpf(cleanCpf)) {
      result.cpfExists = false;
    } else {
      const snap = await db.collectionGroup('private').where('cpf', '==', cleanCpf).limit(1).get();
      result.cpfExists = !snap.empty;
    }
  }
  if (cnpj) {
    const cleanCnpj = String(cnpj).replace(/\D/g, '');
    if (!isValidCnpj(cleanCnpj)) {
      result.cnpjExists = false;
    } else {
      const snap = await db.collectionGroup('private').where('cnpj', '==', cleanCnpj).limit(1).get();
      result.cnpjExists = !snap.empty;
    }
  }
  if (phone) {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const snap = await db.collectionGroup('private').where('phone', '==', cleanPhone).limit(1).get();
    result.phoneExists = !snap.empty;
  }

  return result;
});

/**
 * findEmailByIdentifierCF — Busca email por CPF (11 digitos) ou CNPJ (14 digitos).
 *
 * Usado no login por CPF/CNPJ — sem autenticacao requerida. Queries na
 * subcollection `private` via admin SDK e retorna apenas o email do doc pai.
 * Rate limit por IP: 10/min.
 *
 * Input:  { identifier } — CPF (11 digitos) ou CNPJ (14 digitos), apenas numeros
 * Output: { success: true, email } ou lanca HttpsError 'not-found'
 */
exports.findEmailByIdentifierCF = onCall({ cors: true, invoker: 'public' }, async (request) => {
  const ip = request.rawRequest?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
    || request.rawRequest?.ip
    || 'unknown';
  await checkRateLimit(`ip_${ip}`, 'findEmailByIdentifier', 10, 60000);

  const { identifier } = request.data || {};
  if (!identifier) {
    throw new HttpsError('invalid-argument', 'identifier e obrigatorio.');
  }

  const clean = String(identifier).replace(/\D/g, '');
  if (clean.length !== 11 && clean.length !== 14) {
    // Usar not-found em vez de invalid-argument para nao revelar informacao sobre o formato
    throw new HttpsError('not-found', 'Identificador ou senha incorretos.');
  }

  // Validar digitos verificadores antes de consultar o Firestore
  if (clean.length === 11 && !isValidCpf(clean)) {
    throw new HttpsError('not-found', 'CPF ou senha incorretos.');
  }
  if (clean.length === 14 && !isValidCnpj(clean)) {
    throw new HttpsError('not-found', 'CNPJ ou senha incorretos.');
  }

  const db = admin.firestore();
  const field = clean.length === 11 ? 'cpf' : 'cnpj';
  const snap = await db.collectionGroup('private').where(field, '==', clean).limit(1).get();

  if (snap.empty) {
    const errorMsg = clean.length === 11 ? 'CPF ou senha incorretos.' : 'CNPJ ou senha incorretos.';
    throw new HttpsError('not-found', errorMsg);
  }

  // Doc pai e users/{uid} — buscar email do doc publico
  const parentRef = snap.docs[0].ref.parent.parent;
  const userDoc = await parentRef.get();

  if (!userDoc.exists) {
    throw new HttpsError('not-found', 'Usuario nao encontrado.');
  }

  return { success: true, email: userDoc.data().email };
});
