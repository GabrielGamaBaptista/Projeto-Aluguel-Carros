// src/utils/cache.js
// Cache em memória com TTL para dados frequentemente lidos (Q3.6).
// Apenas para leituras — nunca cachear dados de escrita ou dados financeiros.

class SimpleCache {
  constructor(ttlMs = 5 * 60 * 1000) {
    this._cache = new Map();
    this._ttl = ttlMs;
  }

  get(key) {
    const entry = this._cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this._cache.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value) {
    if (value === undefined) return;
    this._cache.set(key, { value, expiresAt: Date.now() + this._ttl });
  }

  invalidate(key) {
    this._cache.delete(key);
  }

  clear() {
    this._cache.clear();
  }
}

// Cache de perfis de usuário (TTL 5 min)
export const userCache = new SimpleCache(5 * 60 * 1000);

// Cache de dados de carros (TTL 5 min)
export const carCache = new SimpleCache(5 * 60 * 1000);

/**
 * Limpa todos os caches (chamar no logout para evitar dados stale entre sessões).
 */
export function clearAllCaches() {
  userCache.clear();
  carCache.clear();
}
