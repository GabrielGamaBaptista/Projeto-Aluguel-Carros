/**
 * Testes unitários — carsService.removeTenant (SEC-09)
 *
 * Verifica:
 *  - Limpa currentLandlordId do locatario ao remover
 *  - Silencia erro permission-denied (esperado para locatarios pre-deploy)
 *  - Loga erros que NAO sejam permission-denied
 *  - Retorna success:true mesmo se a limpeza do currentLandlordId falhar
 *  - Nao chama update de currentLandlordId se carro nao tem tenantId
 */

'use strict';

// ── Estado mutavel dos mocks ──────────────────────────────────────────────────

let firestoreState = {
  carDoc: null,       // null = nao existe
  userUpdateError: null,
  carUpdateError:  null,
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockUserUpdate    = jest.fn();
const mockCarUpdate     = jest.fn();
const mockCarGet        = jest.fn();
const mockFirestoreCall = jest.fn();

jest.mock('../../config/firebase', () => ({
  firestore: mockFirestoreCall,
  auth: {},
}));

jest.mock('../../services/paymentService', () => ({
  __esModule: true,
  default: {
    cancelActiveContractByCar: jest.fn().mockResolvedValue({ success: true }),
  },
}));

jest.mock('../../services/tasksService', () => ({
  tasksService: {
    deleteTasksByCar: jest.fn().mockResolvedValue({ success: true }),
  },
}));

jest.mock('../../services/notificationService', () => ({
  notificationService: {
    createNotification: jest.fn().mockResolvedValue({ success: true }),
  },
}));

jest.mock('@react-native-firebase/functions', () =>
  jest.fn(() => ({ httpsCallable: jest.fn(() => jest.fn().mockResolvedValue({ data: {} })) }))
);

jest.mock('../../utils/cache', () => ({
  carCache: { get: jest.fn().mockReturnValue(null), set: jest.fn(), invalidate: jest.fn() },
}));

jest.mock('../../utils/retry', () => ({
  withRetry: jest.fn((fn) => fn()),
}));

// ── Helper: configura mock do Firestore ───────────────────────────────────────

function setupFirestoreMock({
  tenantId      = 'tenant002',
  userUpdateErr = null,
  carUpdateErr  = null,
} = {}) {
  mockUserUpdate.mockReset();
  mockCarUpdate.mockReset();
  mockCarGet.mockReset();

  if (userUpdateErr) {
    mockUserUpdate.mockRejectedValue(userUpdateErr);
  } else {
    mockUserUpdate.mockResolvedValue({});
  }

  if (carUpdateErr) {
    mockCarUpdate.mockRejectedValue(carUpdateErr);
  } else {
    mockCarUpdate.mockResolvedValue({});
  }

  mockCarGet.mockResolvedValue({
    exists: true,
    data:   () => ({
      tenantId,
      brand:  'Toyota',
      model:  'Corolla',
      plate:  'ABC1D23',
    }),
  });

  // Retorna mock diferente dependendo da colecao
  mockFirestoreCall.mockReturnValue({
    collection: jest.fn((col) => ({
      doc: jest.fn((id) => {
        if (col === 'users') {
          return { update: mockUserUpdate };
        }
        if (col === 'cars') {
          return {
            get:    mockCarGet,
            update: mockCarUpdate,
          };
        }
        return {
          get:    jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
          update: jest.fn().mockResolvedValue({}),
        };
      }),
    })),
  });
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe('carsService.removeTenant — SEC-09: limpeza de currentLandlordId', () => {
  let carsService;

  beforeEach(() => {
    jest.resetModules();
    setupFirestoreMock();
    carsService = require('../carsService').carsService;
  });

  test('chama users.doc(tenantId).update({ currentLandlordId: null }) ao remover', async () => {
    await carsService.removeTenant('car003');

    expect(mockUserUpdate).toHaveBeenCalledWith({ currentLandlordId: null });
  });

  test('retorna success:true mesmo se update de currentLandlordId lancou permission-denied', async () => {
    const permErr  = Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' });
    setupFirestoreMock({ userUpdateErr: permErr });
    jest.resetModules();
    carsService = require('../carsService').carsService;

    const result = await carsService.removeTenant('car003');

    expect(result.success).toBe(true);
  });

  test('NAO loga console.warn para erro permission-denied', async () => {
    const permErr = Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' });
    setupFirestoreMock({ userUpdateErr: permErr });
    jest.resetModules();
    carsService = require('../carsService').carsService;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await carsService.removeTenant('car003');

    const warnedAboutCurrentLandlordId = warnSpy.mock.calls.some(
      (args) => args[0]?.includes?.('currentLandlordId')
    );
    expect(warnedAboutCurrentLandlordId).toBe(false);

    warnSpy.mockRestore();
  });

  test('LOGA console.warn para erros que NAO sejam permission-denied', async () => {
    const netErr = Object.assign(new Error('Network error'), { code: 'unavailable' });
    setupFirestoreMock({ userUpdateErr: netErr });
    jest.resetModules();
    carsService = require('../carsService').carsService;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await carsService.removeTenant('car003');

    const warnedAboutCurrentLandlordId = warnSpy.mock.calls.some(
      (args) => typeof args[0] === 'string' && args[0].includes('currentLandlordId')
    );
    expect(warnedAboutCurrentLandlordId).toBe(true);

    warnSpy.mockRestore();
  });

  test('retorna success:true mesmo se update de currentLandlordId lancou erro generico', async () => {
    const genericErr = new Error('Something went wrong');
    setupFirestoreMock({ userUpdateErr: genericErr });
    jest.resetModules();
    carsService = require('../carsService').carsService;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result  = await carsService.removeTenant('car003');
    warnSpy.mockRestore();

    expect(result.success).toBe(true);
  });

  test('NAO chama update em users se carro nao tem tenantId', async () => {
    setupFirestoreMock({ tenantId: null });
    jest.resetModules();
    carsService = require('../carsService').carsService;

    await carsService.removeTenant('car003');

    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
