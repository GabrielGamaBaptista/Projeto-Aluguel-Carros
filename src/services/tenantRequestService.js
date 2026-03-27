// src/services/tenantRequestService.js
import { firestore, auth } from '../config/firebase';
import { notificationService } from './notificationService';
import functions from '@react-native-firebase/functions';
import { carCache } from '../utils/cache';

export const tenantRequestService = {
  // Enviar solicitacao de atribuicao
  sendRequest: async (landlordId, tenantId, carId, carInfo, landlordName) => {
    try {
      // Verificar se ja existe solicitacao pendente para este carro+locatario
      // Filtra por landlordId para satisfazer regra de segurança do Firestore
      const existing = await firestore().collection('tenantRequests')
        .where('carId', '==', carId)
        .where('landlordId', '==', landlordId)
        .get();

      const alreadyExists = existing.docs.some(
        doc => doc.data().tenantId === tenantId && doc.data().status === 'pending'
      );
      if (alreadyExists) {
        return { success: false, error: 'Ja existe uma solicitacao pendente para este locatario e carro.' };
      }

      const docRef = await firestore().collection('tenantRequests').add({
        landlordId,
        tenantId,
        carId,
        carInfo: carInfo || '',
        landlordName: landlordName || '',
        status: 'pending',
        createdAt: firestore.FieldValue.serverTimestamp(),
      });

      // Notificar locatario
      await notificationService.createNotification(
        tenantId,
        'Nova Solicitacao de Carro',
        `${landlordName} quer atribuir o carro ${carInfo} a voce. Abra o app para aceitar ou recusar.`,
        { type: 'tenant_request', requestId: docRef.id }
      );

      return { success: true, id: docRef.id };
    } catch (error) {
      console.error('Send request error:', error);
      return { success: false, error: error.message };
    }
  },

  // Obter solicitacoes pendentes para um locatario
  getPendingRequests: async (tenantId) => {
    try {
      // Query simples: 2 campos equality (nao precisa de indice composto)
      const snapshot = await firestore().collection('tenantRequests')
        .where('tenantId', '==', tenantId)
        .where('status', '==', 'pending')
        .get();

      // Ordenar client-side para evitar indice composto com orderBy
      const requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      requests.sort((a, b) => {
        const ta = a.createdAt?.toDate?.() || new Date(0);
        const tb = b.createdAt?.toDate?.() || new Date(0);
        return tb - ta;
      });
      return { success: true, data: requests };
    } catch (error) {
      console.error('Get pending requests error:', error);
      return { success: false, data: [] };
    }
  },

  // Obter solicitacoes enviadas por um locador (para um carro)
  getSentRequests: async (carId) => {
    try {
      const uid = auth().currentUser?.uid;
      if (!uid) return { success: false, data: [] };

      const snapshot = await firestore().collection('tenantRequests')
        .where('carId', '==', carId)
        .where('landlordId', '==', uid)
        .get();

      const requests = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(r => r.status === 'pending');
      return { success: true, data: requests };
    } catch (error) {
      console.error('Get sent requests error:', error);
      return { success: false, data: [] };
    }
  },

  // Aceitar solicitacao — delega para Cloud Function assignTenantCF (Q1.4)
  // A CF valida atomicamente: request pendente + carro disponivel + tenant sem carro
  // e usa admin SDK para atribuir sem depender do Caso 3 das Firestore rules.
  acceptRequest: async (requestId, carId = null) => {
    try {
      const assignTenantFn = functions().httpsCallable('assignTenantCF');
      const result = await assignTenantFn({ requestId });
      if (result.data?.success && carId) carCache.invalidate(carId);
      return result.data;
    } catch (error) {
      console.error('Accept request error:', error);
      return { success: false, error: error.message };
    }
  },

  // Recusar solicitacao
  rejectRequest: async (requestId, landlordId, carInfo, carId) => {
    try {
      const ttlAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await firestore().collection('tenantRequests').doc(requestId).update({
        status: 'rejected',
        respondedAt: firestore.FieldValue.serverTimestamp(),
        ttlAt,
      });

      // Notificar locador
      if (landlordId) {
        await notificationService.createNotification(
          landlordId,
          'Solicitacao Recusada',
          `O locatario recusou a atribuicao do carro ${carInfo || ''}.`,
          { type: 'request_rejected', carId: carId || null }
        );
      }

      return { success: true };
    } catch (error) {
      console.error('Reject request error:', error);
      return { success: false, error: error.message };
    }
  },

  // Cancelar solicitacao (pelo locador)
  cancelRequest: async (requestId) => {
    try {
      const ttlAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await firestore().collection('tenantRequests').doc(requestId).update({
        status: 'cancelled',
        respondedAt: firestore.FieldValue.serverTimestamp(),
        ttlAt,
      });
      return { success: true };
    } catch (error) {
      console.error('Cancel request error:', error);
      return { success: false, error: error.message };
    }
  },
};
