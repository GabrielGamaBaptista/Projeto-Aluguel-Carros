// src/services/permissionService.js
// Centraliza solicitacao de permissoes do app
import { Platform, PermissionsAndroid, NativeModules, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PERMISSIONS_KEY = '@permissions_requested';

export const permissionService = {
  // Solicitar permissoes runtime upfront (camera + notificacoes)
  // READ_MEDIA_IMAGES e READ_EXTERNAL_STORAGE sao omitidos aqui porque:
  // - Android 14+: READ_MEDIA_IMAGES abre o seletor de fotos (acesso parcial), nao um dialogo simples
  // - react-native-image-picker ja solicita acesso a galeria internamente quando necessario
  requestAllPermissions: async () => {
    if (Platform.OS !== 'android') return {};

    const apiLevel = Number(Platform.Version);
    const permissions = [PermissionsAndroid.PERMISSIONS.CAMERA];

    if (apiLevel >= 33) {
      permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }

    try {
      const results = await PermissionsAndroid.requestMultiple(permissions);
      console.log('Permissoes solicitadas:', results);
      return results;
    } catch (error) {
      console.error('Erro ao solicitar permissoes:', error);
    }
  },

  // Abrir configuracoes de otimizacao de bateria
  openBatterySettings: async () => {
    const { BatteryOptimization } = NativeModules;
    if (!BatteryOptimization) {
      console.warn('Modulo BatteryOptimization nao disponivel');
      return;
    }
    try {
      const isIgnoring = await BatteryOptimization.isIgnoring();
      if (!isIgnoring) {
        await BatteryOptimization.requestIgnore();
      }
    } catch (error) {
      console.error('Erro ao abrir configuracoes de bateria:', error);
    }
  },

  // Verificar se otimizacao de bateria ja esta desativada
  isBatteryOptimizationIgnored: async () => {
    const { BatteryOptimization } = NativeModules;
    if (!BatteryOptimization) return true;
    try {
      return await BatteryOptimization.isIgnoring();
    } catch {
      return true;
    }
  },

  // Verificar se permissoes ja foram solicitadas anteriormente
  hasRequestedPermissions: async () => {
    try {
      const value = await AsyncStorage.getItem(PERMISSIONS_KEY);
      return value === 'true';
    } catch {
      return false;
    }
  },

  // Marcar que permissoes ja foram solicitadas (para nao mostrar de novo)
  markPermissionsRequested: async () => {
    try {
      await AsyncStorage.setItem(PERMISSIONS_KEY, 'true');
    } catch (error) {
      console.error('Erro ao salvar flag de permissoes:', error);
    }
  },
};
