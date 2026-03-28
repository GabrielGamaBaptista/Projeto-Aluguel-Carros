/**
 * Testes unitários para createNotificationCF (SEC-01)
 */

'use strict';

// ── Mocks declarados ANTES de qualquer require ────────────────────────────────

jest.mock('firebase-admin', () => {
  const whereMock = jest.fn();
  whereMock.mockReturnValue({ where: whereMock, limit: jest.fn(() => ({ get: jest.fn() })) });

  const collectionMock = jest.fn(() => ({
    where: whereMock,
    add: jest.fn().mockResolvedValue({ id: 'notif1' }),
  }));

  const firestoreFn = jest.fn(() => ({ collection: collectionMock }));
  firestoreFn.FieldValue = { serverTimestamp: jest.fn(() => 'SERVER_TS') };

  return {
    firestore: firestoreFn,
    initializeApp: jest.fn(),
    __collectionMock: collectionMock,
    __whereMock: whereMock,
  };
});

jest.mock('firebase-functions/v2/https', () => {
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  return {
    onCall: jest.fn((_, handler) => handler),
    HttpsError,
  };
});

jest.mock('../utils/rateLimiter', () => ({
  checkRateLimit: jest.fn().mockResolvedValue(undefined),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');
const { createNotificationCF: handler } = require('../handlers/createNotification');

// ── Helper: configura as 4 queries de relacionamento ─────────────────────────

/**
 * Configura mock das 4 queries paralelas de hasValidRelationship.
 * A CF usa Promise.all com 4 queries na ordem: landlordCar, tenantCar, request1, request2.
 * Passa true para indicar que a query retorna resultado (não vazia).
 */
function setupRelationship({ landlordCar = false, tenantCar = false, req1 = false, req2 = false } = {}) {
  const results = [landlordCar, tenantCar, req1, req2];
  let callIdx = 0;

  const getMock = jest.fn(() => Promise.resolve({ empty: !results[callIdx++], docs: [] }));
  const limitMock = jest.fn(() => ({ get: getMock }));
  const whereMock = jest.fn(() => ({ where: whereMock, limit: limitMock }));
  const addMock = jest.fn().mockResolvedValue({ id: 'notif1' });
  const collectionMock = jest.fn(() => ({ where: whereMock, add: addMock }));

  admin.firestore.mockReturnValue({ collection: collectionMock });
  return { addMock };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Autenticação ──────────────────────────────────────────────────────────────

describe('autenticação', () => {
  test('rejeita sem auth', async () => {
    await expect(handler({ auth: null, data: {} }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

// ── Validação de entrada ──────────────────────────────────────────────────────

describe('validação de entrada', () => {
  const AUTH = { uid: 'caller1' };

  test('rejeita sem targetUserId', async () => {
    await expect(handler({ auth: AUTH, data: { title: 'T', body: 'B' } }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('rejeita sem title', async () => {
    await expect(handler({ auth: AUTH, data: { targetUserId: 'u2', body: 'B' } }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('rejeita sem body', async () => {
    await expect(handler({ auth: AUTH, data: { targetUserId: 'u2', title: 'T' } }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('rejeita title > 200 chars', async () => {
    await expect(handler({ auth: AUTH, data: { targetUserId: 'u2', title: 'A'.repeat(201), body: 'B' } }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('aceita title com exatamente 200 chars', async () => {
    setupRelationship({ landlordCar: true });
    await expect(handler({ auth: AUTH, data: { targetUserId: 'u2', title: 'A'.repeat(200), body: 'B' } }))
      .resolves.toMatchObject({ success: true });
  });

  test('rejeita body > 500 chars', async () => {
    await expect(handler({ auth: AUTH, data: { targetUserId: 'u2', title: 'T', body: 'B'.repeat(501) } }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('aceita body com exatamente 500 chars', async () => {
    setupRelationship({ landlordCar: true });
    await expect(handler({ auth: AUTH, data: { targetUserId: 'u2', title: 'T', body: 'B'.repeat(500) } }))
      .resolves.toMatchObject({ success: true });
  });

  test('rejeita data como string', async () => {
    await expect(handler({ auth: AUTH, data: { targetUserId: 'u2', title: 'T', body: 'B', data: 'invalido' } }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('rejeita data como array', async () => {
    await expect(handler({ auth: AUTH, data: { targetUserId: 'u2', title: 'T', body: 'B', data: ['x'] } }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

// ── Validação de relacionamento ───────────────────────────────────────────────

describe('validação de relacionamento', () => {
  const AUTH = { uid: 'caller1' };
  const DATA = { targetUserId: 'target2', title: 'Título', body: 'Corpo' };

  test('rejeita quando nenhuma relação encontrada', async () => {
    setupRelationship({ landlordCar: false, tenantCar: false, req1: false, req2: false });
    await expect(handler({ auth: AUTH, data: DATA }))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  test('aprova via cars (caller=locador, target=locatário)', async () => {
    setupRelationship({ landlordCar: true });
    await expect(handler({ auth: AUTH, data: DATA }))
      .resolves.toMatchObject({ success: true });
  });

  test('aprova via cars (caller=locatário, target=locador)', async () => {
    setupRelationship({ tenantCar: true });
    await expect(handler({ auth: AUTH, data: DATA }))
      .resolves.toMatchObject({ success: true });
  });

  test('aprova via tenantRequests (caller enviou request)', async () => {
    setupRelationship({ req1: true });
    await expect(handler({ auth: AUTH, data: DATA }))
      .resolves.toMatchObject({ success: true });
  });

  test('aprova via tenantRequests (target enviou request)', async () => {
    setupRelationship({ req2: true });
    await expect(handler({ auth: AUTH, data: DATA }))
      .resolves.toMatchObject({ success: true });
  });
});

// ── Escrita no Firestore ──────────────────────────────────────────────────────

describe('escrita no Firestore', () => {
  test('grava documento com campos corretos em notifications/', async () => {
    const { addMock } = setupRelationship({ landlordCar: true });
    const DATA = { targetUserId: 'target2', title: 'Tarefa', body: 'Corpo', data: { type: 'new_task', carId: 'c1' } };

    await handler({ auth: { uid: 'caller1' }, data: DATA });

    expect(addMock).toHaveBeenCalledTimes(1);
    const written = addMock.mock.calls[0][0];
    expect(written).toMatchObject({
      userId: 'target2',
      title: 'Tarefa',
      body: 'Corpo',
      data: { type: 'new_task', carId: 'c1' },
      read: false,
      sent: false,
      createdAt: 'SERVER_TS',
    });
  });
});
