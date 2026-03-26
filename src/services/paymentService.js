import { firestore, auth } from '../config/firebase';
import functions from '@react-native-firebase/functions';

const fn = () => functions();

/**
 * Service to manage payments and contracts using Asaas and Firebase.
 */
const paymentService = {
  /**
   * Checks if the user has an Asaas account created (stored in Firestore).
   * @returns {Promise<{exists: boolean, data: object|null}>}
   */
  checkOnboarding: async () => {
    try {
      const checkOnboardingFn = fn().httpsCallable('checkOnboarding');
      const result = await checkOnboardingFn();
      return result.data;
    } catch (error) {
      console.error('[checkOnboarding] ERROR code:', error.code);
      console.error('[checkOnboarding] ERROR message:', error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * Calls the Cloud Function to create an Asaas subaccount for the current user.
   * @returns {Promise<{success: boolean, accountId: string, walletId: string}>}
   */
  createSubaccount: async () => {
    try {
      const createAsaasSubaccount = fn().httpsCallable('createAsaasSubaccount');
      const result = await createAsaasSubaccount();
      return result.data;
    } catch (error) {
      console.error('Error creating subaccount:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Saves a rental contract by calling the Cloud Function.
   * @param {object} contractData - The contract details.
   * @returns {Promise<{success: boolean, contractId: string}>}
   */
  createContract: async (contractData) => {
    try {
      const createContractFn = fn().httpsCallable('createContractCF');
      const result = await createContractFn(contractData);
      return result.data;
    } catch (error) {
      console.error('Error creating contract:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Calls the Cloud Function to create a charge in Asaas.
   * @param {object} chargeData - The charge details.
   * @returns {Promise<any>}
   */
  createCharge: async (chargeData) => {
    try {
      const createChargeFn = fn().httpsCallable('createCharge');
      const result = await createChargeFn(chargeData);
      return result.data;
    } catch (error) {
      console.error('Error creating charge:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Fetches charges related to a specific car and sorts them by due date.
   * @param {string} carId - The ID of the car.
   * @returns {Promise<Array>}
   */
  getChargesByCar: async (carId) => {
    try {
      const uid = auth().currentUser?.uid;
      if (!uid) return [];

      // Query direta com carId (Q3.1 — usa indice composto landlordId+carId+dueDate)
      const snapshot = await firestore()
        .collection('charges')
        .where('landlordId', '==', uid)
        .where('carId', '==', carId)
        .orderBy('dueDate', 'desc')
        .get();

      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error getting charges by car:', error);
      return [];
    }
  },

  /**
   * Fetches charges where the current user is the tenant.
   * @returns {Promise<Array>}
   */
  getTenantCharges: async () => {
    try {
      const uid = auth().currentUser?.uid;
      if (!uid) throw new Error('User not authenticated');

      const snapshot = await firestore()
        .collection('charges')
        .where('tenantId', '==', uid)
        .get();

      const charges = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Client-side sort: dueDate desc
      return charges.sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate));
    } catch (error) {
      console.error('Error getting tenant charges:', error);
      return [];
    }
  },

  /**
   * Fetches charges for the current tenant with cursor-based pagination (Q3.2).
   * Requires index: charges | tenantId ASC + dueDate DESC.
   * @param {object} [opts]
   * @param {number} [opts.pageSize=20]
   * @param {DocumentSnapshot|null} [opts.startAfter=null]
   * @returns {Promise<{data: Array, lastDoc: DocumentSnapshot|null, hasMore: boolean}>}
   */
  getTenantChargesPaginated: async ({ pageSize = 20, startAfter = null } = {}) => {
    try {
      const uid = auth().currentUser?.uid;
      if (!uid) throw new Error('User not authenticated');

      let query = firestore()
        .collection('charges')
        .where('tenantId', '==', uid)
        .orderBy('dueDate', 'desc')
        .limit(pageSize);

      if (startAfter) {
        query = query.startAfter(startAfter);
      }

      const snapshot = await query.get();
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const lastDoc = snapshot.docs[snapshot.docs.length - 1] || null;
      const hasMore = snapshot.docs.length === pageSize;

      return { data, lastDoc, hasMore };
    } catch (error) {
      console.error('Error getting tenant charges paginated:', error);
      return { data: [], lastDoc: null, hasMore: false };
    }
  },

  /**
   * Calls the Cloud Function to get the Pix QR Code for a charge.
   * @param {string} chargeId - The Asaas charge ID.
   * @returns {Promise<{encodedImage: string, payload: string}>}
   */
  getPixQrCode: async (chargeId) => {
    try {
      const getPixQrCodeFn = fn().httpsCallable('getPixQrCode');
      const result = await getPixQrCodeFn({ chargeId });
      return result.data;
    } catch (error) {
      console.error('Error getting Pix QR Code:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Calls the Cloud Function to cancel a charge in Asaas.
   * @param {string} chargeId - The Asaas charge ID.
   * @returns {Promise<{success: boolean}>}
   */
  cancelCharge: async (chargeId) => {
    try {
      const cancelChargeFn = fn().httpsCallable('cancelCharge');
      const result = await cancelChargeFn({ chargeId });
      return result.data;
    } catch (error) {
      console.error('Error cancelling charge:', error);
      return { success: false, error: error.message };
    }
  },

  editCharge: async (chargeId, { newAmount, newDueDate } = {}) => {
    try {
      const editChargeFn = fn().httpsCallable('editCharge');
      const result = await editChargeFn({ chargeId, newAmount, newDueDate });
      return result.data;
    } catch (error) {
      console.error('Error editing charge:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Cancels the active contract for a car and all its PENDING/OVERDUE charges.
   * Delegates to the cancelContract Cloud Function for atomic server-side execution.
   * @param {string} carId
   * @returns {Promise<{success: boolean, cancelled: boolean}>}
   */
  cancelActiveContractByCar: async (carId) => {
    try {
      const cancelContractFn = fn().httpsCallable('cancelContract');
      const result = await cancelContractFn({ carId });
      return result.data;
    } catch (error) {
      console.error('Error cancelling active contract by car:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Edits the rentAmount of an active rental contract.
   * @param {string} contractId
   * @param {{ rentAmount: number }} options
   * @returns {Promise<{success: boolean}>}
   */
  editContract: async (contractId, { rentAmount } = {}) => {
    try {
      const editContractFn = fn().httpsCallable('editContract');
      const result = await editContractFn({ contractId, rentAmount });
      return result.data;
    } catch (error) {
      console.error('Error editing contract:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Pausa ou retoma um contrato ativo (Q5.12).
   * Contratos pausados nao geram cobranças recorrentes no cron.
   * @param {string} contractId
   * @returns {Promise<{success: boolean, paused: boolean}>}
   */
  pauseContract: async (contractId) => {
    try {
      const pauseContractFn = fn().httpsCallable('pauseContract');
      const result = await pauseContractFn({ contractId });
      return result.data;
    } catch (error) {
      console.error('Error pausing/resuming contract:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Deletes an inactive rental contract document from Firestore.
   * Should only be called for contracts with active === false.
   * @param {string} contractId
   * @returns {Promise<{success: boolean}>}
   */
  deleteContract: async (contractId) => {
    try {
      await firestore().collection('rentalContracts').doc(contractId).delete();
      return { success: true };
    } catch (error) {
      console.error('Error deleting contract:', error);
      return { success: false, error: error.message };
    }
  },

  getPendingChargeByContract: async (contractId) => {
    try {
      const uid = auth().currentUser?.uid;
      if (!uid) return null;
      const snapshot = await firestore()
        .collection('charges')
        .where('contractId', '==', contractId)
        .where('landlordId', '==', uid)
        .get();
      const pending = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(c => c.status === 'PENDING')
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      return pending.length > 0 ? pending[0] : null;
    } catch (error) {
      console.error('Error getting pending charge by contract:', error);
      return null;
    }
  },

  getAllContractsForLandlord: async () => {
    try {
      const uid = auth().currentUser?.uid;
      if (!uid) return [];
      const snapshot = await firestore()
        .collection('rentalContracts')
        .where('landlordId', '==', uid)
        .get();
      const contracts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return contracts.sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);
      });
    } catch (error) {
      console.error('Error getting all contracts:', error);
      return [];
    }
  },

  getAllChargesForLandlord: async () => {
    try {
      const uid = auth().currentUser?.uid;
      if (!uid) return [];
      const snapshot = await firestore()
        .collection('charges')
        .where('landlordId', '==', uid)
        .get();
      const charges = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return charges.sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate));
    } catch (error) {
      console.error('Error getting all charges:', error);
      return [];
    }
  },

  getDashboardSummary: (charges) => {
    let totalReceived = 0;
    let totalPending = 0;
    let totalOverdue = 0;
    let countReceived = 0;
    let countPending = 0;
    let countOverdue = 0;
    const revenueByMonth = {};

    for (const charge of charges) {
      if (charge.status === 'CANCELLED') continue;
      if (charge.status === 'RECEIVED' || charge.status === 'CONFIRMED') {
        totalReceived += charge.amount || 0;
        countReceived++;
        const d = new Date(charge.paymentDate || charge.dueDate);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        revenueByMonth[key] = (revenueByMonth[key] || 0) + (charge.amount || 0);
      } else if (charge.status === 'PENDING') {
        totalPending += charge.amount || 0;
        countPending++;
      } else if (charge.status === 'OVERDUE') {
        totalOverdue += charge.amount || 0;
        countOverdue++;
      }
    }

    return {
      totalReceived, totalPending, totalOverdue,
      countReceived, countPending, countOverdue,
      revenueByMonth,
    };
  },

  getContractByCar: async (carId) => {
    try {
      const uid = auth().currentUser?.uid;
      if (!uid) return null;

      // Query as landlord (carId + landlordId — no composite index needed)
      let snapshot = await firestore()
        .collection('rentalContracts')
        .where('carId', '==', carId)
        .where('landlordId', '==', uid)
        .get();

      let found = snapshot.docs.find(doc => doc.data().active === true);
      if (found) return { id: found.id, ...found.data() };

      // Query as tenant (carId + tenantId — no composite index needed)
      snapshot = await firestore()
        .collection('rentalContracts')
        .where('carId', '==', carId)
        .where('tenantId', '==', uid)
        .get();

      found = snapshot.docs.find(doc => doc.data().active === true);
      if (found) return { id: found.id, ...found.data() };

      return null;
    } catch (error) {
      console.error('Error getting contract by car:', error);
      return null;
    }
  },

  // Retorna o contrato ativo do locatario autenticado (usado em TenantPaymentsScreen — Q5.7)
  getActiveContractForTenant: async () => {
    try {
      const uid = auth().currentUser?.uid;
      if (!uid) return null;
      const snapshot = await firestore()
        .collection('rentalContracts')
        .where('tenantId', '==', uid)
        .where('active', '==', true)
        .limit(1)
        .get();
      if (snapshot.empty) return null;
      const doc = snapshot.docs[0];
      return { id: doc.id, ...doc.data() };
    } catch (error) {
      console.error('Error getting active contract for tenant:', error);
      return null;
    }
  },
};

export default paymentService;
