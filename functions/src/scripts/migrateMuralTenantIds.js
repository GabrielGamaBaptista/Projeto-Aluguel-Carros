/**
 * Script de migracao one-time — Backfill de tenantIds em posts do mural legados.
 *
 * SEC-03: posts criados antes do createMuralPostCF nao possuem o campo tenantIds,
 * o que os torna visiveis a qualquer usuario autenticado via fallback de regra Firestore.
 * Este script popula tenantIds em todos os posts existentes para permitir remocao
 * do fallback das regras.
 *
 * Uso:
 *   node functions/src/scripts/migrateMuralTenantIds.js
 *
 * Pre-requisitos:
 *   - GOOGLE_APPLICATION_CREDENTIALS apontando para service account com acesso ao Firestore
 *   - firebase-admin instalado (disponivel via functions/node_modules)
 *
 * Apos execucao bem-sucedida:
 *   - Remover o bloco de compatibilidade legada nas firestore.rules:
 *       || (resource.data.get('tenantIds', null) == null && resource.data.targetType == 'all')
 */

'use strict';

const admin = require('firebase-admin');
admin.initializeApp();

const db = admin.firestore();

async function migrate() {
  console.log('Iniciando migracao de tenantIds no mural...');

  // Buscar todos os posts sem tenantIds (campo ausente)
  const allPostsSnap = await db.collection('mural_posts').get();
  const postsToMigrate = allPostsSnap.docs.filter(doc => {
    const data = doc.data();
    return data.tenantIds === undefined || data.tenantIds === null;
  });

  console.log(`Total de posts: ${allPostsSnap.size}. Posts sem tenantIds: ${postsToMigrate.length}`);

  if (postsToMigrate.length === 0) {
    console.log('Nenhum post para migrar. Migracao concluida!');
    process.exit(0);
  }

  let processed = 0;
  let errors = 0;

  for (const postDoc of postsToMigrate) {
    const post = postDoc.data();
    try {
      let tenantIds = [];

      if (post.targetType === 'specific' && post.targetTenantId) {
        tenantIds = [post.targetTenantId];
      } else if (post.targetType === 'all' && post.landlordId) {
        // Buscar carros do locador para obter locatarios atuais
        const carsSnap = await db.collection('cars')
          .where('landlordId', '==', post.landlordId)
          .get();
        tenantIds = [...new Set(
          carsSnap.docs.map(d => d.data().tenantId).filter(Boolean)
        )];
      }

      await postDoc.ref.update({ tenantIds });
      processed++;
      console.log(`[${processed}/${postsToMigrate.length}] Post ${postDoc.id} migrado. tenantIds: [${tenantIds.join(', ')}]`);
    } catch (err) {
      errors++;
      console.error(`Erro ao migrar post ${postDoc.id}:`, err.message);
    }
  }

  console.log(`\nMigracao concluida. Processados: ${processed}, Erros: ${errors}`);
  if (errors === 0) {
    console.log('\nPROXIMO PASSO: remova o fallback legado nas firestore.rules:');
    console.log('  || (resource.data.get(\'tenantIds\', null) == null && resource.data.targetType == \'all\')');
  }
  process.exit(errors > 0 ? 1 : 0);
}

migrate().catch(err => {
  console.error('Erro fatal na migracao:', err);
  process.exit(1);
});
