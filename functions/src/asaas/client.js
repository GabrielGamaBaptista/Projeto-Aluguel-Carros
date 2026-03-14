/**
 * Configuracao do cliente Axios para interagir com a API do Asaas.
 * Utiliza variaveis de ambiente (process.env) compativeis com Firebase Emulator e deploy.
 *
 * Para desenvolvimento local: definir em functions/.env.local
 * Para producao: definir no Google Cloud Console ou via Secret Manager
 */
const axios = require('axios');

// Le variaveis de ambiente — funciona tanto no emulador (via .env.local) quanto em producao
const config = {
  api_key: process.env.ASAAS_API_KEY || '',
  base_url: process.env.ASAAS_BASE_URL || 'https://sandbox.asaas.com/api/v3',
  platform_wallet_id: process.env.ASAAS_PLATFORM_WALLET_ID || '',
  platform_fee_percent: parseFloat(process.env.ASAAS_PLATFORM_FEE_PERCENT || '10'),
  webhook_token: process.env.ASAAS_WEBHOOK_TOKEN || '',
  webhook_url: process.env.ASAAS_WEBHOOK_URL || '',
};

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
 * Utilizado para operacoes que envolvem a plataforma, como criar subcontas.
 */
const asaasClient = addRetryInterceptor(axios.create({
  baseURL: config.base_url || 'https://sandbox.asaas.com/api/v3',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'access_token': config.api_key || '',
  },
}));

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

module.exports = { asaasClient, createSubaccountClient, config };
