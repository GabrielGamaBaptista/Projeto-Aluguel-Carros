// src/services/tenantRequestService.js
import { firestore, auth } from '../config/firebase';
import { notificationService } from './notificationService';

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

  // Aceitar solicitacao
  acceptRequest: async (requestId) => {
    try {
      const doc = await firestore().collection('tenantRequests').doc(requestId).get();
      if (!doc.exists) return { success: false, error: 'Solicitacao nao encontrada.' };

      const request = doc.data();
      if (request.status !== 'pending') return { success: false, error: 'Solicitacao ja foi respondida.' };

      // Atribuir locatario ao carro
      const { carsService } = require('./carsService');
      const assignResult = await carsService.assignTenant(request.carId, request.tenantId);
      if (!assignResult.success) return assignResult;

      // Atualizar status do request aceito
      await firestore().collection('tenantRequests').doc(requestId).update({
        status: 'accepted',
        respondedAt: firestore.FieldValue.serverTimestamp(),
      });

      // Cancelar outras solicitacoes pendentes para o mesmo carro (nao-critico)
      // O carro ja esta atribuido; outros requests nao podem ser aceitos de qualquer forma.
      try {
        const otherPending = await firestore().collection('tenantRequests')
          .where('carId', '==', request.carId)
          .where('landlordId', '==', request.landlordId)
          .get();

        const batch = firestore().batch();
        otherPending.docs
          .filter(d => d.id !== requestId && d.data().status === 'pending')
          .forEach(d => {
            batch.update(d.ref, { status: 'cancelled', respondedAt: firestore.FieldValue.serverTimestamp() });
          });
        await batch.commit();
      } catch (cancelError) {
        // Nao critico — o carro ja esta corretamente atribuido
        console.warn('Nao foi possivel cancelar outros requests pendentes:', cancelError);
      }

      // Notificar locador
      await notificationService.createNotification(
        request.landlordId,
        'Solicitacao Aceita',
        `O locatario aceitou a atribuicao do carro ${request.carInfo}.`,
        { type: 'request_accepted', carId: request.carId }
      );

      return { success: true };
    } catch (error) {
      console.error('Accept request error:', error);
      return { success: false, error: error.message };
    }
  },

  // Recusar solicitacao
  rejectRequest: async (requestId, landlordId, carInfo, carId) => {
    try {
      await firestore().collection('tenantRequests').doc(requestId).update({
        status: 'rejected',
        respondedAt: firestore.FieldValue.serverTimestamp(),
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
      await firestore().collection('tenantRequests').doc(requestId).update({
        status: 'cancelled',
        respondedAt: firestore.FieldValue.serverTimestamp(),
      });
      return { success: true };
    } catch (error) {
      console.error('Cancel request error:', error);
      return { success: false, error: error.message };
    }
  },
};
