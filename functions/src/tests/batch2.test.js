/**
 * Testes unitários — Batch 2 (SEC-04, SEC-05, SEC-13, SEC-14, SEC-18)
 */

'use strict';

// ── Mocks ─────────────────────────────────────────────────────────────────────

let mockDocStore = {};
let mockQueryStore = {}; // 'cars_tenant_{uid}' => docs[]

jest.mock('firebase-admin', () => {
  const emptySnap = { empty: true, docs: [] };

  const limitFn = jest.fn(() => ({
    get: jest.fn(() => {
      // Retorna resultado do mockQueryStore se disponivel
      return Promise.resolve(emptySnap);
    }),
  }));
  const whereFn = jest.fn(() => ({ where: whereFn, limit: limitFn, get: jest.fn().mockResolvedValue(emptySnap) }));

  const docFn = jest.fn((id) => ({
    get: jest.fn(() => Promise.resolve(mockDocStore[id] || { exists: false, data: () => ({}) })),
    update: jest.fn().mockResolvedValue({}),
    collection: jest.fn((subCol) => ({
      doc: jest.fn((subId) => ({
        get: jest.fn(() => Promise.resolve(mockDocStore[`${id}/${subCol}/${subId}`] || { exists: false, data: () => ({}) })),
        set: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      })),
      add: jest.fn().mockResolvedValue({ id: 'sub_doc' }),
    })),
  }));

  const collectionFn = jest.fn(() => ({ doc: docFn, where: whereFn, add: jest.fn().mockResolvedValue({ id: 'new_doc' }) }));
  const firestoreFn  = jest.fn(() => ({ collection: collectionFn }));
  firestoreFn.FieldValue = { serverTimestamp: jest.fn(() => 'SERVER_TS') };
  firestoreFn.Timestamp  = { fromMillis: jest.fn((ms) => ms) };

  return { firestore: firestoreFn, initializeApp: jest.fn() };
});

jest.mock('firebase-functions/v2/https', () => {
  class HttpsError extends Error {
    constructor(code, msg) { super(msg); this.code = code; }
  }
  return { onCall: jest.fn((_, h) => h), HttpsError };
});

jest.mock('firebase-functions', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('../utils/rateLimiter', () => ({ checkRateLimit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../asaas/client', () => ({
  createSubaccountClient: jest.fn(() => ({ post: jest.fn(), get: jest.fn() })),
  getMainClient: jest.fn(),
  ASAAS_PLATFORM_WALLET_ID: 'mock',
}));

// ── SEC-13: validateEnum e validateStringLength ────────────────────────────────

describe('SEC-13/14 — validators.js: validateEnum e validateStringLength', () => {
  const { validateEnum, validateStringLength } = require('../utils/validators');

  describe('validateEnum', () => {
    test('retorna true para valor na lista', () => {
      expect(validateEnum('PIX', ['PIX', 'BOLETO'])).toBe(true);
      expect(validateEnum('MONTHLY', ['MONTHLY', 'WEEKLY', 'BIWEEKLY'])).toBe(true);
    });

    test('retorna false para valor fora da lista', () => {
      expect(validateEnum('CREDIT_CARD', ['PIX', 'BOLETO'])).toBe(false);
      expect(validateEnum('DAILY', ['MONTHLY', 'WEEKLY', 'BIWEEKLY'])).toBe(false);
      expect(validateEnum('', ['PIX', 'BOLETO'])).toBe(false);
      expect(validateEnum(undefined, ['PIX', 'BOLETO'])).toBe(false);
    });
  });

  describe('validateStringLength', () => {
    test('retorna true para string dentro do limite', () => {
      expect(validateStringLength('abc', 500)).toBe(true);
      expect(validateStringLength('A'.repeat(500), 500)).toBe(true);
    });

    test('retorna false para string acima do limite', () => {
      expect(validateStringLength('A'.repeat(501), 500)).toBe(false);
    });

    test('retorna true para valores falsy (campo opcional ausente)', () => {
      expect(validateStringLength(undefined, 500)).toBe(true);
      expect(validateStringLength(null, 500)).toBe(true);
      expect(validateStringLength('', 500)).toBe(true);
    });
  });
});

// ── SEC-13: billingType e description em createCharge ─────────────────────────

describe('SEC-13 — createCharge: billingType enum e description length', () => {
  const { createCharge } = require('../handlers/charges');
  const LANDLORD = 'l1';
  const CAR_ID   = 'car1';

  beforeEach(() => {
    jest.clearAllMocks();
    mockDocStore = {
      [CAR_ID]: { exists: true, id: CAR_ID, data: () => ({ landlordId: LANDLORD, tenantId: 't1' }) },
      [LANDLORD]: { exists: true, data: () => ({ apiKey: 'key' }) },
    };
  });

  test('rejeita billingType inválido', async () => {
    await expect(createCharge({
      auth: { uid: LANDLORD },
      data: { carId: CAR_ID, landlordId: LANDLORD, billingType: 'CREDIT_CARD', amount: 100, dueDate: '2026-04-01' },
    })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('aceita billingType válido PIX', async () => {
    const result = await createCharge({
      auth: { uid: LANDLORD },
      data: { carId: CAR_ID, landlordId: LANDLORD, billingType: 'PIX', amount: 100, dueDate: '2026-04-01' },
    }).catch(e => e);
    // Não deve rejeitar por billingType
    expect(result?.code).not.toBe('invalid-argument');
  });

  test('rejeita description com mais de 500 caracteres', async () => {
    await expect(createCharge({
      auth: { uid: LANDLORD },
      data: { carId: CAR_ID, landlordId: LANDLORD, billingType: 'PIX', amount: 100, dueDate: '2026-04-01', description: 'X'.repeat(501) },
    })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('aceita description com exatamente 500 caracteres', async () => {
    const result = await createCharge({
      auth: { uid: LANDLORD },
      data: { carId: CAR_ID, landlordId: LANDLORD, billingType: 'PIX', amount: 100, dueDate: '2026-04-01', description: 'X'.repeat(500) },
    }).catch(e => e);
    expect(result?.code).not.toBe('invalid-argument');
  });
});

// ── SEC-14: frequency e billingType em createContractCF ───────────────────────

describe('SEC-14 — createContractCF: frequency e billingType enum', () => {
  const { createContract } = require('../handlers/contracts');
  const LANDLORD = 'landlord1';

  const baseContractData = (overrides = {}) => ({
    carId: 'car1',
    tenantId: 'tenant1',
    landlordId: LANDLORD,
    rentAmount: 1000,
    frequency: 'MONTHLY',
    billingType: 'PIX',
    startDate: '2026-04-01',
    nextDueDate: '2026-05-01',
    ...overrides,
  });

  test('rejeita frequency inválida', async () => {
    await expect(createContract({
      auth: { uid: LANDLORD },
      data: baseContractData({ frequency: 'DAILY' }),
    })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('rejeita billingType inválido', async () => {
    await expect(createContract({
      auth: { uid: LANDLORD },
      data: baseContractData({ billingType: 'DINHEIRO' }),
    })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('aceita frequency MONTHLY', async () => {
    const result = await createContract({
      auth: { uid: LANDLORD },
      data: baseContractData({ frequency: 'MONTHLY' }),
    }).catch(e => e);
    expect(result?.code).not.toBe('invalid-argument');
  });

  test('aceita frequency WEEKLY', async () => {
    const result = await createContract({
      auth: { uid: LANDLORD },
      data: baseContractData({ frequency: 'WEEKLY' }),
    }).catch(e => e);
    expect(result?.code).not.toBe('invalid-argument');
  });

  test('aceita frequency BIWEEKLY', async () => {
    const result = await createContract({
      auth: { uid: LANDLORD },
      data: baseContractData({ frequency: 'BIWEEKLY' }),
    }).catch(e => e);
    expect(result?.code).not.toBe('invalid-argument');
  });
});

// ── SEC-18: searchTenantsCF não expõe detalhes internos ──────────────────────

describe('SEC-18 — searchTenantsCF: mensagem de erro genérica', () => {
  test('mensagem de erro não contém detalhes internos', () => {
    const handler = require('../handlers/tenantSearch').searchTenantsCF;
    // Verificar o código-fonte da mensagem de erro
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../handlers/tenantSearch.js'),
      'utf8'
    );
    // Garantir que a mensagem não concatena err.message
    expect(src).not.toContain("'Erro ao buscar locatarios: ' + err.message");
    // Garantir que a mensagem genérica está presente
    expect(src).toContain('Erro interno ao buscar locatarios');
    // Garantir que o log interno ainda existe
    expect(src).toContain('console.error');
  });
});
