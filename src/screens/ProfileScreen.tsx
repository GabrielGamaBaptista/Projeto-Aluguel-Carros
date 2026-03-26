// src/screens/ProfileScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, ScrollView, SafeAreaView, Image, StatusBar, Modal,
} from 'react-native';
import { Lock, LogOut, Trash2 } from 'lucide-react-native';
import { showMessage } from 'react-native-flash-message';
import functions from '@react-native-firebase/functions';
import { authService } from '../services/authService';
import { auth, firestore } from '../config/firebase';
import PhotoPicker from '../components/PhotoPicker';
import paymentService from '../services/paymentService';
import {
  validateCpf, validateCnpj, validateDate, validatePhone,
  fetchAddressByCep, formatCep,
} from '../utils/validation';

const CNH_CATEGORIES = ['A', 'B', 'AB', 'C', 'D', 'E'];

const ProfileScreen = ({ navigation }) => {
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // --- Dados da Conta ---
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);

  // --- Dados Pessoais ---
  const [editingPersonal, setEditingPersonal] = useState(false);
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [editCpf, setEditCpf] = useState('');
  const [editBirthDate, setEditBirthDate] = useState('');
  const [editPersonType, setEditPersonType] = useState('pf');
  const [editCnpj, setEditCnpj] = useState('');
  const [editCompanyName, setEditCompanyName] = useState('');
  const [hasAsaas, setHasAsaas] = useState(false);

  // --- Endereco ---
  const [editingAddress, setEditingAddress] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [editCep, setEditCep] = useState('');
  const [editStreet, setEditStreet] = useState('');
  const [editNumber, setEditNumber] = useState('');
  const [editComplement, setEditComplement] = useState('');
  const [editNeighborhood, setEditNeighborhood] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editStateUF, setEditStateUF] = useState('');
  const [fetchingCep, setFetchingCep] = useState(false);

  // --- CNH (locatario) ---
  const [editingCnh, setEditingCnh] = useState(false);
  const [savingCnh, setSavingCnh] = useState(false);
  const [editCnhNumber, setEditCnhNumber] = useState('');
  const [editCnhCategory, setEditCnhCategory] = useState('B');
  const [editCnhExpiry, setEditCnhExpiry] = useState('');
  const [editCnhFront, setEditCnhFront] = useState<string | null>(null);
  const [editCnhBack, setEditCnhBack] = useState<string | null>(null);

  // --- Comprovante (locatario) ---
  const [editingResidence, setEditingResidence] = useState(false);
  const [savingResidence, setSavingResidence] = useState(false);
  const [editResidencePhoto, setEditResidencePhoto] = useState<string | null>(null);

  // --- Exclusao de conta (Q5.4) ---
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => { loadProfile(); }, []);
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => loadProfile());
    return unsub;
  }, [navigation]);

  const loadProfile = async () => {
    const user = authService.getCurrentUser();
    if (user) {
      const result = await authService.getCurrentUserProfile(user.uid);
      if (result.success) {
        const p = result.data;
        setUserProfile(p);
        // Dados da Conta
        setName(p.name || '');
        setPhone(fmtPhone(p.phone || ''));
        setProfilePhoto(p.profilePhoto || null);
        // Dados Pessoais
        setEditCpf(fmtCpf(p.cpf || ''));
        setEditBirthDate(p.birthDate || '');
        setEditPersonType(p.personType || 'pf');
        setEditCnpj(fmtCnpj(p.cnpj || ''));
        setEditCompanyName(p.companyName || '');
        // Endereco
        setEditCep(formatCep(p.cep || ''));
        setEditStreet(p.street || '');
        setEditNumber(p.number || '');
        setEditComplement(p.complement || '');
        setEditNeighborhood(p.neighborhood || '');
        setEditCity(p.city || '');
        setEditStateUF(p.state || '');
        // CNH
        setEditCnhNumber(p.cnhNumber || '');
        setEditCnhCategory(p.cnhCategory || 'B');
        setEditCnhExpiry(p.cnhExpiry || '');
        setEditCnhFront(p.cnhFrontPhoto || null);
        setEditCnhBack(p.cnhBackPhoto || null);
        setEditResidencePhoto(p.residenceProofPhoto || null);
        // Verificar Asaas para locador
        if (p.role === 'locador') {
          const asaasResult = await paymentService.checkOnboarding();
          setHasAsaas(asaasResult?.exists === true);
        }
      }
    }
    setLoading(false);
  };

  // ===== FORMATADORES =====
  const fmtPhone = (t) => {
    const n = t.replace(/\D/g, '').slice(0, 11);
    if (n.length <= 2) return n;
    if (n.length <= 7) return `(${n.slice(0,2)}) ${n.slice(2)}`;
    return `(${n.slice(0,2)}) ${n.slice(2,7)}-${n.slice(7)}`;
  };
  const fmtCpf = (c) => {
    if (!c) return '';
    const d = c.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
    return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  };
  const fmtCnpj = (c) => {
    if (!c) return '';
    const d = c.replace(/\D/g, '').slice(0, 14);
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0,2)}.${d.slice(2)}`;
    if (d.length <= 8) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`;
    if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`;
    return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
  };
  const fmtDateInput = (text) => {
    const nums = text.replace(/\D/g, '').slice(0, 8);
    if (nums.length <= 2) return nums;
    if (nums.length <= 4) return `${nums.slice(0,2)}/${nums.slice(2)}`;
    return `${nums.slice(0,2)}/${nums.slice(2,4)}/${nums.slice(4)}`;
  };
  const personTypeLabel = (pt) => {
    switch (pt) { case 'pf': return 'Pessoa Fisica'; case 'pj': return 'Pessoa Juridica'; case 'mei': return 'MEI'; default: return pt || 'Nao informado'; }
  };

  // ===== CEP AUTOCOMPLETE =====
  const handleCepChange = async (text) => {
    const formatted = formatCep(text);
    setEditCep(formatted);
    const clean = formatted.replace(/\D/g, '');
    if (clean.length === 8) {
      setFetchingCep(true);
      const result = await fetchAddressByCep(clean);
      if (result.success) {
        setEditStreet(result.data.street);
        setEditNeighborhood(result.data.neighborhood);
        setEditCity(result.data.city);
        setEditStateUF(result.data.state);
        if (result.data.complement) setEditComplement(result.data.complement);
      }
      setFetchingCep(false);
    }
  };

  // ===== HANDLERS DE SAVE =====
  const batchRef = (uid) => ({
    pub: firestore().collection('users').doc(uid),
    priv: firestore().collection('users').doc(uid).collection('private').doc('data'),
  });

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Erro', 'Nome nao pode ficar vazio.'); return; }
    if (phone && !validatePhone(phone)) { Alert.alert('Erro', 'Celular invalido.'); return; }
    setSaving(true);
    try {
      const user = authService.getCurrentUser();
      const cleanPhone = phone.replace(/\D/g, '');
      const publicUpdates = { name: name.trim(), phone: cleanPhone, profilePhoto: profilePhoto || null };
      const refs = batchRef(user.uid);
      const batch = firestore().batch();
      batch.update(refs.pub, publicUpdates);
      batch.set(refs.priv, { phone: cleanPhone }, { merge: true });
      await batch.commit();
      setUserProfile(p => ({ ...p, ...publicUpdates }));
      setEditing(false);
      showMessage({ message: 'Perfil atualizado!', type: 'success' });
    } catch { Alert.alert('Erro', 'Nao foi possivel salvar.'); }
    setSaving(false);
  };

  const handleSavePersonal = async () => {
    const cleanCpf = editCpf.replace(/\D/g, '');
    if (!hasAsaas && cleanCpf && !validateCpf(cleanCpf)) {
      Alert.alert('Erro', 'CPF invalido.'); return;
    }
    if (editBirthDate && !validateDate(editBirthDate)) {
      Alert.alert('Erro', 'Data de nascimento invalida (DD/MM/AAAA).'); return;
    }
    const isPjOrMei = editPersonType === 'pj' || editPersonType === 'mei';
    const cleanCnpjVal = editCnpj.replace(/\D/g, '');
    if (isLandlord && isPjOrMei && cleanCnpjVal && !validateCnpj(cleanCnpjVal)) {
      Alert.alert('Erro', 'CNPJ invalido.'); return;
    }
    setSavingPersonal(true);
    try {
      const user = authService.getCurrentUser();
      // Somente CPF/CNPJ ficam no doc publico (necessarios para login e busca — Fase A)
      const publicUpdates: any = {};
      const privateUpdates: any = { birthDate: editBirthDate };
      if (!hasAsaas) {
        publicUpdates.cpf = cleanCpf;
        privateUpdates.cpf = cleanCpf;
      }
      if (isLandlord) {
        privateUpdates.personType = editPersonType;
        if (isPjOrMei) {
          publicUpdates.cnpj = cleanCnpjVal;
          privateUpdates.cnpj = cleanCnpjVal;
          privateUpdates.companyName = editCompanyName.trim();
        }
      }
      const refs = batchRef(user.uid);
      const batch = firestore().batch();
      if (Object.keys(publicUpdates).length > 0) batch.update(refs.pub, publicUpdates);
      batch.set(refs.priv, privateUpdates, { merge: true });
      await batch.commit();
      setUserProfile(p => ({ ...p, ...publicUpdates, ...privateUpdates }));
      setEditingPersonal(false);
      showMessage({ message: 'Dados pessoais atualizados!', type: 'success' });
    } catch { Alert.alert('Erro', 'Nao foi possivel salvar.'); }
    setSavingPersonal(false);
  };

  const handleSaveAddress = async () => {
    const cleanCepVal = editCep.replace(/\D/g, '');
    if (cleanCepVal.length !== 8) { Alert.alert('Erro', 'CEP invalido (8 digitos).'); return; }
    if (!editStreet.trim()) { Alert.alert('Erro', 'Rua / Logradouro e obrigatorio.'); return; }
    if (!editCity.trim()) { Alert.alert('Erro', 'Cidade e obrigatoria.'); return; }
    setSavingAddress(true);
    try {
      const user = authService.getCurrentUser();
      const cleanStreet = editStreet.trim();
      const cleanCity = editCity.trim();
      const addressStr = [cleanStreet, editNumber.trim(), editComplement.trim(), editNeighborhood.trim(), cleanCity, editStateUF.trim().toUpperCase().slice(0,2)].filter(Boolean).join(', ');
      // Endereco e PII — atualiza apenas no doc privado
      const privateUpdates = {
        cep: cleanCepVal,
        street: cleanStreet,
        number: editNumber.trim(),
        complement: editComplement.trim(),
        neighborhood: editNeighborhood.trim(),
        city: cleanCity,
        state: editStateUF.trim().toUpperCase().slice(0, 2),
        address: addressStr,
      };
      const refs = batchRef(user.uid);
      const batch = firestore().batch();
      batch.set(refs.priv, privateUpdates, { merge: true });
      // Remover campos de endereco legados do doc publico (migracao para private/data)
      const legacyAddressFields = ['cep','street','number','complement','neighborhood','city','state','address'];
      const publicCleanup: any = {};
      legacyAddressFields.forEach(f => { publicCleanup[f] = firestore.FieldValue.delete(); });
      batch.update(refs.pub, publicCleanup);
      await batch.commit();
      setUserProfile(p => ({ ...p, ...privateUpdates }));
      setEditingAddress(false);
      showMessage({ message: 'Endereco atualizado!', type: 'success' });
    } catch { Alert.alert('Erro', 'Nao foi possivel salvar.'); }
    setSavingAddress(false);
  };

  const handleSaveCnh = async () => {
    if (!editCnhNumber.trim()) { Alert.alert('Erro', 'Numero da CNH e obrigatorio.'); return; }
    if (editCnhExpiry && !validateDate(editCnhExpiry)) {
      Alert.alert('Erro', 'Validade da CNH invalida (DD/MM/AAAA).'); return;
    }
    setSavingCnh(true);
    try {
      const user = authService.getCurrentUser();
      // CNH e PII — atualiza apenas no doc privado
      const privateUpdates = {
        cnhNumber: editCnhNumber.trim(),
        cnhCategory: editCnhCategory,
        cnhExpiry: editCnhExpiry,
        cnhFrontPhoto: editCnhFront || null,
        cnhBackPhoto: editCnhBack || null,
      };
      const refs = batchRef(user.uid);
      const batch = firestore().batch();
      batch.set(refs.priv, privateUpdates, { merge: true });
      await batch.commit();
      setUserProfile(p => ({ ...p, ...privateUpdates }));
      setEditingCnh(false);
      showMessage({ message: 'CNH atualizada!', type: 'success' });
    } catch { Alert.alert('Erro', 'Nao foi possivel salvar.'); }
    setSavingCnh(false);
  };

  const handleSaveResidence = async () => {
    setSavingResidence(true);
    try {
      const user = authService.getCurrentUser();
      // Comprovante e PII — atualiza apenas no doc privado
      const privateUpdates = { residenceProofPhoto: editResidencePhoto || null };
      const refs = batchRef(user.uid);
      const batch = firestore().batch();
      batch.set(refs.priv, privateUpdates, { merge: true });
      await batch.commit();
      setUserProfile(p => ({ ...p, ...privateUpdates }));
      setEditingResidence(false);
      showMessage({ message: 'Comprovante atualizado!', type: 'success' });
    } catch { Alert.alert('Erro', 'Nao foi possivel salvar.'); }
    setSavingResidence(false);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Excluir Conta',
      'Esta acao e irreversivel. Todos os seus dados serao excluidos permanentemente.\n\nDeseja continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Continuar', style: 'destructive', onPress: () => setShowDeleteModal(true) },
      ]
    );
  };

  const handleConfirmDelete = async () => {
    if (!isGoogle && !deletePassword.trim()) {
      Alert.alert('Erro', 'Digite sua senha para confirmar.'); return;
    }
    setDeletingAccount(true);
    try {
      // Re-autenticar antes de excluir
      if (isGoogle) {
        const reauth = await authService.reauthenticateWithGoogle();
        if (!reauth.success) { Alert.alert('Erro', reauth.error); setDeletingAccount(false); return; }
      } else {
        const reauth = await authService.reauthenticateWithPassword(deletePassword);
        if (!reauth.success) { Alert.alert('Erro', reauth.error); setDeletingAccount(false); return; }
      }

      // Chamar CF de exclusao
      const deleteAccountFn = functions().httpsCallable('deleteAccountCF');
      await deleteAccountFn({});

      // Logout local
      setShowDeleteModal(false);
      await authService.logout();
    } catch (e) {
      Alert.alert('Erro', 'Nao foi possivel excluir a conta. Tente novamente.');
    }
    setDeletingAccount(false);
  };

  const handleResetPassword = () => {
    const email = userProfile?.email;
    if (!email) return;
    Alert.alert('Redefinir Senha', `Enviaremos um link para:\n${email}`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Enviar', onPress: async () => {
        try {
          await auth().sendPasswordResetEmail(email);
          Alert.alert('Email Enviado', 'Verifique sua caixa de entrada.');
        } catch (e) {
          Alert.alert('Erro', e.code === 'auth/too-many-requests' ? 'Muitas tentativas. Aguarde.' : 'Erro ao enviar.');
        }
      }},
    ]);
  };

  const handleLogout = () => {
    Alert.alert('Sair', 'Deseja realmente sair?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: async () => { await authService.logout(); } },
    ]);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#4F46E5" /></View>;
  if (!userProfile) return <View style={styles.center}><Text>Perfil nao encontrado</Text></View>;

  const isGoogle = userProfile.authProvider === 'google';
  const isLandlord = userProfile.role === 'locador';
  const isTenant = userProfile.role === 'locatario';

  const InfoRow = ({ label, value }) => (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || 'Nao informado'}</Text>
    </View>
  );

  const SectionEditHeader = ({ title, editing: ed, saving: sv, onEdit, onCancel, onSave }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {!ed ? (
        <TouchableOpacity onPress={onEdit}><Text style={styles.editBtn}>Editar</Text></TouchableOpacity>
      ) : (
        <View style={styles.editActions}>
          <TouchableOpacity onPress={onCancel}><Text style={styles.cancelBtn}>Cancelar</Text></TouchableOpacity>
          <TouchableOpacity onPress={onSave} disabled={sv}>
            <Text style={styles.saveBtn}>{sv ? 'Salvando...' : 'Salvar'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const Field = ({ label, value, onChangeText, placeholder = '', keyboardType = 'default', editable = true, maxLength = undefined }) => (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, !editable && styles.inputDisabled]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        keyboardType={keyboardType}
        editable={editable}
        maxLength={maxLength}
      />
    </View>
  );

  const isPjOrMei = editPersonType === 'pj' || editPersonType === 'mei';
  const addressDisplay = userProfile.address ||
    [userProfile.street, userProfile.number, userProfile.neighborhood, userProfile.city, userProfile.state]
      .filter(Boolean).join(', ') || 'Nao informado';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView keyboardShouldPersistTaps="handled">

        {/* Header com avatar */}
        <View style={styles.header}>
          {profilePhoto ? (
            <Image source={{ uri: profilePhoto }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatar}><Text style={styles.avatarText}>{userProfile.name?.charAt(0)?.toUpperCase() || '?'}</Text></View>
          )}
          <Text style={styles.headerName}>{userProfile.name}</Text>
          <Text style={styles.headerRole}>{isLandlord ? 'Locador' : 'Locatario'}</Text>
          {userProfile.emailVerified && <View style={styles.verifiedBadge}><Text style={styles.verifiedText}>✓ Email verificado</Text></View>}
        </View>

        {/* Dados da Conta */}
        <View style={styles.section}>
          <SectionEditHeader
            title="Dados da Conta"
            editing={editing}
            saving={saving}
            onEdit={() => setEditing(true)}
            onCancel={() => { setEditing(false); setName(userProfile.name); setPhone(fmtPhone(userProfile.phone || '')); setProfilePhoto(userProfile.profilePhoto || null); }}
            onSave={handleSave}
          />
          {editing ? (
            <>
              <PhotoPicker label="Foto de Perfil (opcional)" onPhotoSelected={setProfilePhoto} currentPhotoUrl={profilePhoto} />
              <Field label="Nome" value={name} onChangeText={setName} />
              <Field label="Celular" value={phone} onChangeText={(t) => setPhone(fmtPhone(t))} placeholder="(00) 00000-0000" keyboardType="phone-pad" />
            </>
          ) : (
            <>
              <InfoRow label="Nome" value={userProfile.name} />
              <InfoRow label="Email" value={userProfile.email} />
              <InfoRow label="Celular" value={fmtPhone(userProfile.phone || '') || 'Nao informado'} />
              <InfoRow label="Login via" value={isGoogle ? 'Google' : 'Email e Senha'} />
            </>
          )}
        </View>

        {/* Dados Pessoais */}
        <View style={styles.section}>
          <SectionEditHeader
            title="Dados Pessoais"
            editing={editingPersonal}
            saving={savingPersonal}
            onEdit={() => setEditingPersonal(true)}
            onCancel={() => {
              setEditingPersonal(false);
              setEditCpf(fmtCpf(userProfile.cpf || ''));
              setEditBirthDate(userProfile.birthDate || '');
              setEditPersonType(userProfile.personType || 'pf');
              setEditCnpj(fmtCnpj(userProfile.cnpj || ''));
              setEditCompanyName(userProfile.companyName || '');
            }}
            onSave={handleSavePersonal}
          />
          {editingPersonal ? (
            <>
              {hasAsaas ? (
                <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>CPF</Text>
                  <Text style={styles.lockedHint}>CPF nao pode ser alterado apos ativar pagamentos.</Text>
                  <TextInput style={[styles.input, styles.inputDisabled]} value={editCpf} editable={false} placeholderTextColor="#9CA3AF" />
                </View>
              ) : (
                <Field label="CPF" value={editCpf} onChangeText={(t) => setEditCpf(fmtCpf(t))} placeholder="000.000.000-00" keyboardType="numeric" />
              )}
              <Field label="Data de Nascimento" value={editBirthDate} onChangeText={(t) => setEditBirthDate(fmtDateInput(t))} placeholder="DD/MM/AAAA" keyboardType="numeric" />
              {isLandlord && (
                <>
                  <Text style={styles.fieldLabel}>Tipo de Pessoa</Text>
                  <View style={styles.pillRow}>
                    {(['pf', 'pj', 'mei'] as const).map(pt => (
                      <TouchableOpacity key={pt} style={[styles.pill, editPersonType === pt && styles.pillActive]} onPress={() => setEditPersonType(pt)}>
                        <Text style={[styles.pillText, editPersonType === pt && styles.pillTextActive]}>{personTypeLabel(pt)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {isPjOrMei && (
                    <>
                      <Field label="CNPJ" value={editCnpj} onChangeText={(t) => setEditCnpj(fmtCnpj(t))} placeholder="00.000.000/0000-00" keyboardType="numeric" />
                      <Field label="Razao Social" value={editCompanyName} onChangeText={setEditCompanyName} />
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <InfoRow label="CPF" value={fmtCpf(userProfile.cpf || '')} />
              <InfoRow label="Nascimento" value={userProfile.birthDate} />
              {isLandlord && <InfoRow label="Tipo Pessoa" value={personTypeLabel(userProfile.personType)} />}
              {isLandlord && (userProfile.personType === 'pj' || userProfile.personType === 'mei') && (
                <>
                  <InfoRow label="CNPJ" value={fmtCnpj(userProfile.cnpj || '')} />
                  {userProfile.companyName ? <InfoRow label="Razao Social" value={userProfile.companyName} /> : null}
                </>
              )}
            </>
          )}
        </View>

        {/* Endereco */}
        <View style={styles.section}>
          <SectionEditHeader
            title="Endereco"
            editing={editingAddress}
            saving={savingAddress}
            onEdit={() => setEditingAddress(true)}
            onCancel={() => {
              setEditingAddress(false);
              setEditCep(formatCep(userProfile.cep || ''));
              setEditStreet(userProfile.street || '');
              setEditNumber(userProfile.number || '');
              setEditComplement(userProfile.complement || '');
              setEditNeighborhood(userProfile.neighborhood || '');
              setEditCity(userProfile.city || '');
              setEditStateUF(userProfile.state || '');
            }}
            onSave={handleSaveAddress}
          />
          {editingAddress ? (
            <>
              <View style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>CEP</Text>
                <View style={styles.cepRow}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={editCep}
                    onChangeText={handleCepChange}
                    placeholder="00000-000"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="numeric"
                    maxLength={9}
                  />
                  {fetchingCep && <ActivityIndicator size="small" color="#4F46E5" style={{ marginLeft: 8 }} />}
                </View>
              </View>
              <Field label="Rua / Logradouro" value={editStreet} onChangeText={setEditStreet} />
              <View style={styles.rowFields}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Field label="Numero" value={editNumber} onChangeText={setEditNumber} keyboardType="numeric" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Complemento" value={editComplement} onChangeText={setEditComplement} />
                </View>
              </View>
              <Field label="Bairro" value={editNeighborhood} onChangeText={setEditNeighborhood} />
              <View style={styles.rowFields}>
                <View style={{ flex: 2, marginRight: 8 }}>
                  <Field label="Cidade" value={editCity} onChangeText={setEditCity} />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="UF" value={editStateUF} onChangeText={(t) => setEditStateUF(t.toUpperCase().slice(0, 2))} maxLength={2} />
                </View>
              </View>
            </>
          ) : (
            <InfoRow label="Endereco" value={addressDisplay} />
          )}
        </View>

        {/* CNH (locatario) */}
        {isTenant && (
          <View style={styles.section}>
            <SectionEditHeader
              title="CNH"
              editing={editingCnh}
              saving={savingCnh}
              onEdit={() => setEditingCnh(true)}
              onCancel={() => {
                setEditingCnh(false);
                setEditCnhNumber(userProfile.cnhNumber || '');
                setEditCnhCategory(userProfile.cnhCategory || 'B');
                setEditCnhExpiry(userProfile.cnhExpiry || '');
                setEditCnhFront(userProfile.cnhFrontPhoto || null);
                setEditCnhBack(userProfile.cnhBackPhoto || null);
              }}
              onSave={handleSaveCnh}
            />
            {editingCnh ? (
              <>
                <Field label="Numero da CNH" value={editCnhNumber} onChangeText={setEditCnhNumber} keyboardType="numeric" />
                <Text style={[styles.fieldLabel, { marginBottom: 8 }]}>Categoria</Text>
                <View style={styles.pillRow}>
                  {CNH_CATEGORIES.map(cat => (
                    <TouchableOpacity key={cat} style={[styles.pill, editCnhCategory === cat && styles.pillActive]} onPress={() => setEditCnhCategory(cat)}>
                      <Text style={[styles.pillText, editCnhCategory === cat && styles.pillTextActive]}>{cat}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Field label="Validade (DD/MM/AAAA)" value={editCnhExpiry} onChangeText={(t) => setEditCnhExpiry(fmtDateInput(t))} placeholder="DD/MM/AAAA" keyboardType="numeric" />
                <PhotoPicker label="Foto Frente da CNH" onPhotoSelected={setEditCnhFront} currentPhotoUrl={editCnhFront} />
                <PhotoPicker label="Foto Verso da CNH" onPhotoSelected={setEditCnhBack} currentPhotoUrl={editCnhBack} />
              </>
            ) : (
              <>
                <InfoRow label="Numero" value={userProfile.cnhNumber} />
                <InfoRow label="Categoria" value={userProfile.cnhCategory} />
                <InfoRow label="Validade" value={userProfile.cnhExpiry} />
                <InfoRow label="Foto Frente" value={userProfile.cnhFrontPhoto ? 'Enviada' : 'Nao enviada'} />
                <InfoRow label="Foto Verso" value={userProfile.cnhBackPhoto ? 'Enviada' : 'Nao enviada'} />
              </>
            )}
          </View>
        )}

        {/* Comprovante de Residencia (locatario) */}
        {isTenant && (
          <View style={styles.section}>
            <SectionEditHeader
              title="Comprovante de Residencia"
              editing={editingResidence}
              saving={savingResidence}
              onEdit={() => setEditingResidence(true)}
              onCancel={() => { setEditingResidence(false); setEditResidencePhoto(userProfile.residenceProofPhoto || null); }}
              onSave={handleSaveResidence}
            />
            {editingResidence ? (
              <PhotoPicker label="Comprovante de Residencia" onPhotoSelected={setEditResidencePhoto} currentPhotoUrl={editResidencePhoto} />
            ) : (
              <InfoRow label="Comprovante" value={userProfile.residenceProofPhoto ? 'Enviado' : 'Nao enviado'} />
            )}
          </View>
        )}

        {/* Seguranca */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Seguranca</Text>
          {!isGoogle && (
            <TouchableOpacity style={styles.actionRow} onPress={handleResetPassword}>
              <Lock size={22} color="#374151" style={{ marginRight: 14 }} />
              <View style={styles.actionContent}>
                <Text style={styles.actionTitle}>Alterar Senha</Text>
                <Text style={styles.actionDesc}>Enviaremos um link para seu email</Text>
              </View>
              <Text style={styles.actionArrow}>→</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.actionRow} onPress={handleLogout}>
            <LogOut size={22} color="#DC2626" style={{ marginRight: 14 }} />
            <View style={styles.actionContent}><Text style={[styles.actionTitle, styles.logoutTitle]}>Sair da Conta</Text></View>
            <Text style={[styles.actionArrow, styles.logoutTitle]}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionRow, styles.logoutRow]} onPress={handleDeleteAccount}>
            <Trash2 size={22} color="#DC2626" style={{ marginRight: 14 }} />
            <View style={styles.actionContent}>
              <Text style={[styles.actionTitle, styles.logoutTitle]}>Excluir Conta</Text>
              <Text style={styles.actionDesc}>Remove todos os seus dados permanentemente</Text>
            </View>
            <Text style={[styles.actionArrow, styles.logoutTitle]}>→</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modal de re-autenticacao para excluir conta */}
      <Modal visible={showDeleteModal} transparent animationType="fade" onRequestClose={() => setShowDeleteModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirmar Exclusao</Text>
            <Text style={styles.modalDesc}>
              {isGoogle
                ? 'Vamos confirmar sua identidade com o Google antes de excluir sua conta.'
                : 'Digite sua senha atual para confirmar a exclusao permanente da conta.'}
            </Text>
            {!isGoogle && (
              <TextInput
                style={styles.input}
                placeholder="Sua senha atual"
                placeholderTextColor="#9CA3AF"
                secureTextEntry
                value={deletePassword}
                onChangeText={setDeletePassword}
                editable={!deletingAccount}
              />
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => { setShowDeleteModal(false); setDeletePassword(''); }}
                disabled={deletingAccount}
              >
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalDeleteBtn, deletingAccount && styles.modalBtnDisabled]}
                onPress={handleConfirmDelete}
                disabled={deletingAccount}
              >
                {deletingAccount
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.modalDeleteText}>Excluir</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#4F46E5', padding: 32, paddingTop: (StatusBar.currentHeight || 24) + 8, alignItems: 'center' },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  avatarText: { fontSize: 36, fontWeight: 'bold', color: '#4F46E5' },
  avatarImage: { width: 80, height: 80, borderRadius: 40, marginBottom: 12 },
  headerName: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  headerRole: { fontSize: 14, color: '#C7D2FE' },
  verifiedBadge: { backgroundColor: '#D1FAE5', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, marginTop: 10 },
  verifiedText: { color: '#065F46', fontSize: 12, fontWeight: '700' },
  section: { backgroundColor: '#fff', marginTop: 12, padding: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937' },
  editBtn: { color: '#4F46E5', fontWeight: '700', fontSize: 15 },
  editActions: { flexDirection: 'row', gap: 16 },
  cancelBtn: { color: '#6B7280', fontWeight: '600', fontSize: 14 },
  saveBtn: { color: '#4F46E5', fontWeight: '700', fontSize: 14 },
  fieldContainer: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#F9FAFB', color: '#1F2937' },
  inputDisabled: { backgroundColor: '#F3F4F6', color: '#9CA3AF' },
  lockedHint: { fontSize: 12, color: '#F59E0B', marginBottom: 6 },
  cepRow: { flexDirection: 'row', alignItems: 'center' },
  rowFields: { flexDirection: 'row' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#F9FAFB' },
  pillActive: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  pillText: { fontSize: 14, color: '#374151', fontWeight: '500' },
  pillTextActive: { color: '#fff', fontWeight: '700' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  infoLabel: { fontSize: 14, color: '#6B7280', flex: 1 },
  infoValue: { fontSize: 14, fontWeight: '600', color: '#1F2937', flex: 2, textAlign: 'right' },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  actionContent: { flex: 1 },
  actionTitle: { fontSize: 16, fontWeight: '600', color: '#1F2937' },
  actionDesc: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  actionArrow: { fontSize: 18, color: '#9CA3AF' },
  logoutRow: { borderBottomWidth: 0 },
  logoutTitle: { color: '#EF4444' },
  // Modal de exclusao de conta
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '100%' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#DC2626', marginBottom: 12 },
  modalDesc: { fontSize: 14, color: '#374151', marginBottom: 20, lineHeight: 20 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  modalCancelBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#D1D5DB' },
  modalCancelText: { color: '#6B7280', fontWeight: '600' },
  modalDeleteBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8, backgroundColor: '#DC2626', minWidth: 80, alignItems: 'center' },
  modalDeleteText: { color: '#fff', fontWeight: '700' },
  modalBtnDisabled: { opacity: 0.6 },
});

export default ProfileScreen;
