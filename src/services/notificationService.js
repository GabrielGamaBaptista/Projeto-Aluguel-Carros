// src/services/notificationService.js
// Gerenciamento de push notifications com Firebase Cloud Messaging
import { firestore } from '../config/firebase';
import { Platform, Alert } from 'react-native';

let messaging = null;
let _listenersRegistered = false; // listeners registrados apenas uma vez por sessao
let _currentUserId = null;        // userId ativo para onTokenRefresh
let _unsubscribers = [];          // funcoes de cleanup dos listeners

// Inicializar messaging de forma segura
const getMessaging = () => {
  if (!messaging) {
    try {
      messaging = require('@react-native-firebase/messaging').default;
    } catch (e) {
      console.warn('Firebase Messaging nao disponivel:', e.message);
    }
  }
  return messaging;
};

export const notificationService = {
  // Inicializar notificacoes (chamar no App.tsx apos login)
  initialize: async (userId) => {
    const msg = getMessaging();
    if (!msg) return;

    try {
      // 1. Criar canal de notificacao — idempotente, pode rodar mais de uma vez
      if (Platform.OS === 'android') {
        await msg().android?.createChannel?.({
          id: 'tarefas',
          name: 'Tarefas e Notificacoes',
          importance: 4, // HIGH
          sound: 'default',
          vibration: true,
        });
      }

      // 2. Obter e salvar FCM token — sempre executa para garantir token valido no Firestore
      // (o token pode ter sido invalidado por reinstalacao ou erro de envio)
      _currentUserId = userId;
      const token = await msg().getToken();
      if (token && userId) {
        await notificationService.saveToken(userId, token);
        console.log('FCM token salvo:', token.substring(0, 20) + '...');
      }

      // 3. Registrar listeners apenas uma vez por sessao
      if (_listenersRegistered) return;
      _listenersRegistered = true;

      // Listener para refresh de token — usa _currentUserId para sempre salvar no usuario ativo
      const unsubRefresh = msg().onTokenRefresh(async (newToken) => {
        if (_currentUserId) await notificationService.saveToken(_currentUserId, newToken);
      });
      _unsubscribers.push(unsubRefresh);

      // Handler para notificacoes em foreground
      const unsubMessage = msg().onMessage(async (remoteMessage) => {
        if (remoteMessage?.notification) {
          Alert.alert(
            remoteMessage.notification.title || 'Nova Notificacao',
            remoteMessage.notification.body || '',
            [{ text: 'OK' }]
          );
        }
      });
      _unsubscribers.push(unsubMessage);

      // Handler para quando usuario toca na notificacao (app em background)
      const unsubOpenedApp = msg().onNotificationOpenedApp((remoteMessage) => {
        console.log('Notificacao aberta do background:', remoteMessage);
      });
      _unsubscribers.push(unsubOpenedApp);

      // Checar se app foi aberto por notificacao (app estava fechado)
      const initialNotification = await msg().getInitialNotification();
      if (initialNotification) {
        console.log('App aberto por notificacao:', initialNotification);
      }
    } catch (error) {
      console.error('Erro ao inicializar notificacoes:', error);
    }
  },

  // Salvar FCM token no Firestore
  saveToken: async (userId, token) => {
    try {
      await firestore().collection('users').doc(userId).update({
        fcmToken: token,
        fcmTokenUpdatedAt: firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error('Erro ao salvar FCM token:', error);
    }
  },

  // Remover token ao fazer logout
  removeToken: async (userId) => {
    _listenersRegistered = false;
    _currentUserId = null;
    _unsubscribers.forEach(fn => { try { fn?.(); } catch (_) {} });
    _unsubscribers = [];
    try {
      await firestore().collection('users').doc(userId).update({
        fcmToken: null,
        fcmTokenUpdatedAt: firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error('Erro ao remover FCM token:', error);
    }
  },

  // Criar notificacao no Firestore (Cloud Function envia o push)
  createNotification: async (targetUserId, title, body, data = {}) => {
    try {
      await firestore().collection('notifications').add({
        userId: targetUserId,
        title,
        body,
        data,
        read: false,
        sent: false,
        createdAt: firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error('Erro ao criar notificacao:', error);
    }
  },
};
