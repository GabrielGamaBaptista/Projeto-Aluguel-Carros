// src/services/usersService.js
import { firestore } from '../config/firebase';
import functions from '@react-native-firebase/functions';

const fn = () => functions();

export const usersService = {
  // Obter todos os locatários disponíveis
  getAvailableTenants: async () => {
    try {
      const snapshot = await firestore()
        .collection('users')
        .where('role', '==', 'locatario')
        .get();
      
      const tenants = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      
      return { success: true, data: tenants };
    } catch (error) {
      console.error('Get tenants error:', error);
      return { success: false, error: error.message };
    }
  },

  // Obter usuário por ID
  getUserById: async (userId) => {
    try {
      const doc = await firestore().collection('users').doc(userId).get();
      if (doc.exists) {
        return { success: true, data: { id: doc.id, ...doc.data() } };
      } else {
        return { success: false, error: 'User not found' };
      }
    } catch (error) {
      console.error('Get user error:', error);
      return { success: false, error: error.message };
    }
  },

  // Obter dados completos (publico + PII) de um locatario via Cloud Function segura (Q1.2).
  // Apenas o locador de um carro atribuido ao locatario pode chamar.
  getTenantDetails: async (tenantId) => {
    try {
      const getTenantDetailsFn = fn().httpsCallable('getTenantDetailsCF');
      const result = await getTenantDetailsFn({ tenantId });
      return result.data;
    } catch (error) {
      console.error('Get tenant details error:', error);
      return { success: false, error: error.message };
    }
  },

  // Buscar usuários por email (para atribuir locatário)
  searchUsersByEmail: async (emailQuery) => {
    try {
      const snapshot = await firestore()
        .collection('users')
        .where('role', '==', 'locatario')
        .where('email', '>=', emailQuery)
        .where('email', '<=', emailQuery + '\uf8ff')
        .limit(10)
        .get();
      
      const users = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      
      return { success: true, data: users };
    } catch (error) {
      console.error('Search users error:', error);
      return { success: false, error: error.message };
    }
  },
};
