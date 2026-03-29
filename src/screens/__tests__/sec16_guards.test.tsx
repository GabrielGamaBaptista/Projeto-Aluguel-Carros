/**
 * Testes de integração — SEC-16: Guards de ownership nas telas de deep link
 *
 * Cobre:
 *  - PaymentDetailsScreen: redireciona para Home em permission-denied (onSnapshot)
 *  - PaymentDetailsScreen: chama goBack em erro de rede (onSnapshot)
 *  - PaymentDetailsScreen: NAO redireciona quando onSnapshot retorna documento valido
 *  - TaskDetailsScreen: navega para Home quando tarefa e inacessivel (loadTaskData)
 *  - ContractDetailsScreen: redireciona para Home em permission-denied (onSnapshot)
 *
 * Estrategia: mocks no nivel do modulo (sem resetModules para evitar
 * duplicidade de instancias React que quebra hooks). Callbacks do
 * onSnapshot sao capturados em variaveis mut veis e disparados manualmente.
 */

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

// ── Variaveis de controle dos mocks ───────────────────────────────────────────

const mockNavigate = jest.fn();
const mockGoBack   = jest.fn();

// Captura os callbacks do onSnapshot — ambas as fontes (rn-firebase e config/firebase)
// usam as mesmas variaveis; os testes sao sequenciais e limpam em beforeEach.
let mockSnapshotSuccess: ((snap: any) => void) | null = null;
let mockSnapshotError:   ((err: any)  => void) | null = null;

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@react-navigation/native', () => ({
  useNavigation:  () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute:       () => ({ params: { chargeId: 'charge001', charge: null } }),
  useFocusEffect: jest.fn(), // nao executa o callback para evitar re-renders
}));

// PaymentDetailsScreen importa firestore direto de @react-native-firebase/firestore
jest.mock('@react-native-firebase/firestore', () => {
  const mockOnSnapshot = jest.fn((successCb: any, errorCb: any) => {
    mockSnapshotSuccess = successCb;
    mockSnapshotError   = errorCb;
    return jest.fn(); // unsubscribe
  });
  const mockDocFn = jest.fn(() => ({
    onSnapshot: mockOnSnapshot,
    get:        jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
    update:     jest.fn().mockResolvedValue({}),
  }));
  return jest.fn(() => ({
    collection: jest.fn(() => ({ doc: mockDocFn })),
  }));
});

// ContractDetailsScreen e TaskDetailsScreen usam firestore de config/firebase
jest.mock('../../config/firebase', () => {
  const mockOnSnapshot = jest.fn((successCb: any, errorCb: any) => {
    mockSnapshotSuccess = successCb;
    mockSnapshotError   = errorCb;
    return jest.fn();
  });
  const mockDocFn = jest.fn(() => ({
    get:         jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
    update:      jest.fn().mockResolvedValue({}),
    onSnapshot:  mockOnSnapshot,
  }));
  const mockColFn = jest.fn(() => ({ doc: mockDocFn }));
  return {
    firestore: jest.fn(() => ({ collection: mockColFn })),
    auth:      jest.fn(() => ({ currentUser: { uid: 'user001' } })),
  };
});

jest.mock('../../services/authService', () => ({
  authService: {
    getCurrentUser:        jest.fn(() => ({ uid: 'user001' })),
    getCurrentUserProfile: jest.fn().mockResolvedValue({
      success: true,
      data: { uid: 'user001', role: 'locatario', name: 'Test User' },
    }),
  },
}));

jest.mock('../../services/paymentService', () => ({
  __esModule: true,
  default: {
    getPixQrCode:              jest.fn().mockResolvedValue({ success: false }),
    cancelCharge:              jest.fn().mockResolvedValue({ success: true }),
    editCharge:                jest.fn().mockResolvedValue({ success: true }),
    cancelActiveContractByCar: jest.fn().mockResolvedValue({ success: true }),
    getPendingChargeByContract: jest.fn().mockResolvedValue({ success: true, data: null }),
    editContract:              jest.fn().mockResolvedValue({ success: true }),
    pauseContract:             jest.fn().mockResolvedValue({ success: true }),
    deleteContract:            jest.fn().mockResolvedValue({ success: true }),
  },
}));

jest.mock('../../services/tasksService', () => ({
  tasksService: {
    getTaskById:            jest.fn().mockResolvedValue({ success: false, error: 'not found' }),
    getCarTasks:            jest.fn().mockResolvedValue({ success: true, data: [] }),
    generateAutomaticTasks: jest.fn().mockResolvedValue({}),
    deleteTasksByCar:       jest.fn().mockResolvedValue({}),
  },
  REQUIRED_PHOTO_ANGLES: [],
  PHOTO_ANGLE_LABELS:    {},
}));

jest.mock('../../services/carsService', () => ({
  carsService: {
    getCarById:        jest.fn().mockResolvedValue({ success: false, error: 'not found' }),
    checkTenantHasCar: jest.fn().mockResolvedValue({ hasCar: false }),
    removeTenant:      jest.fn().mockResolvedValue({ success: true }),
    updateCar:         jest.fn().mockResolvedValue({ success: true }),
  },
}));

jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn() },
}));

jest.mock('../../services/usersService', () => ({
  usersService: {
    getUserById: jest.fn().mockResolvedValue({ success: true, data: { name: 'Tenant' } }),
  },
}));

jest.mock('../../components/PhotoPicker',    () => () => null);
jest.mock('../../components/ImageViewer',    () => () => null);
jest.mock('../../components/PdfViewer',      () => () => null);
jest.mock('../../components/DocumentPicker', () => () => null);

jest.mock('react-native-flash-message', () => ({
  showMessage: jest.fn(),
  default:     () => null,
}));

jest.mock('lucide-react-native', () => ({
  Eye: () => null, AlertTriangle: () => null, CheckCircle2: () => null,
  Wrench: () => null, Car: () => null, ClipboardList: () => null,
  ChevronRight: () => null, X: () => null, ChevronDown: () => null,
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  default: { setString: jest.fn() },
}));

jest.mock('@react-native-firebase/functions', () =>
  jest.fn(() => ({
    httpsCallable: jest.fn(() => jest.fn().mockResolvedValue({ data: {} })),
  }))
);

jest.mock('../../utils/cache', () => ({
  carCache:  { get: jest.fn().mockReturnValue(null), set: jest.fn(), invalidate: jest.fn() },
  userCache: { get: jest.fn().mockReturnValue(null), set: jest.fn(), invalidate: jest.fn() },
}));

jest.mock('../../utils/retry', () => ({
  withRetry: jest.fn((fn: any) => fn()),
}));

// ── Imports (apos todos os mocks) ─────────────────────────────────────────────

import PaymentDetailsScreen  from '../PaymentDetailsScreen';
import TaskDetailsScreen     from '../TaskDetailsScreen';
import ContractDetailsScreen from '../ContractDetailsScreen';

// ── Contrato de exemplo para ContractDetailsScreen ───────────────────────────

const INITIAL_CONTRACT = {
  id:         'contract001',
  contractId: 'contract001',
  carId:      'car001',
  tenantId:   'user001',
  landlordId: 'landlord001',
  rentAmount: 1500,
  frequency:  'MONTHLY',
  billingType: 'PIX',
  active:     true,
  carInfo:    'Toyota Corolla (ABC1D23)',
  tenantName: 'Test Tenant',
  landlordName: 'Test Landlord',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const flushPromises = () => new Promise(r => setImmediate(r));

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockSnapshotSuccess = null;
  mockSnapshotError   = null;

  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(
    (_title: string, _msg?: string, buttons?: any[]) => {
      buttons?.[0]?.onPress?.();
    }
  );

  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
  (console.error as jest.Mock).mockRestore?.();
  (console.warn as jest.Mock).mockRestore?.();
});

// ── PaymentDetailsScreen — onSnapshot error callback ─────────────────────────

describe('PaymentDetailsScreen — SEC-16: guards no onSnapshot', () => {
  test('redireciona para Home quando onSnapshot recebe permission-denied', async () => {
    await act(async () => {
      ReactTestRenderer.create(<PaymentDetailsScreen />);
      await flushPromises();
    });

    expect(mockSnapshotError).not.toBeNull();

    await act(async () => {
      mockSnapshotError!({ code: 'permission-denied', message: 'Insufficient permissions.' });
      await flushPromises();
    });

    expect(Alert.alert).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'Home' });
  });

  test('chama goBack quando onSnapshot recebe erro de rede (nao permission-denied)', async () => {
    await act(async () => {
      ReactTestRenderer.create(<PaymentDetailsScreen />);
      await flushPromises();
    });

    await act(async () => {
      mockSnapshotError!({ code: 'unavailable', message: 'Network error.' });
      await flushPromises();
    });

    expect(mockGoBack).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalledWith('MainTabs', { screen: 'Home' });
  });

  test('NAO navega quando onSnapshot retorna documento valido', async () => {
    await act(async () => {
      ReactTestRenderer.create(<PaymentDetailsScreen />);
      await flushPromises();
    });

    await act(async () => {
      mockSnapshotSuccess!({
        exists: true,
        id:     'charge001',
        data:   () => ({
          amount: 1000, status: 'PENDING', dueDate: '2026-04-01',
          tenantId: 'user001', landlordId: 'landlord001', billingType: 'PIX',
        }),
      });
      await flushPromises();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});

// ── TaskDetailsScreen — guard em loadTaskData ─────────────────────────────────

describe('TaskDetailsScreen — SEC-16: guard quando tarefa e inacessivel', () => {
  test('navega para Home quando getTaskById retorna success:false', async () => {
    await act(async () => {
      ReactTestRenderer.create(
        <TaskDetailsScreen
          route={{ params: { taskId: 'task001', carId: 'car001' } }}
          navigation={{ navigate: mockNavigate, goBack: mockGoBack }}
        />
      );
      await flushPromises();
    });

    expect(Alert.alert).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'Home' });
  });

});

// ── ContractDetailsScreen — onSnapshot error callback ────────────────────────

describe('ContractDetailsScreen — SEC-16: guards no onSnapshot', () => {
  test('redireciona para Home quando onSnapshot recebe permission-denied', async () => {
    await act(async () => {
      ReactTestRenderer.create(
        <ContractDetailsScreen
          route={{ params: { contractId: 'contract001', contract: INITIAL_CONTRACT } }}
          navigation={{ navigate: mockNavigate, goBack: mockGoBack }}
        />
      );
      await flushPromises();
    });

    expect(mockSnapshotError).not.toBeNull();

    await act(async () => {
      mockSnapshotError!({ code: 'permission-denied', message: 'Insufficient permissions.' });
      await flushPromises();
    });

    expect(Alert.alert).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'Home' });
  });

  test('chama goBack quando onSnapshot recebe erro de rede', async () => {
    mockNavigate.mockClear();
    mockGoBack.mockClear();

    await act(async () => {
      ReactTestRenderer.create(
        <ContractDetailsScreen
          route={{ params: { contractId: 'contract001', contract: INITIAL_CONTRACT } }}
          navigation={{ navigate: mockNavigate, goBack: mockGoBack }}
        />
      );
      await flushPromises();
    });

    await act(async () => {
      mockSnapshotError!({ code: 'unavailable', message: 'Network error.' });
      await flushPromises();
    });

    expect(mockGoBack).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalledWith('MainTabs', { screen: 'Home' });
  });
});
