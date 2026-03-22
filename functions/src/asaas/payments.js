/**
 * Módulo para gerenciamento de cobranças (pagamentos) no Asaas.
 * Inclui criação de cobranças com split e geração de QR Code Pix.
 */
const { createSubaccountClient, config } = require('./client');

/**
 * Cria uma cobrança na subconta do locador com split para a plataforma.
 * 
 * @param {string} subaccountApiKey - A API Key da subconta do locador.
 * @param {Object} data - Dados da cobrança.
 * @param {string} data.customer - ID do customer no Asaas (cus_xxx).
 * @param {string} data.billingType - Tipo: 'PIX', 'BOLETO', 'CREDIT_CARD'.
 * @param {number} data.value - Valor da cobrança.
 * @param {string} data.dueDate - Data de vencimento (YYYY-MM-DD).
 * @param {string} data.description - Descrição da cobrança.
 * @param {string} data.externalReference - O chargeId no Firestore.
 * @returns {Promise<Object>} Resposta da API do Asaas (pay_xxx).
 */
const createPayment = async (subaccountApiKey, data) => {
  const client = createSubaccountClient(subaccountApiKey);

  try {
    const payload = {
      customer: data.customer,
      billingType: data.billingType,
      value: data.value,
      dueDate: data.dueDate,
      description: data.description,
      externalReference: data.externalReference,
    };

    // Incluir split apenas quando platform_wallet_id estiver configurado
    if (config.platform_wallet_id) {
      payload.split = [
        {
          walletId: config.platform_wallet_id,
          percentualValue: config.platform_fee_percent,
        }
      ];
    }

    // Idempotency key: usa o externalReference (chargeId Firestore) para evitar cobrancas duplicadas em retentativas (Q2.8)
    const headers = {};
    if (payload.externalReference) {
      headers['X-Idempotency-Key'] = payload.externalReference;
    }

    const response = await client.post('/payments', payload, { headers });
    return response.data;
  } catch (error) {
    console.error('Erro ao criar pagamento no Asaas:', error.response?.data || error.message);
    throw error;
  }
};

/**
 * Obtém o QR Code Pix de uma cobrança específica.
 * Chama GET /v3/payments/{id}/pixQrCode na subconta do locador.
 * 
 * @param {string} subaccountApiKey - A API Key da subconta do locador.
 * @param {string} paymentId - O ID da cobrança no Asaas (pay_xxx).
 * @returns {Promise<Object>} Resposta com success, encodedImage e payload.
 */
const getPixQrCode = async (subaccountApiKey, paymentId) => {
  const client = createSubaccountClient(subaccountApiKey);

  try {
    const response = await client.get(`/payments/${paymentId}/pixQrCode`);
    return response.data;
  } catch (error) {
    console.error('Erro ao buscar QR Code Pix:', error.response?.data || error.message);
    throw error;
  }
};

module.exports = { createPayment, getPixQrCode };
