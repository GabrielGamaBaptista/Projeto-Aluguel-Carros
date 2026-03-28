/**
 * Utilitários de validação para uso nas Cloud Functions.
 */

/**
 * Valida se os campos obrigatórios estão presentes no objeto de dados.
 * @param {string[]} fields - Lista de nomes de campos obrigatórios.
 * @param {Object} data - Objeto contendo os dados a serem validados.
 * @returns {string|null} Retorna uma mensagem de erro se faltar algum campo, ou null.
 */
const validateRequired = (fields, data) => {
  const missing = fields.filter(field => !data || data[field] === undefined || data[field] === null || data[field] === '');
  if (missing.length > 0) {
    return `Campos obrigatórios ausentes: ${missing.join(', ')}`;
  }
  return null;
};

/**
 * Valida se um valor de CPF ou CNPJ é válido (apenas formato básico e tamanho).
 * @param {string} value - O valor a ser validado.
 * @returns {boolean} True se for um formato válido.
 */
const validateCpfCnpj = (value) => {
  if (!value) return false;
  const cleanValue = value.replace(/\D/g, '');
  return cleanValue.length === 11 || cleanValue.length === 14;
};

/**
 * Valida se um valor numérico é um montante válido para cobrança.
 * @param {number} value - O valor a ser validado.
 * @returns {boolean} True se for um número positivo.
 */
const validateAmount = (value) => {
  const amount = parseFloat(value);
  return !isNaN(amount) && amount > 0;
};

/**
 * Valida se um valor pertence a um conjunto permitido de opcoes.
 * @param {*} value - Valor a validar.
 * @param {Array} allowed - Lista de valores permitidos.
 * @returns {boolean} True se valor estiver na lista.
 */
const validateEnum = (value, allowed) => allowed.includes(value);

/**
 * Valida se uma string nao ultrapassa o tamanho maximo.
 * @param {string} str - String a validar.
 * @param {number} maxLength - Comprimento maximo permitido.
 * @returns {boolean} True se dentro do limite.
 */
const validateStringLength = (str, maxLength) => {
  if (!str) return true; // campos opcionais sao validos quando ausentes
  return String(str).length <= maxLength;
};

module.exports = {
  validateRequired,
  validateCpfCnpj,
  validateAmount,
  validateEnum,
  validateStringLength,
};
