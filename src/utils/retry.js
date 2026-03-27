// src/utils/retry.js
// Utilitário de retry para operações de leitura (Firestore reads e CF read-only).
// NÃO usar em writes/mutations para evitar efeitos colaterais duplicados.

// Palavras-chave de erro transiente (Firestore/gRPC e Firebase Functions)
// Usando .includes() para cobrir tanto 'unavailable' quanto 'functions/unavailable', etc.
const RETRYABLE_CODES = [
  'unavailable',
  'deadline-exceeded',
  'resource-exhausted',
  'aborted',
];

function isRetryable(error) {
  if (!error) return false;
  // Erros de rede (React Native)
  if (error.message && /network request failed/i.test(error.message)) return true;
  // Erros Firestore/gRPC e Firebase Functions — cobre 'unavailable', 'functions/unavailable', etc.
  const code = error.code || '';
  return RETRYABLE_CODES.some(retryable => code.includes(retryable));
}

/**
 * Executa fn() e, em caso de erro retryable, aguarda delayMs e tenta mais uma vez.
 * Máximo 1 retry conforme definido no plano (maxRetries default = 1).
 *
 * @param {() => Promise<T>} fn - Função assíncrona de leitura a ser executada
 * @param {{ maxRetries?: number, delayMs?: number }} options
 * @returns {Promise<T>}
 */
export async function withRetry(fn, { maxRetries = 1, delayMs = 1000 } = {}) {
  try {
    return await fn();
  } catch (error) {
    if (isRetryable(error) && maxRetries > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      // delayMs dobra a cada tentativa (backoff exponencial para casos com maxRetries > 1)
      return withRetry(fn, { maxRetries: maxRetries - 1, delayMs: delayMs * 2 });
    }
    throw error;
  }
}
