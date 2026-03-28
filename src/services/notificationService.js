// src/services/notificationService.js
// Gerenciamento de push notifications com Firebase Cloud Messaging
import { firestore } from '../config/firebase';
import functions from '@react-native-firebase/functions';
import { Platform } from 'react-native';
import { showMessage } from 'react-native-flash-message';
import { navigationRef } from './navigationService';

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

// FCM serializa todos os valores como string — converte "null"/"undefined" de volta para null
const parseFcmValue = (v) => (!v || v === 'null' || v === 'undefined') ? null : v;

// Aguarda o navigationRef estar pronto (max 3s) e navega para a tela correta
const handleDeepLink = async (data) => {
  if (!data?.type) return;
  let attempts = 0;
  while (!navigationRef.isReady() && attempts < 30) {
    await new Promise(r => setTimeout(r, 100));
    attempts++;
  }
  if (!navigationRef.isReady()) return;

  const carId = parseFcmValue(data.carId);
  const taskId = parseFcmValue(data.taskId);
  const chargeId = parseFcmValue(data.chargeId);
  const contractId = parseFcmValue(data.contractId);

  switch (data.type) {
    // Tasks — locatario e locador
    case 'new_task':
    case 'auto_task':
    case 'task_completed':
    case 'task_approved':
    case 'task_revision':
    case 'maintenance_request':
      if (taskId && carId) {
        navigationRef.navigate('TaskDetails', { taskId, carId });
      }
      break;

    // Solicitacoes de vinculo
    case 'request_accepted':
    case 'request_rejected':
      if (carId) {
        navigationRef.navigate('CarDetails', { carId });
      }
      break;
    case 'tenant_request':
      navigationRef.navigate('MainTabs', { screen: 'Home' });
      break;

    // Remocao de locatario / cancelamento
    case 'tenant_removed':
    case 'contract_cancelled':
      navigationRef.navigate('MainTabs', { screen: 'Home' });
      break;

    // Cobranças — locatario e locador
    case 'charge_created':
    case 'charge_overdue':
    case 'charge_overdue_landlord':
    case 'charge_due_soon':
    case 'payment_received':
    case 'payment_confirmed_tenant':
      if (chargeId) {
        navigationRef.navigate('PaymentDetails', { chargeId });
      }
      break;

    // Contratos — locatario
    case 'contract_created':
      if (contractId) {
        navigationRef.navigate('ContractDetails', { contractId });
      }
      break;

    // Mural — locatario
    case 'mural_post':
    case 'mural_updated':
      navigationRef.navigate('MainTabs', { screen: 'Home' });
      break;

    default:
      break;
  }
};

export const notificationService = {
  // Inicializar notificacoes (chamar no App.tsx apos login)
  initialize: async (userId) => {
    const msg = getMessaging();
    if (!msg) return;

    // Guard síncrono antes de qualquer await — evita race condition em chamadas paralelas
    const shouldRegisterListeners = !_listenersRegistered;
    if (shouldRegisterListeners) _listenersRegistered = true;

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

      // 3. Registrar listeners apenas na primeira chamada da sessao
      if (!shouldRegisterListeners) return;

      // Listener para refresh de token — usa _currentUserId para sempre salvar no usuario ativo
      const unsubRefresh = msg().onTokenRefresh(async (newToken) => {
        if (_currentUserId) await notificationService.saveToken(_currentUserId, newToken);
      });
      _unsubscribers.push(unsubRefresh);

      // Handler para notificacoes em foreground — exibe banner nao intrusivo
      const unsubMessage = msg().onMessage(async (remoteMessage) => {
        if (remoteMessage?.notification) {
          const notifData = remoteMessage.data || {};
          showMessage({
            message: remoteMessage.notification.title || 'Nova Notificacao',
            description: remoteMessage.notification.body || '',
            type: 'default',
            backgroundColor: '#4F46E5',
            color: '#FFFFFF',
            duration: 5000,
            floating: true,
            onPress: () => handleDeepLink(notifData),
          });
        }
      });
      _unsubscribers.push(unsubMessage);

      // Handler para quando usuario toca na notificacao (app em background)
      const unsubOpenedApp = msg().onNotificationOpenedApp((remoteMessage) => {
        if (remoteMessage?.data) {
          handleDeepLink(remoteMessage.data);
        }
      });
      _unsubscribers.push(unsubOpenedApp);

      // Checar se app foi aberto por notificacao (app estava fechado)
      const initialNotification = await msg().getInitialNotification();
      if (initialNotification?.data) {
        handleDeepLink(initialNotification.data);
      }
    } catch (error) {
      console.error('Erro ao inicializar notificacoes:', error);
    }
  },

  // Salvar FCM token no Firestore (SEC-04 Fase A: dual-write no doc publico + private/data)
  saveToken: async (userId, token) => {
    try {
      const payload = { fcmToken: token, fcmTokenUpdatedAt: firestore.FieldValue.serverTimestamp() };
      await Promise.all([
        firestore().collection('users').doc(userId).update(payload),
        firestore().collection('users').doc(userId).collection('private').doc('data').set(
          payload, { merge: true }
        ),
      ]);
    } catch (error) {
      console.error('Erro ao salvar FCM token:', error);
    }
  },

  // Remover token ao fazer logout (SEC-04 Fase A: limpar em ambos os locais)
  removeToken: async (userId) => {
    _listenersRegistered = false;
    _currentUserId = null;
    _unsubscribers.forEach(fn => { try { fn?.(); } catch (_) {} });
    _unsubscribers = [];
    try {
      const payload = { fcmToken: null, fcmTokenUpdatedAt: firestore.FieldValue.serverTimestamp() };
      await Promise.all([
        firestore().collection('users').doc(userId).update(payload),
        firestore().collection('users').doc(userId).collection('private').doc('data').set(
          payload, { merge: true }
        ),
      ]);
    } catch (error) {
      // Silencioso — pode falhar quando chamado apos signOut (auth ja revogado)
    }
  },

  // Criar notificacao via Cloud Function segura (SEC-01)
  // Substitui write direto ao Firestore — valida relacionamento server-side
  createNotification: async (targetUserId, title, body, data = {}) => {
    try {
      const createNotificationCF = functions().httpsCallable('createNotificationCF');
      await createNotificationCF({ targetUserId, title, body, data });
    } catch (error) {
      console.error('Erro ao criar notificacao:', error);
    }
  },
};
