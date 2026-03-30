/**
 * @format
 *
 * Smoke test: verifica que o App renderiza sem crashar.
 *
 * Todas as dependencias externas (Firebase, servicos, telas) sao mockadas
 * porque o Jest nao tem runtime nativo. O objetivo e garantir que o
 * componente App monta, executa o fluxo de auth e renderiza a arvore de
 * navegacao sem lancar excecoes.
 */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

// ── Firebase ──────────────────────────────────────────────────────────────────

const mockOnAuthStateChanged = jest.fn((cb) => {
  // Simula usuario nao autenticado (estado inicial mais comum)
  cb(null);
  return jest.fn(); // unsubscribe
});

jest.mock('@react-native-firebase/auth', () =>
  jest.fn(() => ({
    currentUser:          null,
    onAuthStateChanged:   mockOnAuthStateChanged,
    signOut:              jest.fn().mockResolvedValue(undefined),
  }))
);

jest.mock('@react-native-firebase/firestore', () => {
  const docMock = jest.fn(() => ({
    get:        jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
    set:        jest.fn().mockResolvedValue(undefined),
    update:     jest.fn().mockResolvedValue(undefined),
    onSnapshot: jest.fn(() => jest.fn()),
  }));
  const colMock = jest.fn(() => ({ doc: docMock, where: jest.fn() }));
  const fsMock  = jest.fn(() => ({ collection: colMock }));
  fsMock.FieldValue = { serverTimestamp: jest.fn(() => 'TS') };
  return fsMock;
});

jest.mock('@react-native-firebase/messaging', () =>
  jest.fn(() => ({
    getToken:              jest.fn().mockResolvedValue('mock-token'),
    onMessage:             jest.fn(() => jest.fn()),
    onNotificationOpenedApp: jest.fn(() => jest.fn()),
    requestPermission:     jest.fn().mockResolvedValue(1),
    setBackgroundMessageHandler: jest.fn(),
  }))
);

jest.mock('@react-native-firebase/functions', () =>
  jest.fn(() => ({
    httpsCallable: jest.fn(() => jest.fn().mockResolvedValue({ data: {} })),
  }))
);

jest.mock('@react-native-firebase/app', () => ({
  default: { initializeApp: jest.fn() },
}));

// ── Google Sign-In ────────────────────────────────────────────────────────────

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure:    jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn:       jest.fn(),
    signOut:      jest.fn(),
    getCurrentUser: jest.fn().mockReturnValue(null),
  },
}));

// ── Servicos ──────────────────────────────────────────────────────────────────

jest.mock('../src/services/authService', () => ({
  authService: {
    configureGoogleSignIn:  jest.fn(),
    onAuthStateChanged:     mockOnAuthStateChanged,
    getCurrentUser:         jest.fn().mockReturnValue(null),
    getCurrentUserProfile:  jest.fn().mockResolvedValue({ success: false }),
    signOut:                jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../src/services/notificationService', () => ({
  notificationService: {
    initialize:    jest.fn().mockResolvedValue(undefined),
    removeToken:   jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../src/services/permissionService', () => ({
  permissionService: {
    hasRequestedPermissions: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../src/services/navigationService', () => ({
  navigationRef: { current: null },
}));

// ── Config Firebase ───────────────────────────────────────────────────────────

jest.mock('../src/config/firebase', () => ({
  auth:      jest.fn(() => ({ currentUser: null, onAuthStateChanged: mockOnAuthStateChanged })),
  firestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }) })),
    })),
  })),
}));

// ── Telas (null components — nao testamos conteudo aqui) ──────────────────────

const mockScreen = () => null;

jest.mock('../src/screens/LoginScreen',         () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/RegisterScreen',       () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/EmailVerificationScreen', () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/GoogleCompleteProfileScreen', () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/PermissionsScreen',    () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/HomeScreen',           () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/TasksScreen',          () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/ProfileScreen',        () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/AddCarScreen',         () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/EditCarScreen',        () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/CarDetailsScreen',     () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/TaskDetailsScreen',    () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/TenantDetailsScreen',  () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/AssignTenantScreen',   () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/MuralManagerScreen',   () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/PaymentContractScreen', () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/ChargesScreen',        () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/PaymentDetailsScreen', () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/ContractDetailsScreen', () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/FinancialDashboardScreen', () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/TenantPaymentsScreen', () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/AddExpenseScreen',     () => ({ __esModule: true, default: mockScreen }));
jest.mock('../src/screens/VehicleHistoryScreen', () => ({ __esModule: true, default: mockScreen }));

// ── Componentes nativos ───────────────────────────────────────────────────────

jest.mock('../src/components/icons/MdiIcons', () => ({
  MdiCar:  () => null,
  MdiCash: () => null,
}));

jest.mock('react-native-flash-message', () => ({
  __esModule: true,
  default: () => null,
  showMessage: jest.fn(),
}));

jest.mock('lucide-react-native', () => ({
  ClipboardList: () => null,
  Megaphone:     () => null,
  BarChart3:     () => null,
  User:          () => null,
  Car:           () => null,
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const insets = { top: 0, bottom: 0, left: 0, right: 0 };
  const SafeAreaInsetsContext = React.createContext(insets);
  const SafeAreaFrameContext  = React.createContext({ x: 0, y: 0, width: 390, height: 844 });
  return {
    SafeAreaProvider:      ({ children }: any) => children,
    SafeAreaView:          ({ children }: any) => children,
    SafeAreaInsetsContext,
    SafeAreaFrameContext,
    useSafeAreaInsets:     () => insets,
    useSafeAreaFrame:      () => ({ x: 0, y: 0, width: 390, height: 844 }),
    initialWindowMetrics:  { insets, frame: { x: 0, y: 0, width: 390, height: 844 } },
  };
});

// ── Teste ─────────────────────────────────────────────────────────────────────

test('App renderiza sem crashar (usuario nao autenticado)', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});

  let renderer: ReactTestRenderer.ReactTestRenderer;

  await act(async () => {
    const App = require('../App').default;
    renderer = ReactTestRenderer.create(<App />);
    await new Promise(r => setImmediate(r));
  });

  // A arvore deve existir e ter pelo menos um elemento
  expect(renderer!.toJSON()).not.toBeNull();

  (console.error as jest.Mock).mockRestore?.();
  (console.warn as jest.Mock).mockRestore?.();
});

test('App chama configureGoogleSignIn na inicializacao', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});

  const { authService } = require('../src/services/authService');

  await act(async () => {
    const App = require('../App').default;
    ReactTestRenderer.create(<App />);
    await new Promise(r => setImmediate(r));
  });

  expect(authService.configureGoogleSignIn).toHaveBeenCalled();

  (console.error as jest.Mock).mockRestore?.();
  (console.warn as jest.Mock).mockRestore?.();
});
