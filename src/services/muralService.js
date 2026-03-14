// src/services/muralService.js
import { firestore } from '../config/firebase';
import { notificationService } from './notificationService';

export const muralService = {
  createPost: async (landlordId, data) => {
    try {
      const docRef = await firestore().collection('mural_posts').add({
        landlordId,
        title: data.title || '',
        content: data.content,
        category: data.category || 'geral',
        targetType: data.targetType || 'all',
        targetTenantId: data.targetTenantId || null,
        targetCarId: data.targetCarId || null,
        pinned: data.pinned || false,
        createdAt: firestore.FieldValue.serverTimestamp(),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      // Notificar locatarios
      const notifTitle = data.title || 'Novo aviso no mural';
      const notifBody = (data.content || '').substring(0, 100);
      const notifData = { type: 'mural_post', postId: docRef.id };

      if (data.targetType === 'specific' && data.targetTenantId) {
        // Notificar apenas o locatario especifico
        try {
          await notificationService.createNotification(
            data.targetTenantId, notifTitle, notifBody, notifData
          );
        } catch (e) { console.error('Notif mural tenant error:', e); }
      } else if (data.targetType === 'all') {
        // Notificar todos os locatarios atribuidos pelo locador
        try {
          const carsSnap = await firestore()
            .collection('cars')
            .where('landlordId', '==', landlordId)
            .get();
          const tenantIds = [
            ...new Set(
              carsSnap.docs
                .map(d => d.data().tenantId)
                .filter(Boolean)
            ),
          ];
          await Promise.all(
            tenantIds.map(tid =>
              notificationService.createNotification(tid, notifTitle, notifBody, notifData)
            )
          );
        } catch (e) { console.error('Notif mural all tenants error:', e); }
      }

      return { success: true, id: docRef.id };
    } catch (error) {
      console.error('Create mural post error:', error);
      return { success: false, error: error.message };
    }
  },

  updatePost: async (postId, data) => {
    try {
      // Buscar post atual para notificar os locatarios corretos
      const postDoc = await firestore().collection('mural_posts').doc(postId).get();
      await firestore().collection('mural_posts').doc(postId).update({
        ...data,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });

      // Notificar locatarios sobre aviso atualizado (apenas se o post existe)
      if (postDoc.exists) {
        const post = postDoc.data();
        const updatedTitle = data.title || post.title || 'Aviso atualizado';
        const updatedContent = data.content || post.content || '';
        const notifTitle = `Aviso atualizado: ${updatedTitle}`;
        const notifBody = updatedContent.substring(0, 100);
        const notifData = { type: 'mural_updated', postId };

        if (post.targetType === 'specific' && post.targetTenantId) {
          try {
            await notificationService.createNotification(
              post.targetTenantId, notifTitle, notifBody, notifData
            );
          } catch (e) { console.error('Notif mural update tenant error:', e); }
        } else if (post.targetType === 'all' && post.landlordId) {
          try {
            const carsSnap = await firestore()
              .collection('cars')
              .where('landlordId', '==', post.landlordId)
              .get();
            const tenantIds = [
              ...new Set(
                carsSnap.docs
                  .map(d => d.data().tenantId)
                  .filter(Boolean)
              ),
            ];
            await Promise.all(
              tenantIds.map(tid =>
                notificationService.createNotification(tid, notifTitle, notifBody, notifData)
              )
            );
          } catch (e) { console.error('Notif mural update all tenants error:', e); }
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Update mural post error:', error);
      return { success: false, error: error.message };
    }
  },

  deletePost: async (postId) => {
    try {
      await firestore().collection('mural_posts').doc(postId).delete();
      return { success: true };
    } catch (error) {
      console.error('Delete mural post error:', error);
      return { success: false, error: error.message };
    }
  },

  // Posts do locador (sem orderBy — ordena client-side)
  getPostsByLandlord: async (landlordId) => {
    try {
      const snapshot = await firestore()
        .collection('mural_posts')
        .where('landlordId', '==', landlordId)
        .get();

      const posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      posts.sort((a, b) => {
        const da = a.createdAt?.toDate?.() || new Date(0);
        const db = b.createdAt?.toDate?.() || new Date(0);
        return db - da;
      });
      return { success: true, data: posts };
    } catch (error) {
      console.error('Get landlord mural posts error:', error);
      return { success: false, data: [] };
    }
  },

  // Posts visiveis para locatario (sem orderBy — ordena client-side)
  getPostsForTenant: async (tenantId, landlordIds) => {
    try {
      if (!landlordIds || landlordIds.length === 0) {
        return { success: true, data: [] };
      }

      // Posts gerais (para todos) — 2 wheres sem orderBy
      // landlordId 'in' conta como 1 where
      const allPostsSnapshot = await firestore()
        .collection('mural_posts')
        .where('landlordId', 'in', landlordIds)
        .where('targetType', '==', 'all')
        .get();

      let posts = allPostsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Posts especificos para este locatario — 1 where sem orderBy
      const specificSnapshot = await firestore()
        .collection('mural_posts')
        .where('targetTenantId', '==', tenantId)
        .get();

      const specificPosts = specificSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      posts = [...posts, ...specificPosts];

      // Remover duplicatas
      const seen = new Set();
      posts = posts.filter(p => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });

      // Ordenar client-side: pinned primeiro, depois por data desc
      posts.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        const dateA = a.createdAt?.toDate?.() || new Date(0);
        const dateB = b.createdAt?.toDate?.() || new Date(0);
        return dateB - dateA;
      });

      return { success: true, data: posts };
    } catch (error) {
      console.error('Get tenant mural posts error:', error);
      return { success: false, data: [] };
    }
  },
};

export const MURAL_CATEGORIES = [
  { value: 'geral', label: 'Geral' },
  { value: 'pagamento', label: 'Pagamento' },
  { value: 'contato', label: 'Contatos Importantes' },
  { value: 'regras', label: 'Regras' },
  { value: 'aviso', label: 'Aviso' },
];
