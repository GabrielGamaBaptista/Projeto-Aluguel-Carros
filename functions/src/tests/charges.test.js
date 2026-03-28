/**
 * Testes unitários para createCharge (SEC-02 + SEC-06)
 */

'use strict';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const LANDLORD_ID = 'landlord001';
const TENANT_ID   = 'tenant002';
const CAR_ID      = 'car003';
const CONTRACT_ID = 'contract004';

// Prefixo "mock" é necessário para Jest permitir acesso em factory functions
let mockDocStore = {};

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('firebase-admin', () => {
  const emptySnap = { empty: true, docs: [] };

  const limitFn = jest.fn(() => ({ get: jest.fn().mockResolvedValue(emptySnap) }));
  const whereFn = jest.fn(() => ({ where: whereFn, limit: limitFn, get: jest.fn().mockResolvedValue(emptySnap) }));
  const addFn   = jest.fn().mockResolvedValue({ id: 'charge_new' });

  const docFn = jest.fn((id) => ({
    get: jest.fn(() => Promise.resolve(mockDocStore[id] || { exists: false, data: () => ({}) })),
    update: jest.fn().mockResolvedValue({}),
  }));

  const collectionFn = jest.fn(() => ({ doc: docFn, where: whereFn, add: addFn }));
  const firestoreFn  = jest.fn(() => ({ collection: collectionFn }));
  firestoreFn.FieldValue = { serverTimestamp: jest.fn(() => 'SERVER_TS') };

  return { firestore: firestoreFn, initializeApp: jest.fn() };
});

jest.mock('firebase-functions/v2/https', () => {
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  return { onCall: jest.fn((_, h) => h), HttpsError };
});

jest.mock('firebase-functions', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('../utils/rateLimiter', () => ({
  checkRateLimit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../asaas/client', () => ({
  createSubaccountClient: jest.fn(() => ({
    post: jest.fn().mockResolvedValue({
      data: { id: 'pay_asaas123', status: 'PENDING', invoiceUrl: 'http://inv', bankSlipUrl: null, dueDate: '2026-04-01' },
    }),
    get: jest.fn(),
  })),
  getMainClient: jest.fn(() => ({ get: jest.fn() })),
  ASAAS_PLATFORM_WALLET_ID: 'mock-secret',
}));

// ── Handler ───────────────────────────────────────────────────────────────────

const { createCharge } = require('../handlers/charges');

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockDocStore = {
    [CAR_ID]: {
      exists: true,
      id: CAR_ID,
      data: () => ({ landlordId: LANDLORD_ID, tenantId: TENANT_ID, status: 'rented' }),
    },
    [CONTRACT_ID]: {
      exists: true,
      id: CONTRACT_ID,
      data: () => ({ landlordId: LANDLORD_ID, tenantId: TENANT_ID, carId: CAR_ID, active: true, frequency: 'MONTHLY' }),
    },
    [LANDLORD_ID]: {
      exists: true,
      data: () => ({ apiKey: 'test_api_key' }),
    },
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const baseData = (overrides = {}) => ({
  carId: CAR_ID,
  landlordId: LANDLORD_ID,
  tenantId: TENANT_ID,
  amount: 500,
  billingType: 'PIX',
  dueDate: '2026-04-01',
  description: 'Teste avulso',
  ...overrides,
});

const call = (authUid, data) => createCharge({ auth: { uid: authUid }, data });

// ── Autenticação / Autorização ────────────────────────────────────────────────

describe('autenticação e autorização', () => {
  test('rejeita sem auth', async () => {
    await expect(createCharge({ auth: null, data: baseData() }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  test('rejeita quando auth.uid difere de landlordId', async () => {
    await expect(call('impostor', baseData()))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });
});

// ── SEC-02: carId obrigatório ─────────────────────────────────────────────────

describe('SEC-02 — carId obrigatório', () => {
  test('rejeita quando carId está ausente', async () => {
    const data = baseData();
    delete data.carId;
    await expect(call(LANDLORD_ID, data))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('rejeita quando carId é null', async () => {
    await expect(call(LANDLORD_ID, baseData({ carId: null })))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('rejeita quando carro não existe', async () => {
    mockDocStore[CAR_ID] = { exists: false, data: () => ({}) };
    await expect(call(LANDLORD_ID, baseData()))
      .rejects.toMatchObject({ code: 'not-found' });
  });

  test('rejeita quando carro pertence a outro locador', async () => {
    mockDocStore[CAR_ID] = { exists: true, id: CAR_ID, data: () => ({ landlordId: 'outro_locador', tenantId: TENANT_ID }) };
    await expect(call(LANDLORD_ID, baseData()))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  test('rejeita quando tenantId do payload difere do carro', async () => {
    await expect(call(LANDLORD_ID, baseData({ tenantId: 'tenant_errado' })))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  test('aceita quando tenantId não é informado no payload', async () => {
    const data = baseData();
    delete data.tenantId;
    // Não deve lançar invalid-argument (SEC-02) nem failed-precondition
    const result = await call(LANDLORD_ID, data).catch(e => e);
    expect(result?.code).not.toBe('invalid-argument');
    expect(result?.code).not.toBe('failed-precondition');
  });
});

// ── SEC-06: contractId validado ───────────────────────────────────────────────

describe('SEC-06 — contractId validado contra carId e landlordId', () => {
  const withContract = baseData({ contractId: CONTRACT_ID });

  test('rejeita quando contrato não existe', async () => {
    mockDocStore[CONTRACT_ID] = { exists: false, data: () => ({}) };
    await expect(call(LANDLORD_ID, withContract))
      .rejects.toMatchObject({ code: 'not-found' });
  });

  test('rejeita quando contrato pertence a outro locador', async () => {
    mockDocStore[CONTRACT_ID] = {
      exists: true,
      id: CONTRACT_ID,
      data: () => ({ landlordId: 'outro_locador', carId: CAR_ID }),
    };
    await expect(call(LANDLORD_ID, withContract))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  test('rejeita quando contrato é de outro carro', async () => {
    mockDocStore[CONTRACT_ID] = {
      exists: true,
      id: CONTRACT_ID,
      data: () => ({ landlordId: LANDLORD_ID, carId: 'outro_carro' }),
    };
    await expect(call(LANDLORD_ID, withContract))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('contrato válido não lança erro de validação', async () => {
    const result = await call(LANDLORD_ID, withContract).catch(e => e);
    // Erros aceitos: internal (Asaas em ambiente de teste) — não podem ser erros de validação
    expect(result?.code).not.toBe('not-found');
    expect(result?.code).not.toBe('permission-denied');
    expect(result?.code).not.toBe('invalid-argument');
    expect(result?.code).not.toBe('failed-precondition');
  });

  test('cobrança avulsa sem contractId não executa validação SEC-06', async () => {
    const result = await call(LANDLORD_ID, baseData({ contractId: null })).catch(e => e);
    // Também não deve lançar erros de validação
    expect(result?.code).not.toBe('not-found');
    expect(result?.code).not.toBe('permission-denied');
    expect(result?.code).not.toBe('invalid-argument');
  });
});

// ── Regressão: exports internos intactos ─────────────────────────────────────

describe('Regressão — exports internos', () => {
  test('_createChargeInternal é exportada para uso do cron', () => {
    const { _createChargeInternal } = require('../handlers/charges');
    expect(typeof _createChargeInternal).toBe('function');
  });

  test('generateRecurringCharges é exportada', () => {
    const { generateRecurringCharges } = require('../handlers/charges');
    expect(generateRecurringCharges).toBeDefined();
  });

  test('generateBatchCharges é exportada', () => {
    const { generateBatchCharges } = require('../handlers/charges');
    expect(typeof generateBatchCharges).toBe('function');
  });
});
