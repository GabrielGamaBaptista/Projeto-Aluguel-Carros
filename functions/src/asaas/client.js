/**
 * Configuracao do cliente Axios para interagir com a API do Asaas.
 *
 * Secrets (valores sensiveis) sao gerenciados via Firebase Secret Manager (defineSecret).
 * Configs nao-sensiveis ficam em .env / .env.local para desenvolvimento.
 *
 * Para desenvolvimento local: definir em functions/.env.local
 * Para producao: configurar via `firebase functions:secrets:set <NAME>` antes do deploy
 */
const axios = require('axios');
const { defineSecret } = require('firebase-functions/params');

// --- Secrets (Firebase Secret Manager) ---
const ASAAS_API_KEY = defineSecret('ASAAS_API_KEY');
const ASAAS_PLATFORM_WALLET_ID = defineSecret('ASAAS_PLATFORM_WALLET_ID');
const ASAAS_WEBHOOK_TOKEN = defineSecret('ASAAS_WEBHOOK_TOKEN');
const CLOUDINARY_API_KEY = defineSecret('CLOUDINARY_API_KEY');
const CLOUDINARY_API_SECRET = defineSecret('CLOUDINARY_API_SECRET');

// --- Config nao-sensivel (lida de process.env em tempo de execucao) ---
// Usa Proxy para leitura lazy — compativel com handlers que declaram diferentes secrets.
const config = new Proxy({}, {
  get: (_, key) => {
    switch (key) {
      case 'api_key':            return process.env.ASAAS_API_KEY || '';
      case 'base_url':           return process.env.ASAAS_BASE_URL || 'https://sandbox.asaas.com/api/v3';
      case 'platform_wallet_id': return process.env.ASAAS_PLATFORM_WALLET_ID || '';
      case 'platform_fee_percent': return parseFloat(process.env.ASAAS_PLATFORM_FEE_PERCENT || '10');
      case 'webhook_token':      return process.env.ASAAS_WEBHOOK_TOKEN || '';
      case 'webhook_url':        return process.env.ASAAS_WEBHOOK_URL || '';
      default:                   return undefined;
    }
  },
});

// Status HTTP que disparam retry automatico
const RETRY_STATUSES = [429, 500, 502, 503, 504];
const MAX_RETRIES = 3;

/**
 * Adiciona interceptor de retry com backoff exponencial para status 429 e 5xx.
 * Tentativas: 1s, 2s, 4s (maximo 3 retries alem da chamada original).
 */
const addRetryInterceptor = (instance) => {
  instance.interceptors.response.use(undefined, async (error) => {
    const cfg = error.config;
    if (!cfg) return Promise.reject(error);

    const status = error.response?.status;
    if (!RETRY_STATUSES.includes(status)) return Promise.reject(error);

    cfg._retryCount = cfg._retryCount || 0;
    if (cfg._retryCount >= MAX_RETRIES) {
      console.error(`[asaas] Maximo de retries (${MAX_RETRIES}) atingido para ${cfg.method?.toUpperCase()} ${cfg.url}. Status: ${status}`);
      return Promise.reject(error);
    }

    cfg._retryCount += 1;
    const delay = Math.pow(2, cfg._retryCount - 1) * 1000; // 1s, 2s, 4s
    console.warn(`[asaas] Retry ${cfg._retryCount}/${MAX_RETRIES} em ${delay}ms. URL: ${cfg.method?.toUpperCase()} ${cfg.url}. Status: ${status}`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return instance(cfg);
  });
  return instance;
};

/**
 * Cliente configurado com a API Key da conta principal (plataforma).
 * Inicializacao lazy — garante que process.env.ASAAS_API_KEY esteja disponivel
 * (injetado pelo Secret Manager antes da primeira invocacao do handler).
 */
let _mainClient = null;
const getMainClient = () => {
  if (!_mainClient) {
    _mainClient = addRetryInterceptor(axios.create({
      baseURL: config.base_url || 'https://sandbox.asaas.com/api/v3',
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    }));
    // Interceptor de request: le config.api_key em tempo de execucao (via Proxy -> process.env).
    // Garante que o header reflita o secret injetado pelo Secret Manager no boot do container.
    _mainClient.interceptors.request.use((cfg) => {
      cfg.headers['access_token'] = config.api_key || '';
      return cfg;
    });
  }
  return _mainClient;
};

/**
 * Cria um cliente Axios configurado para uma subconta especifica.
 * @param {string} apiKey - A chave de API da subconta.
 * @returns {import('axios').AxiosInstance} Instancia do Axios para a subconta.
 */
const createSubaccountClient = (apiKey) => addRetryInterceptor(axios.create({
  baseURL: config.base_url || 'https://sandbox.asaas.com/api/v3',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'access_token': apiKey,
  },
}));

module.exports = {
  getMainClient,
  createSubaccountClient,
  config,
  // Secrets exportados para declaracao em handlers (secrets: [...])
  ASAAS_API_KEY,
  ASAAS_PLATFORM_WALLET_ID,
  ASAAS_WEBHOOK_TOKEN,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
};
