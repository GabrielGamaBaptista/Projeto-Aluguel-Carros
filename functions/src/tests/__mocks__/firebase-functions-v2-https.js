// Mock do firebase-functions/v2/https para testes unitários
class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const onCall = jest.fn((options, handler) => handler);

module.exports = { onCall, HttpsError };
