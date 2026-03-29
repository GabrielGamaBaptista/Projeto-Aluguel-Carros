// src/services/usersService.js
import { firestore } from '../config/firebase';
import functions from '@react-native-firebase/functions';
import { withRetry } from '../utils/retry';
import { userCache } from '../utils/cache';

const fn = () => functions();

export const usersService = {
  // Obter usuário por ID (com cache de 5min em memória — Q3.6)
  // Nota SEC-09: leitura cross-user permitida apenas para landlord->tenant vinculado via currentLandlordId
  getUserById: async (userId) => {
    try {
      const cached = userCache.get(userId);
      if (cached) return { success: true, data: cached };

      const doc = await withRetry(() => firestore().collection('users').doc(userId).get());
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() };
        userCache.set(userId, data);
        return { success: true, data };
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
      const result = await withRetry(() => getTenantDetailsFn({ tenantId }));
      return result.data;
    } catch (error) {
      console.error('Get tenant details error:', error);
      return { success: false, error: error.message };
    }
  },

  // Buscar locatarios por email ou CPF via Cloud Function segura (Q1.6).
  // Substitui queries client-side diretas que expunham dados de todos os locatarios.
  searchTenants: async (query) => {
    try {
      const searchTenantsFn = fn().httpsCallable('searchTenantsCF');
      const result = await searchTenantsFn({ query });
      return { success: true, data: result.data };
    } catch (error) {
      console.error('Search tenants error:', error);
      return { success: false, error: error.message };
    }
  },
};
