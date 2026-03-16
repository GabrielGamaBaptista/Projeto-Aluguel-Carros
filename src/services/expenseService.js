import { firestore, auth } from '../config/firebase';

const expenseService = {
  createExpense: async (data) => {
    try {
      const uid = auth().currentUser?.uid;
      if (!uid) return { success: false, error: 'Usuario nao autenticado' };

      const docRef = await firestore().collection('expenses').add({
        ...data,
        landlordId: uid,
        createdAt: firestore.FieldValue.serverTimestamp(),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });

      return { success: true, data: { id: docRef.id } };
    } catch (error) {
      console.error('Error creating expense:', error);
      return { success: false, error: error.message };
    }
  },

  getExpensesByLandlord: async (landlordId) => {
    try {
      const snapshot = await firestore()
        .collection('expenses')
        .where('landlordId', '==', landlordId)
        .get();

      const expenses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return { success: true, data: expenses.sort((a, b) => (b.date || '').localeCompare(a.date || '')) };
    } catch (error) {
      console.error('Error getting expenses:', error);
      return { success: false, error: error.message };
    }
  },

  getExpensesByCar: async (carId) => {
    try {
      const uid = auth().currentUser?.uid;
      if (!uid) return { success: false, error: 'Usuario nao autenticado' };

      // 2 campos where (permitido sem composite index)
      // Necessario incluir landlordId na query para satisfazer Firestore rules
      const snapshot = await firestore()
        .collection('expenses')
        .where('carId', '==', carId)
        .where('landlordId', '==', uid)
        .get();

      const expenses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return { success: true, data: expenses.sort((a, b) => (b.date || '').localeCompare(a.date || '')) };
    } catch (error) {
      console.error('Error getting expenses by car:', error);
      return { success: false, error: error.message };
    }
  },

  editExpense: async (expenseId, data) => {
    try {
      // Strip campos imutaveis para evitar sobrescrita acidental
      const { landlordId, createdAt, ...safeData } = data;
      await firestore().collection('expenses').doc(expenseId).update({
        ...safeData,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      return { success: true };
    } catch (error) {
      console.error('Error editing expense:', error);
      return { success: false, error: error.message };
    }
  },

  deleteExpense: async (expenseId) => {
    try {
      await firestore().collection('expenses').doc(expenseId).delete();
      return { success: true };
    } catch (error) {
      console.error('Error deleting expense:', error);
      return { success: false, error: error.message };
    }
  },

  getCustomCategories: async (landlordId) => {
    try {
      const snapshot = await firestore()
        .collection('customExpenseCategories')
        .where('landlordId', '==', landlordId)
        .get();

      const categories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return { success: true, data: categories };
    } catch (error) {
      console.error('Error getting custom categories:', error);
      return { success: false, error: error.message };
    }
  },

  createCustomCategory: async (data) => {
    try {
      const uid = auth().currentUser?.uid;
      if (!uid) return { success: false, error: 'Usuario nao autenticado' };

      const docRef = await firestore().collection('customExpenseCategories').add({
        ...data,
        landlordId: uid,
        createdAt: firestore.FieldValue.serverTimestamp(),
      });

      return { success: true, data: { id: docRef.id } };
    } catch (error) {
      console.error('Error creating custom category:', error);
      return { success: false, error: error.message };
    }
  },

  deleteCustomCategory: async (categoryId) => {
    try {
      await firestore().collection('customExpenseCategories').doc(categoryId).delete();
      return { success: true };
    } catch (error) {
      console.error('Error deleting custom category:', error);
      return { success: false, error: error.message };
    }
  },
};

export default expenseService;
