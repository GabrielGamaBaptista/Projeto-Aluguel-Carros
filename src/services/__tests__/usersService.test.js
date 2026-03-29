/**
 * Testes unitários — usersService (SEC-09)
 *
 * Verifica:
 *  - getAvailableTenants foi removida (dump de todos os locatarios)
 *  - Funcoes legitimas (getUserById, searchTenants) continuam exportadas
 */

'use strict';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../config/firebase', () => ({
  firestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
      })),
    })),
  })),
  auth: {},
}));

jest.mock('@react-native-firebase/functions', () => {
  const callableMock = jest.fn().mockResolvedValue({ data: {} });
  const fnsMock = jest.fn(() => ({
    httpsCallable: jest.fn(() => callableMock),
  }));
  return fnsMock;
});

jest.mock('../../utils/retry', () => ({
  withRetry: jest.fn((fn) => fn()),
}));

jest.mock('../../utils/cache', () => ({
  userCache: {
    get:        jest.fn().mockReturnValue(null),
    set:        jest.fn(),
    invalidate: jest.fn(),
  },
}));

// ── Testes ────────────────────────────────────────────────────────────────────

describe('usersService — SEC-09: remocao de getAvailableTenants', () => {
  let usersService;

  beforeEach(() => {
    jest.resetModules();

    // Re-aplicar mocks apos resetModules
    jest.mock('../../config/firebase', () => ({
      firestore: jest.fn(() => ({
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
          })),
        })),
      })),
      auth: {},
    }));
    jest.mock('@react-native-firebase/functions', () => {
      const callableMock = jest.fn().mockResolvedValue({ data: {} });
      return jest.fn(() => ({ httpsCallable: jest.fn(() => callableMock) }));
    });
    jest.mock('../../utils/retry', () => ({ withRetry: (fn) => fn() }));
    jest.mock('../../utils/cache', () => ({
      userCache: { get: jest.fn().mockReturnValue(null), set: jest.fn(), invalidate: jest.fn() },
    }));

    usersService = require('../usersService').usersService;
  });

  test('getAvailableTenants NAO esta exportada (SEC-09: previne dump de locatarios)', () => {
    expect(usersService.getAvailableTenants).toBeUndefined();
  });

  test('getAvailableTenants nao e uma funcao no objeto usersService', () => {
    const exportedFunctions = Object.keys(usersService);
    expect(exportedFunctions).not.toContain('getAvailableTenants');
  });

  test('getUserById continua exportado e e uma funcao', () => {
    expect(typeof usersService.getUserById).toBe('function');
  });

  test('searchTenants continua exportado e e uma funcao', () => {
    expect(typeof usersService.searchTenants).toBe('function');
  });

  test('getUserById retorna success:false para usuario inexistente', async () => {
    const result = await usersService.getUserById('uid_inexistente');
    expect(result.success).toBe(false);
  });

  test('getUserById retorna sucesso com dados quando usuario existe', async () => {
    const { firestore } = require('../../config/firebase');
    firestore.mockReturnValueOnce({
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            id:     'uid123',
            data:   () => ({ name: 'Test User', role: 'locatario' }),
          }),
        })),
      })),
    });

    const { userCache } = require('../../utils/cache');
    userCache.get.mockReturnValueOnce(null); // cache miss

    const result = await usersService.getUserById('uid123');
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ id: 'uid123', name: 'Test User' });
  });
});
