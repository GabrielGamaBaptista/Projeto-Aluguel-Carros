// Mock do firebase-admin para testes unitários
const firestoreMock = {
  collection: jest.fn(),
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
  Timestamp: {
    fromMillis: jest.fn((ms) => ({ toMillis: () => ms })),
  },
};

const adminMock = {
  firestore: jest.fn(() => firestoreMock),
  initializeApp: jest.fn(),
};

// Expor o firestoreMock para que os testes possam configurar comportamentos
adminMock.firestore.FieldValue = firestoreMock.FieldValue;
adminMock.__firestoreMock = firestoreMock;

module.exports = adminMock;
