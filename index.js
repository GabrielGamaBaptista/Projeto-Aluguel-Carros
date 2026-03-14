// index.js - Ponto de entrada obrigatório do React Native
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import messaging from '@react-native-firebase/messaging';

// Obrigatorio para receber notificacoes com o app completamente fechado (estado "quit").
// Deve ser registrado fora de qualquer componente React, no nivel do modulo.
messaging().setBackgroundMessageHandler(async _remoteMessage => {
  // O sistema Android ja exibe a notificacao automaticamente quando ha payload
  // "notification" na mensagem. Nao e necessario fazer nada aqui para exibicao.
  // Este handler precisa existir para o React Native Firebase inicializar o
  // Headless JS task corretamente em estado "quit".
});

AppRegistry.registerComponent(appName, () => App);
