// src/services/carsService.js
import { firestore } from '../config/firebase';
import { tasksService } from './tasksService';
import paymentService from './paymentService';
import { notificationService } from './notificationService';

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
      return { success: true };
    } catch (error) {
      console.error('Update car error:', error);
      return { success: false, error: error.message };
    }
  },

  deleteCar: async (carId) => {
    try {
      await tasksService.deleteTasksByCar(carId);
      await firestore().collection('cars').doc(carId).delete();
      return { success: true };
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
      const doc = await firestore().collection('cars').doc(carId).get();
      if (doc.exists) {
        return { success: true, data: { id: doc.id, ...doc.data() } };
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

  assignTenant: async (carId, tenantId) => {
    try {
      // Verificar se locatario ja tem carro
      const check = await carsService.checkTenantHasCar(tenantId, carId);
      if (check.hasCar) {
        return {
          success: false,
          error: `Este locatario ja esta atribuido ao carro ${check.carInfo}. Cada locatario so pode ter um carro.`,
        };
      }
      await firestore().collection('cars').doc(carId).update({
        tenantId: tenantId,
        status: 'rented',
        rentedAt: firestore.FieldValue.serverTimestamp(),
      });
      return { success: true };
    } catch (error) {
      console.error('Assign tenant error:', error);
      return { success: false, error: error.message };
    }
  },

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
