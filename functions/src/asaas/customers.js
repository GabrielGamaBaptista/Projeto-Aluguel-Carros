/**
 * Módulo para gerenciamento de "customers" (clientes/pagadores) no Asaas.
 * No fluxo do app, o locatário é um cliente da subconta do locador.
 */
const { createSubaccountClient } = require('./client');

/**
 * Busca ou cria um cliente na subconta especificada.
 * Chama GET /v3/customers?cpfCnpj=xxx e, se não encontrar, POST /v3/customers.
 * 
 * @param {string} subaccountApiKey - A API Key da subconta do locador.
 * @param {Object} data - Dados do locatário vindos do Firestore.
 * @param {string} data.name - Nome do locatário.
 * @param {string} data.email - E-mail do locatário.
 * @param {string} data.cpfCnpj - CPF do locatário (apenas números).
 * @param {string} data.mobilePhone - Telefone (DDD + número).
 * @returns {Promise<string>} O ID do cliente no Asaas (cus_xxx).
 */
const createOrGetCustomer = async (subaccountApiKey, data) => {
  if (!data.cpfCnpj || data.cpfCnpj.trim() === '') {
    throw new Error('CPF/CNPJ do locatario e obrigatorio para criar customer no Asaas.');
  }

  const client = createSubaccountClient(subaccountApiKey);

  try {
    // 1. Tentar buscar o cliente pelo CPF/CNPJ na subconta do locador
    const listResponse = await client.get('/customers', {
      params: { cpfCnpj: data.cpfCnpj }
    });

    // Se encontrar algum cliente com esse CPF/CNPJ, retorna o primeiro ID
    if (listResponse.data && Array.isArray(listResponse.data.data) && listResponse.data.data.length > 0) {
      if (listResponse.data.data.length > 1) {
        const maskedDoc = data.cpfCnpj.length >= 4
          ? '*'.repeat(data.cpfCnpj.length - 3) + data.cpfCnpj.slice(-3)
          : '***';
        console.warn(`[customers] Multiplos customers encontrados para cpfCnpj ${maskedDoc} (${listResponse.data.data.length} registros). Usando o primeiro: ${listResponse.data.data[0].id}`);
      }
      return listResponse.data.data[0].id;
    }

    // 2. Se não encontrar, cria o cliente
    const createResponse = await client.post('/customers', {
      name: data.name,
      email: data.email,
      cpfCnpj: data.cpfCnpj,
      mobilePhone: data.mobilePhone,
    });

    return createResponse.data.id;
  } catch (error) {
    console.error('Erro ao criar ou buscar customer no Asaas:', error.response?.data || error.message);
    throw error;
  }
};

module.exports = { createOrGetCustomer };
