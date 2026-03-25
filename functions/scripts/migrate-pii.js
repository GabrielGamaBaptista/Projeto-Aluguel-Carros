/**
 * migrate-pii.js — Script one-shot para migrar PII de usuarios existentes
 * do doc publico users/{uid} para a sub-colecao users/{uid}/private/data (Q1.2).
 *
 * Execucao: node functions/scripts/migrate-pii.js
 * Requer: GOOGLE_APPLICATION_CREDENTIALS configurado ou firebase-admin inicializado
 * com credenciais de servico.
 *
 * SEGURO para re-execucao: apenas cria/sobrescreve private/data, nao remove campos
 * do doc publico (remocao e a Fase C, planejada para batch 4).
 */

const admin = require('firebase-admin');

// Inicializa usando credenciais padrao (Application Default Credentials)
// Para rodar localmente: `firebase login` e entao `node functions/scripts/migrate-pii.js`
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'aluguel-carros-30b83',
  });
}

const db = admin.firestore();

// Campos PII que devem estar no private/data
const PII_FIELDS_COMMON = [
  'phone', 'birthDate', 'personType', 'companyName',
  'cep', 'street', 'number', 'complement', 'neighborhood',
  'city', 'state', 'address',
];

const PII_FIELDS_TENANT = [
  'cnhNumber', 'cnhCategory', 'cnhExpiry',
  'cnhFrontPhoto', 'cnhBackPhoto', 'residenceProofPhoto',
];

async function migrateUser(userDoc) {
  const uid = userDoc.id;
  const data = userDoc.data();

  // Extrair campos PII que existem no doc publico
  const privateData = {};
  for (const field of PII_FIELDS_COMMON) {
    if (data[field] !== undefined) {
      privateData[field] = data[field];
    }
  }

  if (data.role === 'locatario') {
    for (const field of PII_FIELDS_TENANT) {
      if (data[field] !== undefined) {
        privateData[field] = data[field];
      }
    }
  }

  // Se nao ha dados PII no doc publico, pular
  if (Object.keys(privateData).length === 0) {
    return 'skip';
  }

  // Verificar se private/data ja existe (para evitar sobrescrever dados mais recentes)
  const privateRef = db.collection('users').doc(uid).collection('private').doc('data');
  const existingPrivate = await privateRef.get();

  if (existingPrivate.exists) {
    // Ja existe — merge conservador: nao sobrescrever campos ja preenchidos no private
    const existingData = existingPrivate.data();
    const updates = {};
    for (const [key, value] of Object.entries(privateData)) {
      if (existingData[key] === undefined || existingData[key] === '') {
        updates[key] = value;
      }
    }
    if (Object.keys(updates).length > 0) {
      await privateRef.update(updates);
      return 'updated';
    }
    return 'already-exists';
  }

  // Criar private/data com os campos PII
  await privateRef.set(privateData);
  return 'created';
}

async function main() {
  console.log('\n=== Migracao PII — users/{uid}/private/data ===\n');

  const usersSnap = await db.collection('users').get();
  const total = usersSnap.size;
  console.log(`Total de usuarios: ${total}\n`);

  let created = 0, updated = 0, alreadyExists = 0, skipped = 0, errors = 0;

  for (const userDoc of usersSnap.docs) {
    try {
      const result = await migrateUser(userDoc);
      if (result === 'created') { created++; console.log(`  OK  ${userDoc.id} (criado)`); }
      else if (result === 'updated') { updated++; console.log(`  UP  ${userDoc.id} (atualizado)`); }
      else if (result === 'already-exists') { alreadyExists++; }
      else { skipped++; }
    } catch (err) {
      errors++;
      console.error(`  EE  ${userDoc.id} -> ${err.message}`);
    }
  }

  console.log('\n=== Resultado ===');
  console.log(`  Criados:         ${created}`);
  console.log(`  Atualizados:     ${updated}`);
  console.log(`  Ja existiam:     ${alreadyExists}`);
  console.log(`  Sem PII:         ${skipped}`);
  console.log(`  Erros:           ${errors}`);
  console.log(`  Total:           ${total}\n`);
}

main().catch(console.error).finally(() => process.exit(0));
