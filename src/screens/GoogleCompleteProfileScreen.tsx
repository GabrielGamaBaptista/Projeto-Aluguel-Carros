// src/screens/GoogleCompleteProfileScreen.tsx
// Usa EXATAMENTE a mesma logica do RegisterScreen (CEP, validacoes, campos)
// Diferenca: nao pede email/senha (ja veio do Google)
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { authService } from '../services/authService';
import PhotoPicker from '../components/PhotoPicker';
import {
  validateCpf, validateCnpj, validateDate, validatePhone,
  sanitizeText, fetchAddressByCep, formatCep,
} from '../utils/validation';

const GoogleCompleteProfileScreen = ({ onComplete }) => {
  const user = authService.getCurrentUser();
  const [step, setStep] = useState(1);
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingCep, setLoadingCep] = useState(false);

  // Dados basicos
  const [name, setName] = useState(user?.displayName || '');
  const [phone, setPhone] = useState('');

  // Dados pessoais (ambos)
  const [cpf, setCpf] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [personType, setPersonType] = useState('');
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

  // CNH + docs (locatario only)
  const [cnhNumber, setCnhNumber] = useState('');
  const [cnhCategory, setCnhCategory] = useState('');
  const [cnhExpiry, setCnhExpiry] = useState('');
  const [cnhFrontPhoto, setCnhFrontPhoto] = useState('');
  const [cnhBackPhoto, setCnhBackPhoto] = useState('');
  const [residenceProofPhoto, setResidenceProofPhoto] = useState('');

  const [errors, setErrors] = useState({});
  const setError = (f, m) => setErrors(p => ({ ...p, [f]: m }));
  const clearError = (f) => setErrors(p => { const n = { ...p }; delete n[f]; return n; });

  // ===== FORMATTERS (identicos ao RegisterScreen) =====
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

  // ===== CEP — IDENTICO ao RegisterScreen =====
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

  // Locador Google: 1(role+nome) 2(cpf/tipo) 3(endereco) = 3 steps
  // Locatario Google: 1(role+nome) 2(cpf/dados) 3(endereco) 4(cnh) 5(comprovante) = 5 steps
  const totalSteps = role === 'locador' ? 3 : 5;

  // ===== VALIDACOES =====
  const validateStep1 = () => {
    if (!role) { Alert.alert('Erro', 'Escolha locador ou locatario.'); return false; }
    if (!name.trim() || name.trim().length < 3) { setError('name', 'Nome obrigatorio (min 3)'); return false; }
    if (!phone.trim() || !validatePhone(phone)) { setError('phone', 'Telefone obrigatorio'); return false; }
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

  const validateStep2 = async () => {
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

  const validateStep3 = () => {
    const newErrors = {};
    if (cep.replace(/\D/g, '').length !== 8) newErrors.cep = 'CEP invalido';
    if (!street.trim()) newErrors.street = 'Rua obrigatoria';
    if (!number.trim()) newErrors.number = 'Numero obrigatorio';
    if (!city.trim()) newErrors.city = 'Cidade obrigatoria';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) { Alert.alert('Erro', Object.values(newErrors)[0]); return false; }
    return true;
  };

  const validateStep4 = () => {
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

  const validateStep5 = () => {
    if (!residenceProofPhoto) { Alert.alert('Erro', 'Envie o comprovante de residencia.'); return false; }
    return true;
  };

  // ===== NAVIGATION =====
  const handleNext = async () => {
    if (loading) return;
    setLoading(true);
    setErrors({});
    try {
      if (step === 1 && validateStep1()) setStep(2);
      else if (step === 2) { if (await validateStep2()) setStep(3); }
      else if (step === 3 && validateStep3()) {
        if (role === 'locador') { await saveProfile(); return; }
        else setStep(4);
      }
      else if (step === 4 && validateStep4()) setStep(5);
      else if (step === 5 && validateStep5()) { await saveProfile(); return; }
    } catch (e) { Alert.alert('Erro', 'Erro ao validar.'); }
    setLoading(false);
  };

  const saveProfile = async () => {
    const fullAddress = `${street}, ${number}${complement ? ' - ' + complement : ''}, ${neighborhood}, ${city} - ${state}, CEP ${cep}`;
    const userData = {
      name: name.trim(), role, phone: phone.replace(/\D/g, ''),
      cpf: cpf.replace(/\D/g, ''), birthDate,
      personType: role === 'locador' ? personType : 'pf',
      cnpj: cnpj.replace(/\D/g, ''), companyName: companyName.trim(),
      cep: cep.replace(/\D/g, ''), street: street.trim(), number: number.trim(),
      complement: complement.trim(), neighborhood: neighborhood.trim(),
      city: city.trim(), state, address: fullAddress,
    };
    if (role === 'locatario') {
      userData.cnhNumber = cnhNumber.replace(/\D/g, '');
      userData.cnhCategory = cnhCategory.toUpperCase().trim();
      userData.cnhExpiry = cnhExpiry;
      userData.cnhFrontPhoto = cnhFrontPhoto;
      userData.cnhBackPhoto = cnhBackPhoto;
      userData.residenceProofPhoto = residenceProofPhoto;
    }
    const result = await authService.completeGoogleProfile(user.uid, userData);
    setLoading(false);
    if (result.success) onComplete();
    else Alert.alert('Erro', result.error);
  };

  const isLastStep = (role === 'locador' && step === 3) || step === 5;
  const ErrorText = ({ field }) => errors[field] ? <Text style={styles.errorText}>{errors[field]}</Text> : null;

  // ===== RENDER STEPS =====
  const renderStep1 = () => (
    <>
      <View style={styles.headerCenter}>
        <Text style={styles.icon}>🎉</Text>
        <Text style={styles.title}>Bem-vindo!</Text>
        <Text style={styles.subtitle}>Conta Google conectada. Complete seu cadastro.</Text>
      </View>
      <View style={styles.googleCard}>
        <Text style={styles.googleLabel}>Email:</Text>
        <Text style={styles.googleEmail}>{user?.email}</Text>
      </View>

      <Text style={styles.sectionTitle}>Eu sou:</Text>
      <View style={styles.roleRow}>
        <TouchableOpacity style={[styles.roleCard, role === 'locador' && styles.roleCardActive]} onPress={() => setRole('locador')}>
          <Text style={styles.roleIcon}>🏢</Text>
          <Text style={[styles.roleTitle, role === 'locador' && styles.roleTitleActive]}>Locador</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.roleCard, role === 'locatario' && styles.roleCardActive]} onPress={() => setRole('locatario')}>
          <Text style={styles.roleIcon}>🚗</Text>
          <Text style={[styles.roleTitle, role === 'locatario' && styles.roleTitleActive]}>Locatario</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.field}><Text style={styles.label}>Nome Completo *</Text>
        <TextInput style={[styles.input, errors.name && styles.inputError]} placeholder="Seu nome completo" placeholderTextColor="#9CA3AF" value={name} onChangeText={(t) => { setName(t); clearError('name'); }} autoCapitalize="words" /><ErrorText field="name" /></View>
      <View style={styles.field}><Text style={styles.label}>Telefone *</Text>
        <TextInput style={[styles.input, errors.phone && styles.inputError]} placeholder="(00) 00000-0000" placeholderTextColor="#9CA3AF" value={phone} onChangeText={(t) => { setPhone(formatPhone(t)); clearError('phone'); }} keyboardType="phone-pad" /><ErrorText field="phone" /></View>
    </>
  );

  const renderStep2 = () => {
    const isPjOrMei = personType === 'pj' || personType === 'mei';
    return (
      <>
        <Text style={styles.stepTitle}>Dados Pessoais</Text>

        {role === 'locador' ? (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Tipo de Pessoa *</Text>
              <View style={styles.personTypeRow}>
                {[{ key: 'pf', label: 'Pessoa Fisica', icon: '👤' }, { key: 'pj', label: 'Pessoa Juridica', icon: '🏢' }, { key: 'mei', label: 'MEI', icon: '📋' }].map(pt => (
                  <TouchableOpacity key={pt.key} style={[styles.personTypeCard, personType === pt.key && styles.personTypeActive]}
                    onPress={() => { setPersonType(pt.key); clearError('personType'); setCpf(''); setBirthDate(''); setCnpj(''); setCompanyName(''); }}>
                    <Text style={styles.personTypeIcon}>{pt.icon}</Text>
                    <Text style={[styles.personTypeLabel, personType === pt.key && styles.personTypeLabelActive]}>{pt.label}</Text>
                  </TouchableOpacity>
                ))}
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
      </>
    );
  };

  const renderStep3 = () => (
    <>
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
    </>
  );

  const renderStep4 = () => (
    <>
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
      <PhotoPicker label="Frente da CNH" onPhotoSelected={setCnhFrontPhoto} currentPhotoUrl={cnhFrontPhoto} />
      <ErrorText field="cnhFront" />
      <Text style={styles.sectionLabel}>Foto CNH - Verso *</Text>
      <PhotoPicker label="Verso da CNH" onPhotoSelected={setCnhBackPhoto} currentPhotoUrl={cnhBackPhoto} />
      <ErrorText field="cnhBack" />
    </>
  );

  const renderStep5 = () => (
    <>
      <Text style={styles.stepTitle}>Comprovante de Residencia</Text>
      <Text style={styles.stepSubtitle}>Envie uma foto do comprovante recente (conta de luz, agua, internet).</Text>
      <PhotoPicker label="Comprovante de Residencia" onPhotoSelected={setResidenceProofPhoto} currentPhotoUrl={residenceProofPhoto} />
    </>
  );

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Progress */}
        {step > 1 && (
          <View style={styles.progressContainer}>
            {Array.from({ length: totalSteps }, (_, i) => (
              <View key={i} style={[styles.progressDot, i + 1 <= step && styles.progressDotActive]} />
            ))}
            <Text style={styles.stepIndicator}> Passo {step} de {totalSteps}</Text>
          </View>
        )}

        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
        {step === 5 && renderStep5()}

        {/* Botoes */}
        <View style={styles.buttonsRow}>
          {step > 1 && (
            <TouchableOpacity style={styles.backButton} onPress={() => { setStep(step - 1); setErrors({}); }}>
              <Text style={styles.backButtonText}>Voltar</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.nextButton, loading && styles.buttonDisabled]}
            onPress={handleNext} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> :
              <Text style={styles.nextButtonText}>{isLastStep ? 'Concluir Cadastro' : 'Proximo'}</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { flexGrow: 1, padding: 24, paddingTop: 32 },
  // Header
  headerCenter: { alignItems: 'center', marginBottom: 20 },
  icon: { fontSize: 48, marginBottom: 8 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#1F2937', marginBottom: 4 },
  subtitle: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22 },
  googleCard: { backgroundColor: '#F0FDF4', padding: 14, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: '#BBF7D0' },
  googleLabel: { fontSize: 12, color: '#065F46' },
  googleEmail: { fontSize: 15, fontWeight: '700', color: '#065F46' },
  // Progress
  progressContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20 },
  progressDot: { width: 24, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB' },
  progressDotActive: { backgroundColor: '#4F46E5' },
  stepIndicator: { fontSize: 12, color: '#6B7280' },
  // Role
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#1F2937', marginBottom: 12 },
  roleRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  roleCard: { flex: 1, padding: 18, borderRadius: 12, borderWidth: 2, borderColor: '#E5E7EB', alignItems: 'center', backgroundColor: '#F9FAFB' },
  roleCardActive: { borderColor: '#4F46E5', backgroundColor: '#EEF2FF' },
  roleIcon: { fontSize: 28, marginBottom: 6 },
  roleTitle: { fontSize: 15, fontWeight: 'bold', color: '#374151' },
  roleTitleActive: { color: '#4F46E5' },
  // Steps
  stepTitle: { fontSize: 22, fontWeight: 'bold', color: '#1F2937', marginBottom: 16 },
  stepSubtitle: { fontSize: 14, color: '#6B7280', marginBottom: 20 },
  // Fields
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
  // Person type
  personTypeRow: { flexDirection: 'row', gap: 8 },
  personTypeCard: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 2, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB', alignItems: 'center' },
  personTypeActive: { borderColor: '#4F46E5', backgroundColor: '#EEF2FF' },
  personTypeIcon: { fontSize: 22, marginBottom: 4 },
  personTypeLabel: { fontSize: 12, fontWeight: '600', color: '#6B7280', textAlign: 'center' },
  personTypeLabelActive: { color: '#4F46E5' },
  // Buttons
  buttonsRow: { flexDirection: 'row', gap: 12, marginTop: 24, marginBottom: 32 },
  backButton: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center', backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#D1D5DB' },
  backButtonText: { fontSize: 16, fontWeight: '600', color: '#374151' },
  nextButton: { flex: 2, backgroundColor: '#4F46E5', padding: 16, borderRadius: 12, alignItems: 'center' },
  nextButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  buttonDisabled: { opacity: 0.5 },
});

export default GoogleCompleteProfileScreen;
