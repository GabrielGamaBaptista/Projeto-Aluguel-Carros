/**
 * Módulo para gerenciamento de contas do Asaas.
 * Realiza a criação de subcontas para locadores utilizando a API Key da plataforma.
 */
const { getMainClient } = require('./client');

/**
 * Mapeia o tipo de pessoa do app (pf, pj, mei) para o companyType esperado pelo Asaas.
 * @param {string} personType - O tipo de pessoa no formato do app.
 * @returns {string|null} O tipo de empresa correspondente.
 */
const mapPersonTypeToAsaas = (personType) => {
  const mapping = {
    'pf': 'INDIVIDUAL',
    'pj': 'LIMITED',
    'mei': 'MEI'
  };
  return mapping[personType] || 'INDIVIDUAL';
};

/**
 * Converte uma data de nascimento no formato DD/MM/YYYY para YYYY-MM-DD.
 * @param {string} date - A data no formato DD/MM/YYYY.
 * @returns {string} A data no formato YYYY-MM-DD.
 */
const formatBirthDate = (date) => {
  if (!date || !date.includes('/')) return date;
  const [day, month, year] = date.split('/');
  return `${year}-${month}-${day}`;
};

/**
 * Cria uma subconta no Asaas para o locador.
 * Chama POST /v3/accounts utilizando o cliente da plataforma.
 * 
 * @param {Object} data - Dados do locador vindos do Firestore.
 * @param {string} data.name - Nome completo.
 * @param {string} data.email - E-mail de cadastro.
 * @param {string} data.cpfCnpj - CPF ou CNPJ (apenas números).
 * @param {string} data.birthDate - Data de nascimento (DD/MM/YYYY).
 * @param {string} data.personType - Tipo de pessoa (pf, pj, mei).
 * @param {string} data.mobilePhone - Telefone (DDD + número).
 * @param {string} data.address - Nome da rua.
 * @param {string} data.addressNumber - Número.
 * @param {string} data.neighborhood - Bairro.
 * @param {string} data.postalCode - CEP (apenas números).
 * @param {number} data.incomeValue - Renda mensal informada.
 * @returns {Promise<Object>} Resposta da API do Asaas (contém id, walletId, apiKey).
 */
const createSubaccount = async (data) => {
  try {
    const payload = {
      name: data.name,
      email: data.email,
      cpfCnpj: data.cpfCnpj,
      mobilePhone: data.mobilePhone,
      address: data.address,
      addressNumber: data.addressNumber,
      province: data.neighborhood, // Asaas chama bairro de 'province'
      postalCode: data.postalCode,
      city: data.city,
      state: data.state,
      incomeValue: data.incomeValue || 5000,
    };

    // birthDate só é enviado para PF — PJ/MEI não tem data de nascimento
    const isPf = !data.personType || data.personType === 'pf';
    if (isPf && data.birthDate) {
      payload.birthDate = formatBirthDate(data.birthDate);
    }

    // companyType só é enviado para PJ/MEI — para PF o campo deve ser omitido
    if (data.personType && data.personType !== 'pf') {
      payload.companyType = mapPersonTypeToAsaas(data.personType);
    }

    const response = await getMainClient().post('/accounts', payload);
    return response.data;
  } catch (error) {
    const asaasErrors = error.response?.data?.errors || [];
    const emailInUse = asaasErrors.some(e =>
      e.description && e.description.includes('já está em uso')
    );

    if (emailInUse) {
      // Conta já existe no Asaas — busca pelo CPF/CNPJ para recuperar apiKey
      console.log('Email já em uso no Asaas. Buscando conta existente pelo CPF/CNPJ...');
      const search = await getMainClient().get('/accounts', {
        params: { cpfCnpj: data.cpfCnpj }
      });
      const existing = search.data?.data?.[0];
      if (existing) {
        console.log('Conta existente encontrada no Asaas, id:', existing.id);
        return existing;
      }
      console.error('Conta não encontrada pelo CPF/CNPJ após erro de email em uso.');
    }

    const asaasDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error('[createSubaccount] Erro Asaas | status:', error.response?.status, '| body:', asaasDetail);
    throw error;
  }
};

module.exports = { createSubaccount };
