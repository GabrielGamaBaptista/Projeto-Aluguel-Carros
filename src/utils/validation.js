// src/utils/validation.js

// ===== VALIDACAO DE CPF (algoritmo oficial) =====
export const validateCpf = (cpf) => {
  const clean = cpf.replace(/\D/g, '');
  if (clean.length !== 11) return false;

  // Rejeitar CPFs com todos os digitos iguais (ex: 111.111.111-11)
  if (/^(\d)\1{10}$/.test(clean)) return false;

  // Calcular primeiro digito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean.charAt(i)) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(clean.charAt(9))) return false;

  // Calcular segundo digito verificador
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(clean.charAt(i)) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(clean.charAt(10))) return false;

  return true;
};

// ===== VALIDACAO DE CNPJ (algoritmo oficial) =====
export const validateCnpj = (cnpj) => {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14) return false;
  if (/^(\d)\1+$/.test(d)) return false; // todos digitos iguais

  const calc = (digits, len) => {
    let sum = 0;
    let pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += parseInt(digits[len - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    return r === parseInt(digits[len]);
  };

  return calc(d, 12) && calc(d, 13);
};

// ===== VALIDACAO DE EMAIL =====
export const validateEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim().toLowerCase();
  // RFC 5322 simplificado
  const regex = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  if (!regex.test(trimmed)) return false;
  // Rejeitar dominios invalidos comuns
  if (trimmed.endsWith('.') || trimmed.includes('..')) return false;
  // Verificar que tem pelo menos um ponto no dominio
  const domain = trimmed.split('@')[1];
  if (!domain || !domain.includes('.')) return false;
  return true;
};

// ===== VALIDACAO DE DATA (DD/MM/AAAA) =====
export const validateDate = (dateStr) => {
  if (!dateStr || dateStr.length !== 10) return false;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return false;
  const day = parseInt(parts[0]);
  const month = parseInt(parts[1]);
  const year = parseInt(parts[2]);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 1900 || year > 2100) return false;
  // Verificar data valida
  const date = new Date(year, month - 1, day);
  return date.getDate() === day && date.getMonth() === month - 1 && date.getFullYear() === year;
};

// ===== VALIDACAO DE TELEFONE =====
export const validatePhone = (phone) => {
  const clean = phone.replace(/\D/g, '');
  return clean.length >= 10 && clean.length <= 11;
};

// ===== SANITIZACAO DE INPUTS =====
export const sanitizeText = (text) => {
  if (!text || typeof text !== 'string') return '';
  // Remover tags HTML/script
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/[<>"'`;]/g, '')
    .trim();
};

export const sanitizeNumeric = (text) => {
  if (!text) return '';
  return text.replace(/\D/g, '');
};

// ===== VALIDACAO DE SENHA (robusta) =====
export const validatePassword = (password) => {
  const errors = [];
  if (password.length < 6) errors.push('Minimo 6 caracteres');
  if (password.length > 128) errors.push('Maximo 128 caracteres');
  // Senhas comuns (brasileiras + universais)
  const common = [
    // Universais
    '123456', '654321', 'password', 'abcdef', '111111', '000000', 'qwerty',
    '123456789', '12345678', '12345', '1234567', '1234567890', '123123', '1234',
    'iloveyou', 'letmein', 'monkey', 'dragon', 'master', 'login', 'welcome',
    'passw0rd', 'pass123', '11111111', '22222222', 'aaaaaa', 'bbbbbb',
    '123321', '654123', '777777', '123abc', 'abc@123', 'hello123',
    // Brasileiras
    'senha', 'senha123', 'mudar123', 'mudar@123', 'abc123', 'admin', 'admin123',
    'teste', 'teste123', 'brasil', 'brasil123', 'futebol', 'flamengo',
    'senha@123', 'brasil@123', 'android', 'corinthians', 'palmeiras',
    'saopaulo', 'vasco', 'botafogo', 'cruzeiro', 'atletico',
  ];
  if (common.includes(password.toLowerCase())) errors.push('Senha muito comum');
  return { valid: errors.length === 0, errors };
};

// ===== BUSCA CEP (ViaCEP) =====
export const fetchAddressByCep = async (cep) => {
  const clean = cep.replace(/\D/g, '');
  if (clean.length !== 8) {
    return { success: false, error: 'CEP deve ter 8 digitos' };
  }

  try {
    const response = await fetch(`https://viacep.com.br/ws/${clean}/json/`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      return { success: false, error: 'Erro ao buscar CEP' };
    }

    const data = await response.json();

    if (data.erro) {
      return { success: false, error: 'CEP nao encontrado' };
    }

    return {
      success: true,
      data: {
        street: data.logradouro || '',
        neighborhood: data.bairro || '',
        city: data.localidade || '',
        state: data.uf || '',
        complement: data.complemento || '',
      },
    };
  } catch (error) {
    console.error('Fetch CEP error:', error);
    return { success: false, error: 'Erro de conexao ao buscar CEP' };
  }
};

// ===== FORMATO CEP =====
export const formatCep = (text) => {
  const nums = text.replace(/\D/g, '').slice(0, 8);
  if (nums.length <= 5) return nums;
  return nums.slice(0, 5) + '-' + nums.slice(5);
};
