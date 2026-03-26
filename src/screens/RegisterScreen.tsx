// src/screens/RegisterScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { Building2, User, ClipboardList } from 'lucide-react-native';
import { showMessage } from 'react-native-flash-message';
import firestore from '@react-native-firebase/firestore';
import { authService } from '../services/authService';
import PhotoPicker from '../components/PhotoPicker';
import { uploadImageToCloudinary } from '../config/cloudinary';
import {
  validateCpf, validateCnpj, validateEmail, validateDate, validatePhone,
  validatePassword, sanitizeText, fetchAddressByCep, formatCep,
} from '../utils/validation';

const RegisterScreen = ({ navigation }) => {
  const [step, setStep] = useState(1);
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingCep, setLoadingCep] = useState(false);

  // Dados basicos
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');

  // Dados pessoais (ambos roles)
  const [cpf, setCpf] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [personType, setPersonType] = useState(''); // pf, pj, mei
  const [cnpj, setCnpj] = useState('');
  const [companyName, setCompanyName] = useState('');

  // Endereco (ambos)
  const [cep, setCep] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');

  // CNH + Docs (locatario only)
  const [cnhNumber, setCnhNumber] = useState('');
  const [cnhCategory, setCnhCategory] = useState('');
  const [cnhExpiry, setCnhExpiry] = useState('');
  const [cnhFrontPhoto, setCnhFrontPhoto] = useState('');
  const [cnhBackPhoto, setCnhBackPhoto] = useState('');
  const [residenceProofPhoto, setResidenceProofPhoto] = useState('');

  // Foto de perfil (opcional)
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);

  const [errors, setErrors] = useState({});
  const setError = (f, m) => setErrors(p => ({ ...p, [f]: m }));
  const clearError = (f) => setErrors(p => { const n = { ...p }; delete n[f]; return n; });

  // ===== FORMATTERS =====
  const formatCpfInput = (text) => {
    const nums = text.replace(/\D/g, '').slice(0, 11);
    if (nums.length <= 3) return nums;
    if (nums.length <= 6) return nums.slice(0, 3) + '.' + nums.slice(3);
    if (nums.length <= 9) return nums.slice(0, 3) + '.' + nums.slice(3, 6) + '.' + nums.slice(6);
    return nums.slice(0, 3) + '.' + nums.slice(3, 6) + '.' + nums.slice(6, 9) + '-' + nums.slice(9);
  };

  const formatCnpjInput = (text) => {
    const nums = text.replace(/\D/g, '').slice(0, 14);
    if (nums.length <= 2) return nums;
    if (nums.length <= 5) return nums.slice(0,2) + '.' + nums.slice(2);
    if (nums.length <= 8) return nums.slice(0,2) + '.' + nums.slice(2,5) + '.' + nums.slice(5);
    if (nums.length <= 12) return nums.slice(0,2) + '.' + nums.slice(2,5) + '.' + nums.slice(5,8) + '/' + nums.slice(8);
    return nums.slice(0,2) + '.' + nums.slice(2,5) + '.' + nums.slice(5,8) + '/' + nums.slice(8,12) + '-' + nums.slice(12);
  };

  const formatDate = (text) => {
    const nums = text.replace(/\D/g, '').slice(0, 8);
    if (nums.length <= 2) return nums;
    if (nums.length <= 4) return nums.slice(0, 2) + '/' + nums.slice(2);
    return nums.slice(0, 2) + '/' + nums.slice(2, 4) + '/' + nums.slice(4);
  };

  const formatPhone = (text) => {
    const nums = text.replace(/\D/g, '').slice(0, 11);
    if (nums.length <= 2) return '(' + nums;
    if (nums.length <= 7) return '(' + nums.slice(0, 2) + ') ' + nums.slice(2);
    return '(' + nums.slice(0, 2) + ') ' + nums.slice(2, 7) + '-' + nums.slice(7);
  };

  // ===== CEP AUTOCOMPLETE =====
  const handleCepChange = async (text) => {
    const formatted = formatCep(text);
    setCep(formatted);
    clearError('cep');
    const clean = text.replace(/\D/g, '');
    if (clean.length === 8) {
      setLoadingCep(true);
      const result = await fetchAddressByCep(clean);
      setLoadingCep(false);
      if (result.success) {
        setStreet(result.data.street);
        setNeighborhood(result.data.neighborhood);
        setCity(result.data.city);
        setState(result.data.state);
        if (result.data.complement) setComplement(result.data.complement);
      } else {
        setError('cep', result.error);
      }
    }
  };

  // Locador: 1(role) 2(basicos) 3(cpf/tipo) 4(endereco) = 4 steps
  // Locatario: 1(role) 2(basicos) 3(cpf/dados) 4(endereco) 5(cnh) 6(comprovante) = 6 steps
  const totalSteps = role === 'locador' ? 4 : 6;

  // ===== VALIDACOES =====
  const validateStep1 = () => {
    if (!role) { Alert.alert('Erro', 'Selecione o tipo de conta.'); return false; }
    return true;
  };

  const validateStep2 = async () => {
    const newErrors = {};
    const cleanName = sanitizeText(name);
    if (!cleanName || cleanName.length < 3) newErrors.name = 'Nome deve ter pelo menos 3 caracteres';
    if (cleanName.length > 100) newErrors.name = 'Nome muito longo';
    if (!validateEmail(email)) newErrors.email = 'Email invalido';
    const pwdResult = validatePassword(password);
    if (!pwdResult.valid) newErrors.password = pwdResult.errors.join('. ');
    if (password !== confirmPassword) newErrors.confirmPassword = 'As senhas nao coincidem';
    if (!phone.trim() || !validatePhone(phone)) newErrors.phone = 'Telefone obrigatorio e valido';

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) { Alert.alert('Erro', Object.values(newErrors)[0]); return false; }

    const emailCheck = await authService.checkEmailExists(email.trim().toLowerCase());
    if (emailCheck.exists) { setErrors({ email: 'Email ja em uso.' }); Alert.alert('Erro', 'Email ja em uso.'); return false; }

    const phoneCheck = await authService.checkPhoneExists(phone.replace(/\D/g, ''));
    if (phoneCheck.exists) { setErrors({ phone: 'Numero ja cadastrado.' }); Alert.alert('Erro', 'Numero ja cadastrado.'); return false; }
    return true;
  };

  const validateBirthDate = (date, errors) => {
    if (!date.trim()) { errors.birthDate = 'Data obrigatoria'; return; }
    if (!validateDate(date)) { errors.birthDate = 'Data invalida (DD/MM/AAAA)'; return; }
    const parts = date.split('/');
    const birth = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    const age = (new Date() - birth) / (365.25 * 24 * 60 * 60 * 1000);
    if (age < 18) errors.birthDate = 'Minimo 18 anos';
    if (age > 120) errors.birthDate = 'Data invalida';
  };

  const validateStep3 = async () => {
    const newErrors = {};

    if (role === 'locador') {
      if (!personType) {
        newErrors.personType = 'Selecione o tipo de pessoa';
      } else if (personType === 'pf') {
        if (!validateCpf(cpf)) newErrors.cpf = 'CPF invalido';
        validateBirthDate(birthDate, newErrors);
      } else {
        if (!validateCnpj(cnpj)) newErrors.cnpj = 'CNPJ invalido';
      }
    } else {
      if (!validateCpf(cpf)) newErrors.cpf = 'CPF invalido';
      validateBirthDate(birthDate, newErrors);
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) { Alert.alert('Erro', Object.values(newErrors)[0]); return false; }

    if (role === 'locador' && (personType === 'pj' || personType === 'mei')) {
      const check = await authService.checkDocumentExists(cnpj, 'cnpj');
      if (check.exists) { setErrors({ cnpj: 'CNPJ ja cadastrado.' }); Alert.alert('Erro', 'CNPJ ja cadastrado.'); return false; }
    } else {
      const check = await authService.checkDocumentExists(cpf, 'cpf');
      if (check.exists) { setErrors({ cpf: 'CPF ja cadastrado.' }); Alert.alert('Erro', 'CPF ja cadastrado.'); return false; }
    }
    return true;
  };

  const validateStep4 = () => {
    const newErrors = {};
    if (cep.replace(/\D/g, '').length !== 8) newErrors.cep = 'CEP invalido';
    if (!street.trim()) newErrors.street = 'Rua obrigatoria';
    if (!number.trim()) newErrors.number = 'Numero obrigatorio';
    if (!city.trim()) newErrors.city = 'Cidade obrigatoria';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) { Alert.alert('Erro', Object.values(newErrors)[0]); return false; }
    return true;
  };

  const validateStep5 = () => {
    const newErrors = {};
    if (!cnhNumber.trim()) newErrors.cnhNumber = 'Numero da CNH obrigatorio';
    if (cnhNumber.trim() && !/^\d{9,11}$/.test(cnhNumber.replace(/\D/g, ''))) newErrors.cnhNumber = 'CNH invalida (9-11 digitos)';
    if (!cnhCategory.trim()) newErrors.cnhCategory = 'Categoria obrigatoria';
    if (!cnhExpiry.trim()) newErrors.cnhExpiry = 'Validade obrigatoria';
    else if (!validateDate(cnhExpiry)) newErrors.cnhExpiry = 'Data invalida';
    if (!cnhFrontPhoto) newErrors.cnhFront = 'Foto da frente obrigatoria';
    if (!cnhBackPhoto) newErrors.cnhBack = 'Foto do verso obrigatoria';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) { Alert.alert('Erro', Object.values(newErrors)[0]); return false; }
    return true;
  };

  const validateStep6 = () => {
    if (!residenceProofPhoto) { Alert.alert('Erro', 'Envie o comprovante de residencia.'); return false; }
    return true;
  };

  // ===== NAVIGATION =====
  const nextStep = async () => {
    if (loading) return;
    setLoading(true);
    try {
      if (step === 1 && validateStep1()) setStep(2);
      else if (step === 2) { if (await validateStep2()) setStep(3); }
      else if (step === 3) { if (await validateStep3()) setStep(4); }
      else if (step === 4 && validateStep4()) {
        if (role === 'locador') { await handleRegister(); return; }
        else setStep(5);
      }
      else if (step === 5 && validateStep5()) setStep(6);
      else if (step === 6 && validateStep6()) { await handleRegister(); return; }
    } catch (e) { Alert.alert('Erro', 'Erro ao validar.'); }
    setLoading(false);
  };

  const handleRegister = async () => {
    const cleanName = sanitizeText(name);
    const fullAddress = `${street}, ${number}${complement ? ' - ' + complement : ''}, ${neighborhood}, ${city} - ${state}, CEP ${cep}`;
    const userData = {
      name: cleanName, role, phone: phone.replace(/\D/g, ''),
      cpf: cpf.replace(/\D/g, ''), birthDate,
      personType: role === 'locador' ? personType : 'pf',
      cnpj: cnpj.replace(/\D/g, ''), companyName: sanitizeText(companyName),
      cep: cep.replace(/\D/g, ''), street: sanitizeText(street), number: sanitizeText(number),
      complement: sanitizeText(complement), neighborhood: sanitizeText(neighborhood),
      city: sanitizeText(city), state, address: fullAddress,
      // Foto de perfil e diferida — enviada apos a conta ser criada (usuario autenticado)
      profilePhoto: null,
    };
    if (role === 'locatario') {
      userData.cnhNumber = cnhNumber.replace(/\D/g, '');
      userData.cnhCategory = cnhCategory.toUpperCase().trim();
      userData.cnhExpiry = cnhExpiry;
      userData.cnhFrontPhoto = '';
      userData.cnhBackPhoto = '';
      userData.residenceProofPhoto = '';
    }
    const result = await authService.register(email.trim().toLowerCase(), password, userData);

    // Apos criar conta (usuario agora autenticado), faz upload das fotos diferidas
    if (result.success) {
      const uid = result.user.uid;
      // profilePhoto vai para o doc publico; CNH/comprovante vao para private/data
      const publicUploads: { key: string; uri: string }[] = [];
      const privateUploads: { key: string; uri: string }[] = [];
      if (profilePhoto) publicUploads.push({ key: 'profilePhoto', uri: profilePhoto });
      if (role === 'locatario') {
        if (cnhFrontPhoto) privateUploads.push({ key: 'cnhFrontPhoto', uri: cnhFrontPhoto });
        if (cnhBackPhoto) privateUploads.push({ key: 'cnhBackPhoto', uri: cnhBackPhoto });
        if (residenceProofPhoto) privateUploads.push({ key: 'residenceProofPhoto', uri: residenceProofPhoto });
      }
      if (publicUploads.length > 0 || privateUploads.length > 0) {
        const publicUpdates: Record<string, string> = {};
        const privateUpdates: Record<string, string> = {};
        await Promise.all([...publicUploads, ...privateUploads].map(async ({ key, uri }) => {
          const up = await uploadImageToCloudinary(uri);
          if (up.success) {
            if (publicUploads.some(u => u.key === key)) publicUpdates[key] = up.url;
            else privateUpdates[key] = up.url;
          } else {
            console.warn(`[RegisterScreen] Falha ao enviar ${key}:`, up.error);
          }
        }));
        try {
          const batch = firestore().batch();
          if (Object.keys(publicUpdates).length > 0) {
            batch.update(firestore().collection('users').doc(uid), publicUpdates);
          }
          if (Object.keys(privateUpdates).length > 0) {
            batch.update(
              firestore().collection('users').doc(uid).collection('private').doc('data'),
              privateUpdates
            );
          }
          await batch.commit();
        } catch (e) {
          console.error('[RegisterScreen] Erro ao salvar URLs das fotos:', e);
        }
      }
    }

    setLoading(false);
    if (result.success) {
      await authService.logout();
      showMessage({ message: 'Conta criada! Faca login para continuar.', type: 'success' });
      navigation.navigate('Login');
    } else Alert.alert('Erro', result.error);
  };

  const ErrorText = ({ field }) => errors[field] ? <Text style={styles.errorText}>{errors[field]}</Text> : null;
  const isLastStep = (role === 'locador' && step === 4) || step === 6;

  // ===== RENDER STEPS =====
  const renderStep1 = () => (
    <View>
      <Text style={styles.stepTitle}>Tipo de Conta</Text>
      <Text style={styles.stepSubtitle}>Selecione como voce vai usar o app</Text>
      <TouchableOpacity style={[styles.roleCard, role === 'locador' && styles.roleCardActive]} onPress={() => setRole('locador')}>
        <Building2 size={36} color={role === 'locador' ? '#4F46E5' : '#6B7280'} style={{ marginRight: 16 }} />
        <View style={styles.roleInfo}><Text style={[styles.roleTitle, role === 'locador' && styles.roleTitleActive]}>Locador</Text><Text style={styles.roleDesc}>Gerencio veiculos e locatarios</Text></View>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.roleCard, role === 'locatario' && styles.roleCardActive]} onPress={() => setRole('locatario')}>
        <User size={36} color={role === 'locatario' ? '#4F46E5' : '#6B7280'} style={{ marginRight: 16 }} />
        <View style={styles.roleInfo}><Text style={[styles.roleTitle, role === 'locatario' && styles.roleTitleActive]}>Locatario</Text><Text style={styles.roleDesc}>Alugo veiculo e gerencio tarefas</Text></View>
      </TouchableOpacity>
    </View>
  );

  const renderStep2 = () => (
    <View>
      <Text style={styles.stepTitle}>Dados Basicos</Text>
      <PhotoPicker
        label="Foto de Perfil (opcional)"
        onPhotoSelected={setProfilePhoto}
        currentPhotoUrl={profilePhoto}
        deferred
      />
      <View style={styles.field}><Text style={styles.label}>Nome Completo *</Text>
        <TextInput style={[styles.input, errors.name && styles.inputError]} placeholder="Seu nome completo" placeholderTextColor="#9CA3AF" value={name} onChangeText={(t) => { setName(t); clearError('name'); }} autoCapitalize="words" maxLength={100} /><ErrorText field="name" /></View>
      <View style={styles.field}><Text style={styles.label}>Email *</Text>
        <TextInput style={[styles.input, errors.email && styles.inputError]} placeholder="seu@email.com" placeholderTextColor="#9CA3AF" value={email} onChangeText={(t) => { setEmail(t); clearError('email'); }} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} /><ErrorText field="email" /></View>
      <View style={styles.field}><Text style={styles.label}>Telefone *</Text>
        <TextInput style={[styles.input, errors.phone && styles.inputError]} placeholder="(00) 00000-0000" placeholderTextColor="#9CA3AF" value={phone} onChangeText={(t) => { setPhone(formatPhone(t)); clearError('phone'); }} keyboardType="phone-pad" /><ErrorText field="phone" /></View>
      <View style={styles.field}><Text style={styles.label}>Senha * (minimo 6)</Text>
        <TextInput style={[styles.input, errors.password && styles.inputError]} placeholder="Sua senha" placeholderTextColor="#9CA3AF" value={password} onChangeText={(t) => { setPassword(t); clearError('password'); }} secureTextEntry autoCapitalize="none" /><ErrorText field="password" /></View>
      <View style={styles.field}><Text style={styles.label}>Confirmar Senha *</Text>
        <TextInput style={[styles.input, errors.confirmPassword && styles.inputError]} placeholder="Repita a senha" placeholderTextColor="#9CA3AF" value={confirmPassword} onChangeText={(t) => { setConfirmPassword(t); clearError('confirmPassword'); }} secureTextEntry autoCapitalize="none" /><ErrorText field="confirmPassword" /></View>
    </View>
  );

  const renderStep3 = () => {
    const isPjOrMei = personType === 'pj' || personType === 'mei';
    return (
      <View>
        <Text style={styles.stepTitle}>Dados Pessoais</Text>

        {role === 'locador' ? (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Tipo de Pessoa *</Text>
              <View style={styles.personTypeRow}>
                {[{ key: 'pf', label: 'Pessoa Fisica' }, { key: 'pj', label: 'Pessoa Juridica' }, { key: 'mei', label: 'MEI' }].map(pt => {
                  const isActive = personType === pt.key;
                  const iconColor = isActive ? '#4F46E5' : '#6B7280';
                  return (
                    <TouchableOpacity key={pt.key} style={[styles.personTypeCard, isActive && styles.personTypeActive]}
                      onPress={() => { setPersonType(pt.key); clearError('personType'); setCpf(''); setBirthDate(''); setCnpj(''); setCompanyName(''); }}>
                      <View style={styles.personTypeIcon}>
                        {pt.key === 'pf' && <User size={22} color={iconColor} />}
                        {pt.key === 'pj' && <Building2 size={22} color={iconColor} />}
                        {pt.key === 'mei' && <ClipboardList size={22} color={iconColor} />}
                      </View>
                      <Text style={[styles.personTypeLabel, isActive && styles.personTypeLabelActive]}>{pt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <ErrorText field="personType" />
            </View>

            {personType === 'pf' && (
              <>
                <View style={styles.field}><Text style={styles.label}>CPF *</Text>
                  <TextInput style={[styles.input, errors.cpf && styles.inputError]} placeholder="000.000.000-00" placeholderTextColor="#9CA3AF" value={cpf} onChangeText={(t) => { setCpf(formatCpfInput(t)); clearError('cpf'); }} keyboardType="numeric" /><ErrorText field="cpf" /></View>
                <View style={styles.field}><Text style={styles.label}>Data de Nascimento *</Text>
                  <TextInput style={[styles.input, errors.birthDate && styles.inputError]} placeholder="DD/MM/AAAA" placeholderTextColor="#9CA3AF" value={birthDate} onChangeText={(t) => { setBirthDate(formatDate(t)); clearError('birthDate'); }} keyboardType="numeric" /><ErrorText field="birthDate" /></View>
              </>
            )}

            {isPjOrMei && (
              <>
                <View style={styles.field}><Text style={styles.label}>CNPJ *</Text>
                  <TextInput style={[styles.input, errors.cnpj && styles.inputError]} placeholder="00.000.000/0000-00" placeholderTextColor="#9CA3AF" value={cnpj} onChangeText={(t) => { setCnpj(formatCnpjInput(t)); clearError('cnpj'); }} keyboardType="numeric" /><ErrorText field="cnpj" /></View>
                <View style={styles.field}><Text style={styles.label}>Razao Social / Nome Fantasia</Text>
                  <TextInput style={styles.input} placeholder="Nome da empresa" placeholderTextColor="#9CA3AF" value={companyName} onChangeText={setCompanyName} /></View>
              </>
            )}
          </>
        ) : (
          <>
            <View style={styles.field}><Text style={styles.label}>CPF *</Text>
              <TextInput style={[styles.input, errors.cpf && styles.inputError]} placeholder="000.000.000-00" placeholderTextColor="#9CA3AF" value={cpf} onChangeText={(t) => { setCpf(formatCpfInput(t)); clearError('cpf'); }} keyboardType="numeric" /><ErrorText field="cpf" /></View>
            <View style={styles.field}><Text style={styles.label}>Data de Nascimento *</Text>
              <TextInput style={[styles.input, errors.birthDate && styles.inputError]} placeholder="DD/MM/AAAA" placeholderTextColor="#9CA3AF" value={birthDate} onChangeText={(t) => { setBirthDate(formatDate(t)); clearError('birthDate'); }} keyboardType="numeric" /><ErrorText field="birthDate" /></View>
          </>
        )}
      </View>
    );
  };

  const renderStep4 = () => (
    <View>
      <Text style={styles.stepTitle}>Endereco</Text>
      <View style={styles.field}>
        <Text style={styles.label}>CEP *</Text>
        <View style={styles.cepRow}>
          <TextInput style={[styles.input, styles.cepInput, errors.cep && styles.inputError]}
            placeholder="00000-000" placeholderTextColor="#9CA3AF" value={cep} onChangeText={handleCepChange} keyboardType="numeric" />
          {loadingCep && <ActivityIndicator size="small" color="#4F46E5" style={styles.cepLoader} />}
        </View>
        <ErrorText field="cep" />
      </View>
      <View style={styles.field}><Text style={styles.label}>Rua *</Text>
        <TextInput style={[styles.input, errors.street && styles.inputError, street && styles.inputFilled]} placeholder="Rua / Avenida" placeholderTextColor="#9CA3AF" value={street} onChangeText={(t) => { setStreet(t); clearError('street'); }} editable={!loadingCep} /><ErrorText field="street" /></View>
      <View style={styles.row}>
        <View style={[styles.field, { flex: 1, marginRight: 8 }]}><Text style={styles.label}>Numero *</Text>
          <TextInput style={[styles.input, errors.number && styles.inputError]} placeholder="Nro" placeholderTextColor="#9CA3AF" value={number} onChangeText={(t) => { setNumber(t); clearError('number'); }} keyboardType="numeric" /><ErrorText field="number" /></View>
        <View style={[styles.field, { flex: 2, marginLeft: 8 }]}><Text style={styles.label}>Complemento</Text>
          <TextInput style={styles.input} placeholder="Apto, bloco" placeholderTextColor="#9CA3AF" value={complement} onChangeText={setComplement} /></View>
      </View>
      <View style={styles.field}><Text style={styles.label}>Bairro</Text>
        <TextInput style={[styles.input, neighborhood && styles.inputFilled]} placeholder="Bairro" placeholderTextColor="#9CA3AF" value={neighborhood} onChangeText={setNeighborhood} editable={!loadingCep} /></View>
      <View style={styles.row}>
        <View style={[styles.field, { flex: 2, marginRight: 8 }]}><Text style={styles.label}>Cidade</Text>
          <TextInput style={[styles.input, city && styles.inputFilled]} placeholder="Cidade" placeholderTextColor="#9CA3AF" value={city} onChangeText={setCity} editable={!loadingCep} /><ErrorText field="city" /></View>
        <View style={[styles.field, { flex: 1, marginLeft: 8 }]}><Text style={styles.label}>UF</Text>
          <TextInput style={[styles.input, state && styles.inputFilled]} placeholder="UF" placeholderTextColor="#9CA3AF" value={state} onChangeText={setState} maxLength={2} autoCapitalize="characters" editable={!loadingCep} /></View>
      </View>
    </View>
  );

  const renderStep5 = () => (
    <View>
      <Text style={styles.stepTitle}>Dados da CNH</Text>
      <View style={styles.field}><Text style={styles.label}>Numero da CNH *</Text>
        <TextInput style={[styles.input, errors.cnhNumber && styles.inputError]} placeholder="Numero do registro" placeholderTextColor="#9CA3AF" value={cnhNumber} onChangeText={(t) => { setCnhNumber(t); clearError('cnhNumber'); }} keyboardType="numeric" maxLength={11} /><ErrorText field="cnhNumber" /></View>
      <View style={styles.row}>
        <View style={[styles.field, { flex: 1, marginRight: 8 }]}><Text style={styles.label}>Categoria *</Text>
          <TextInput style={[styles.input, errors.cnhCategory && styles.inputError]} placeholder="Ex: AB" placeholderTextColor="#9CA3AF" value={cnhCategory} onChangeText={(t) => { setCnhCategory(t); clearError('cnhCategory'); }} autoCapitalize="characters" maxLength={2} /><ErrorText field="cnhCategory" /></View>
        <View style={[styles.field, { flex: 1, marginLeft: 8 }]}><Text style={styles.label}>Validade *</Text>
          <TextInput style={[styles.input, errors.cnhExpiry && styles.inputError]} placeholder="DD/MM/AAAA" placeholderTextColor="#9CA3AF" value={cnhExpiry} onChangeText={(t) => { setCnhExpiry(formatDate(t)); clearError('cnhExpiry'); }} keyboardType="numeric" /><ErrorText field="cnhExpiry" /></View>
      </View>
      <Text style={styles.sectionLabel}>Foto CNH - Frente *</Text>
      <PhotoPicker label="Frente da CNH" onPhotoSelected={setCnhFrontPhoto} currentPhotoUrl={cnhFrontPhoto} deferred />
      <ErrorText field="cnhFront" />
      <Text style={styles.sectionLabel}>Foto CNH - Verso *</Text>
      <PhotoPicker label="Verso da CNH" onPhotoSelected={setCnhBackPhoto} currentPhotoUrl={cnhBackPhoto} deferred />
      <ErrorText field="cnhBack" />
    </View>
  );

  const renderStep6 = () => (
    <View>
      <Text style={styles.stepTitle}>Comprovante de Residencia</Text>
      <Text style={styles.stepSubtitle}>Envie uma foto do comprovante recente (conta de luz, agua, internet).</Text>
      <PhotoPicker label="Comprovante de Residencia" onPhotoSelected={setResidenceProofPhoto} currentPhotoUrl={residenceProofPhoto} deferred />
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.progressContainer}>
          {Array.from({ length: totalSteps }, (_, i) => (
            <View key={i} style={[styles.progressDot, i + 1 <= step && styles.progressDotActive]} />
          ))}
        </View>
        <Text style={styles.stepIndicator}>Passo {step} de {totalSteps}</Text>

        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
        {step === 5 && renderStep5()}
        {step === 6 && renderStep6()}

        <View style={styles.buttonsRow}>
          {step > 1 && (
            <TouchableOpacity style={styles.backButton} onPress={() => { setStep(step - 1); setErrors({}); }}>
              <Text style={styles.backButtonText}>Voltar</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.nextButton, loading && styles.buttonDisabled, step === 1 && { flex: 1 }]}
            onPress={nextStep} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> :
              <Text style={styles.nextButtonText}>{isLastStep ? 'Criar Conta' : 'Proximo'}</Text>}
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.loginLink} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.loginLinkText}>Ja tem conta? <Text style={styles.loginLinkBold}>Fazer login</Text></Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { flexGrow: 1, padding: 24, paddingTop: 16 },
  progressContainer: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 8 },
  progressDot: { width: 24, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB' },
  progressDotActive: { backgroundColor: '#4F46E5' },
  stepIndicator: { textAlign: 'center', fontSize: 12, color: '#6B7280', marginBottom: 24 },
  stepTitle: { fontSize: 24, fontWeight: 'bold', color: '#1F2937', marginBottom: 8 },
  stepSubtitle: { fontSize: 14, color: '#6B7280', marginBottom: 24 },
  roleCard: { flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 12, borderWidth: 2, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB', marginBottom: 12 },
  roleCardActive: { borderColor: '#4F46E5', backgroundColor: '#EEF2FF' },
  roleIcon: { fontSize: 36, marginRight: 16 },
  roleInfo: { flex: 1 },
  roleTitle: { fontSize: 18, fontWeight: 'bold', color: '#374151' },
  roleTitleActive: { color: '#4F46E5' },
  roleDesc: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  field: { marginBottom: 18 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#F9FAFB', color: '#1F2937' },
  inputError: { borderColor: '#DC2626', backgroundColor: '#FEF2F2' },
  inputFilled: { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' },
  errorText: { color: '#DC2626', fontSize: 12, marginTop: 4 },
  sectionLabel: { fontSize: 16, fontWeight: 'bold', color: '#1F2937', marginTop: 16, marginBottom: 4 },
  row: { flexDirection: 'row' },
  cepRow: { flexDirection: 'row', alignItems: 'center' },
  cepInput: { flex: 1 },
  cepLoader: { marginLeft: 12 },
  personTypeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  personTypeCard: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 2, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB', alignItems: 'center' },
  personTypeActive: { borderColor: '#4F46E5', backgroundColor: '#EEF2FF' },
  personTypeIcon: { marginBottom: 4, alignItems: 'center' },
  personTypeLabel: { fontSize: 12, fontWeight: '600', color: '#6B7280', textAlign: 'center' },
  personTypeLabelActive: { color: '#4F46E5' },
  buttonsRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  backButton: { flex: 1, padding: 16, borderRadius: 8, borderWidth: 2, borderColor: '#D1D5DB', alignItems: 'center' },
  backButtonText: { fontSize: 16, fontWeight: 'bold', color: '#374151' },
  nextButton: { flex: 2, padding: 16, borderRadius: 8, backgroundColor: '#4F46E5', alignItems: 'center' },
  nextButtonText: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  buttonDisabled: { opacity: 0.6 },
  loginLink: { marginTop: 20, marginBottom: 40, alignItems: 'center' },
  loginLinkText: { color: '#6B7280', fontSize: 14 },
  loginLinkBold: { color: '#4F46E5', fontWeight: 'bold' },
});

export default RegisterScreen;
