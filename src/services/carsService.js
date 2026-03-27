// src/services/carsService.js
import { firestore } from '../config/firebase';
import { tasksService } from './tasksService';
import paymentService from './paymentService';
import { notificationService } from './notificationService';
import functions from '@react-native-firebase/functions';
import { withRetry } from '../utils/retry';
import { carCache } from '../utils/cache';

export const carsService = {
  addCar: async (carData) => {
    try {
      const docRef = await firestore().collection('cars').add({
        ...carData,
        createdAt: firestore.FieldValue.serverTimestamp(),
        status: 'available',
        tenantId: null,
        lastKmUpdate: firestore.FieldValue.serverTimestamp(),
        lastPhotoInspection: firestore.FieldValue.serverTimestamp(),
        totalKm: carData.initialKm || 0,
      });
      return { success: true, id: docRef.id };
    } catch (error) {
      console.error('Add car error:', error);
      return { success: false, error: error.message };
    }
  },

  updateCar: async (carId, updates) => {
    try {
      await firestore().collection('cars').doc(carId).update({
        ...updates,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      carCache.invalidate(carId);
      return { success: true };
    } catch (error) {
      console.error('Update car error:', error);
      return { success: false, error: error.message };
    }
  },

  // Exclusao com cascade completo via Cloud Function (Q2.3)
  deleteCar: async (carId) => {
    try {
      const deleteCarFn = functions().httpsCallable('deleteCarCF');
      const result = await deleteCarFn({ carId });
      carCache.invalidate(carId);
      return result.data;
    } catch (error) {
      console.error('Delete car error:', error);
      return { success: false, error: error.message };
    }
  },

  // Sem orderBy — ordena client-side
  getCarsByLandlord: async (landlordId) => {
    try {
      const snapshot = await firestore()
        .collection('cars')
        .where('landlordId', '==', landlordId)
        .get();

      const cars = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      cars.sort((a, b) => {
        const da = a.createdAt?.toDate?.() || new Date(0);
        const db = b.createdAt?.toDate?.() || new Date(0);
        return db - da;
      });
      return { success: true, data: cars };
    } catch (error) {
      console.error('Get cars error:', error);
      return { success: false, error: error.message };
    }
  },

  getCarById: async (carId) => {
    try {
      const cached = carCache.get(carId);
      if (cached) return { success: true, data: cached };

      const doc = await withRetry(() => firestore().collection('cars').doc(carId).get());
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() };
        carCache.set(carId, data);
        return { success: true, data };
      } else {
        return { success: false, error: 'Car not found' };
      }
    } catch (error) {
      console.error('Get car error:', error);
      return { success: false, error: error.message };
    }
  },

  // Verificar se locatario ja tem carro atribuido
  checkTenantHasCar: async (tenantId, excludeCarId = null) => {
    try {
      const snapshot = await firestore()
        .collection('cars')
        .where('tenantId', '==', tenantId)
        .get();

      const existingCars = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(car => car.id !== excludeCarId);

      if (existingCars.length > 0) {
        const existingCar = existingCars[0];
        return {
          hasCar: true,
          carInfo: `${existingCar.brand} ${existingCar.model} (${existingCar.plate})`,
        };
      }
      return { hasCar: false };
    } catch (error) {
      console.error('Check tenant car error:', error);
      return { hasCar: false };
    }
  },

  // assignTenant removido — funcionalidade movida para Cloud Function assignTenantCF (Q1.4)
  // Chamada via tenantRequestService.acceptRequest()

  removeTenant: async (carId) => {
    try {
      // Buscar dados do carro antes de remover (para notificacao)
      const carDoc = await firestore().collection('cars').doc(carId).get();
      const carData = carDoc.exists ? carDoc.data() : null;
      const tenantId = carData?.tenantId || null;

      // Cancela contrato ativo e cobranças pendentes antes de desatribuir
      const contractResult = await paymentService.cancelActiveContractByCar(carId);
      if (!contractResult.success) {
        console.warn('[removeTenant] Falha ao cancelar contrato ativo:', contractResult.error);
      }

      await firestore().collection('cars').doc(carId).update({
        tenantId: null,
        status: 'available',
        rentedAt: null,
      });
      carCache.invalidate(carId);
      await tasksService.deleteTasksByCar(carId);

      // Notificar locatario que foi removido do carro
      if (tenantId && carData) {
        const carInfo = `${carData.brand} ${carData.model} (${carData.plate})`;
        try {
          await notificationService.createNotification(
            tenantId,
            'Voce foi desatribuido do veiculo',
            `O locador encerrou sua atribuicao ao veiculo ${carInfo}.`,
            { type: 'tenant_removed', carId }
          );
        } catch (e) { console.error('Notif remove tenant error:', e); }
      }

      return { success: true };
    } catch (error) {
      console.error('Remove tenant error:', error);
      return { success: false, error: error.message };
    }
  },

  getRentedCars: async (tenantId) => {
    try {
      const snapshot = await firestore()
        .collection('cars')
        .where('tenantId', '==', tenantId)
        .get();

      const cars = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return { success: true, data: cars };
    } catch (error) {
      console.error('Get rented cars error:', error);
      return { success: false, error: error.message };
    }
  },

  // Subscribe sem orderBy — ordena no callback
  subscribeToCars: (landlordId, callback) => {
    return firestore()
      .collection('cars')
      .where('landlordId', '==', landlordId)
      .onSnapshot(
        snapshot => {
          const cars = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          cars.sort((a, b) => {
            const da = a.createdAt?.toDate?.() || new Date(0);
            const db = b.createdAt?.toDate?.() || new Date(0);
            return db - da;
          });
          callback(cars);
        },
        error => { console.error('Subscribe error:', error); }
      );
  },
};
