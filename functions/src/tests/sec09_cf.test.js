/**
 * Testes unitários — SEC-09 (Cloud Functions side)
 *
 * Cobre:
 *  - assignTenantCF: post-transacao seta currentLandlordId no doc do locatario
 *  - deleteCarCF: limpa currentLandlordId ao remover carro com tenantId
 *
 * Estrategia de mock:
 *  - runTransaction e mockado para pular a transacao e retornar resultado fixo,
 *    permitindo testar o codigo pos-transacao em isolamento.
 *  - Todos os .where().get() retornam vazios para simplificar o fluxo.
 *  - update() nos docs 'users' e registrado em mockUpdates[] para verificacao.
 */

'use strict';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const LANDLORD_ID = 'landlord001';
const TENANT_ID   = 'tenant002';
const CAR_ID      = 'car003';
const REQUEST_ID  = 'req004';

// ── Estado mutavel dos mocks ──────────────────────────────────────────────────
// Prefixo "mock" obrigatorio para acesso dentro de jest.mock() factories

let mockUpdates = [];       // { collection, docId, data }
let mockDeletes = [];       // { collection, docId }
let mockCarDocData  = null; // dados do documento do carro (para deleteCarCF)
let mockTransactionOk = true;

beforeEach(() => {
  mockUpdates        = [];
  mockDeletes        = [];
  mockCarDocData     = null;
  mockTransactionOk  = true;
  jest.clearAllMocks();
});

// ── Mock firebase-admin ───────────────────────────────────────────────────────

jest.mock('firebase-admin', () => {
  const emptySnap = { empty: true, docs: [] };
  const whereFn   = jest.fn();
  whereFn.mockReturnValue({
    where:  whereFn,
    limit:  jest.fn(() => ({ get: jest.fn().mockResolvedValue(emptySnap) })),
    get:    jest.fn().mockResolvedValue(emptySnap),
  });

  const makeDocMock = (collection, docId) => ({
    get: jest.fn(() => {
      if (collection === 'cars' && docId === CAR_ID) {
        return Promise.resolve({
          exists: mockCarDocData !== null,
          data:   () => mockCarDocData || {},
        });
      }
      return Promise.resolve({ exists: false, data: () => ({}) });
    }),
    update: jest.fn((data) => {
      mockUpdates.push({ collection, docId, data });
      return Promise.resolve({});
    }),
    delete: jest.fn(() => {
      mockDeletes.push({ collection, docId });
      return Promise.resolve({});
    }),
  });

  const collectionFn = jest.fn((name) => ({
    doc:   jest.fn((id) => makeDocMock(name, id)),
    where: whereFn,
    add:   jest.fn().mockResolvedValue({ id: 'new_doc' }),
  }));

  const runTransactionMock = jest.fn(async (callback) => {
    if (!mockTransactionOk) {
      throw new Error('Transaction failed');
    }
    // Retorna resultado fixo sem executar o callback real,
    // simulando transacao bem-sucedida para testar o codigo pos-transacao.
    return {
      carId:     CAR_ID,
      landlordId: LANDLORD_ID,
      carInfo:   'Toyota Corolla (ABC1D23)',
    };
  });

  const firestoreFn = jest.fn(() => ({
    collection:     collectionFn,
    runTransaction: runTransactionMock,
    batch:          jest.fn(() => ({ delete: jest.fn(), update: jest.fn(), commit: jest.fn().mockResolvedValue({}) })),
  }));
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

jest.mock('../utils/rateLimiter', () => ({
  checkRateLimit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../asaas/client', () => ({
  createSubaccountClient: jest.fn(() => ({ post: jest.fn(), get: jest.fn(), delete: jest.fn() })),
  getMainClient: jest.fn(),
  ASAAS_PLATFORM_WALLET_ID: 'mock_wallet',
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeRequest = (uid = TENANT_ID, data = {}) => ({
  auth: { uid },
  data,
});

// ── assignTenantCF — SEC-09 ───────────────────────────────────────────────────

describe('assignTenantCF — SEC-09: currentLandlordId', () => {
  let assignTenant;

  beforeEach(() => {
    jest.resetModules();
    assignTenant = require('../handlers/tenantAssignment').assignTenant;
  });

  test('seta currentLandlordId no doc do locatario apos atribuicao bem-sucedida', async () => {
    const req = makeRequest(TENANT_ID, { requestId: REQUEST_ID });

    const result = await assignTenant(req);

    expect(result).toEqual({ success: true });

    const userUpdate = mockUpdates.find(
      u => u.collection === 'users' && u.docId === TENANT_ID
    );
    expect(userUpdate).toBeDefined();
    expect(userUpdate.data).toEqual({ currentLandlordId: LANDLORD_ID });
  });

  test('usa o landlordId correto da transacao (nao o uid do locatario)', async () => {
    const req = makeRequest(TENANT_ID, { requestId: REQUEST_ID });

    await assignTenant(req);

    const userUpdate = mockUpdates.find(
      u => u.collection === 'users' && u.docId === TENANT_ID
    );
    expect(userUpdate.data.currentLandlordId).toBe(LANDLORD_ID);
    expect(userUpdate.data.currentLandlordId).not.toBe(TENANT_ID);
  });

  test('retorna success:true mesmo se update de currentLandlordId falhar', async () => {
    const admin = require('firebase-admin');
    const db    = admin.firestore();

    // Faz o update do doc do locatario rejeitar
    db.collection('users').doc(TENANT_ID).update.mockRejectedValueOnce(
      new Error('Firestore unavailable')
    );

    const req = makeRequest(TENANT_ID, { requestId: REQUEST_ID });
    const result = await assignTenant(req);

    // Funcao deve retornar sucesso (currentLandlordId e nao-critico)
    expect(result).toEqual({ success: true });
  });

  test('lanca HttpsError se nao autenticado', async () => {
    const req = { auth: null, data: { requestId: REQUEST_ID } };
    await expect(assignTenant(req)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  test('lanca HttpsError se requestId ausente', async () => {
    const req = makeRequest(TENANT_ID, {});
    await expect(assignTenant(req)).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

// ── deleteCarCF — SEC-09 ──────────────────────────────────────────────────────

describe('deleteCarCF — SEC-09: currentLandlordId', () => {
  let deleteCarCF;

  beforeEach(() => {
    jest.resetModules();
    deleteCarCF = require('../handlers/carManagement').deleteCarCF;
  });

  test('limpa currentLandlordId do locatario quando carro tem tenantId', async () => {
    mockCarDocData = {
      landlordId: LANDLORD_ID,
      tenantId:   TENANT_ID,
      brand: 'Toyota', model: 'Corolla', plate: 'ABC1D23',
    };

    const req = makeRequest(LANDLORD_ID, { carId: CAR_ID });
    const result = await deleteCarCF(req);

    expect(result).toEqual({ success: true });

    const userUpdate = mockUpdates.find(
      u => u.collection === 'users' && u.docId === TENANT_ID
    );
    expect(userUpdate).toBeDefined();
    expect(userUpdate.data).toEqual({ currentLandlordId: null });
  });

  test('NAO chama update em users quando carro nao tem tenantId', async () => {
    mockCarDocData = {
      landlordId: LANDLORD_ID,
      tenantId:   null,
      brand: 'Toyota', model: 'Corolla', plate: 'ABC1D23',
    };

    const req = makeRequest(LANDLORD_ID, { carId: CAR_ID });
    await deleteCarCF(req);

    const userUpdate = mockUpdates.find(u => u.collection === 'users');
    expect(userUpdate).toBeUndefined();
  });

  test('retorna success:true mesmo se limpeza de currentLandlordId falhar', async () => {
    mockCarDocData = {
      landlordId: LANDLORD_ID,
      tenantId:   TENANT_ID,
      brand: 'Toyota', model: 'Corolla', plate: 'ABC1D23',
    };

    const admin = require('firebase-admin');
    const db    = admin.firestore();
    db.collection('users').doc(TENANT_ID).update.mockRejectedValueOnce(
      new Error('Permission denied')
    );

    const req    = makeRequest(LANDLORD_ID, { carId: CAR_ID });
    const result = await deleteCarCF(req);

    expect(result).toEqual({ success: true });
  });

  test('lanca permission-denied se caller nao e dono do carro', async () => {
    mockCarDocData = {
      landlordId: 'outro_landlord',
      tenantId:   null,
      brand: 'Toyota', model: 'Corolla', plate: 'XYZ9999',
    };

    const req = makeRequest(LANDLORD_ID, { carId: CAR_ID });
    await expect(deleteCarCF(req)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  test('lanca not-found se carro nao existe', async () => {
    mockCarDocData = null; // doc nao existe

    const req = makeRequest(LANDLORD_ID, { carId: CAR_ID });
    await expect(deleteCarCF(req)).rejects.toMatchObject({ code: 'not-found' });
  });

  test('deleta o documento do carro ao final', async () => {
    mockCarDocData = {
      landlordId: LANDLORD_ID,
      tenantId:   null,
      brand: 'Toyota', model: 'Corolla', plate: 'ABC1D23',
    };

    const req = makeRequest(LANDLORD_ID, { carId: CAR_ID });
    await deleteCarCF(req);

    const carDelete = mockDeletes.find(
      d => d.collection === 'cars' && d.docId === CAR_ID
    );
    expect(carDelete).toBeDefined();
  });
});
