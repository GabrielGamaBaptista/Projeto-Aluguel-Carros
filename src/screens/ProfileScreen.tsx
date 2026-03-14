// src/screens/ProfileScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, ScrollView, SafeAreaView,
} from 'react-native';
import { authService } from '../services/authService';
import { auth, firestore } from '../config/firebase';

const ProfileScreen = ({ navigation }) => {
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => { loadProfile(); }, []);
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => loadProfile());
    return unsub;
  }, [navigation]);

  const loadProfile = async () => {
    const user = authService.getCurrentUser();
    if (user) {
      const result = await authService.getCurrentUserProfile(user.uid);
      if (result.success) { setUserProfile(result.data); setName(result.data.name || ''); setPhone(fmtPhone(result.data.phone || '')); }
    }
    setLoading(false);
  };

  const fmtPhone = (t) => {
    const n = t.replace(/\D/g, '').slice(0, 11);
    if (n.length <= 2) return n;
    if (n.length <= 7) return `(${n.slice(0,2)}) ${n.slice(2)}`;
    return `(${n.slice(0,2)}) ${n.slice(2,7)}-${n.slice(7)}`;
  };

  const fmtCpf = (c) => {
    if (!c) return ''; const d = c.replace(/\D/g, '');
    if (d.length !== 11) return c;
    return d.slice(0,3)+'.'+d.slice(3,6)+'.'+d.slice(6,9)+'-'+d.slice(9);
  };

  const fmtCnpj = (c) => {
    if (!c) return ''; const d = c.replace(/\D/g, '');
    if (d.length !== 14) return c;
    return d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5,8)+'/'+d.slice(8,12)+'-'+d.slice(12);
  };

  const personTypeLabel = (pt) => {
    switch (pt) { case 'pf': return 'Pessoa Fisica'; case 'pj': return 'Pessoa Juridica'; case 'mei': return 'MEI'; default: return pt || 'Nao informado'; }
  };

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Erro', 'Nome nao pode ficar vazio.'); return; }
    setSaving(true);
    try {
      const user = authService.getCurrentUser();
      await firestore().collection('users').doc(user.uid).update({ name: name.trim(), phone: phone.replace(/\D/g, '') });
      setUserProfile(p => ({ ...p, name: name.trim(), phone: phone.replace(/\D/g, '') }));
      setEditing(false);
      Alert.alert('Sucesso', 'Perfil atualizado!');
    } catch (e) { Alert.alert('Erro', 'Nao foi possivel salvar.'); }
    setSaving(false);
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
    <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value || 'Nao informado'}</Text></View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <View style={styles.header}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{userProfile.name?.charAt(0)?.toUpperCase() || '?'}</Text></View>
          <Text style={styles.headerName}>{userProfile.name}</Text>
          <Text style={styles.headerRole}>{isLandlord ? 'Locador' : 'Locatario'}</Text>
          {userProfile.emailVerified && <View style={styles.verifiedBadge}><Text style={styles.verifiedText}>✓ Email verificado</Text></View>}
        </View>

        {/* Dados da Conta */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Dados da Conta</Text>
            {!editing ? (
              <TouchableOpacity onPress={() => setEditing(true)}><Text style={styles.editBtn}>Editar</Text></TouchableOpacity>
            ) : (
              <View style={styles.editActions}>
                <TouchableOpacity onPress={() => { setEditing(false); setName(userProfile.name); setPhone(fmtPhone(userProfile.phone || '')); }}>
                  <Text style={styles.cancelBtn}>Cancelar</Text></TouchableOpacity>
                <TouchableOpacity onPress={handleSave} disabled={saving}>
                  <Text style={styles.saveBtn}>{saving ? 'Salvando...' : 'Salvar'}</Text></TouchableOpacity>
              </View>
            )}
          </View>
          {editing ? (
            <>
              <View style={styles.fieldContainer}><Text style={styles.fieldLabel}>Nome</Text>
                <TextInput style={styles.input} placeholderTextColor="#9CA3AF" value={name} onChangeText={setName} /></View>
              <View style={styles.fieldContainer}><Text style={styles.fieldLabel}>Celular</Text>
                <TextInput style={styles.input} placeholderTextColor="#9CA3AF" placeholder="(00) 00000-0000" value={phone} onChangeText={(t) => setPhone(fmtPhone(t))} keyboardType="phone-pad" /></View>
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

        {/* Dados Pessoais (AMBOS) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dados Pessoais</Text>
          <InfoRow label="CPF" value={fmtCpf(userProfile.cpf)} />
          <InfoRow label="Nascimento" value={userProfile.birthDate} />
          {isLandlord && <InfoRow label="Tipo Pessoa" value={personTypeLabel(userProfile.personType)} />}
          {isLandlord && (userProfile.personType === 'pj' || userProfile.personType === 'mei') && (
            <>
              <InfoRow label="CNPJ" value={fmtCnpj(userProfile.cnpj)} />
              {userProfile.companyName ? <InfoRow label="Razao Social" value={userProfile.companyName} /> : null}
            </>
          )}
        </View>

        {/* Endereco (AMBOS) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Endereco</Text>
          <InfoRow label="Endereco" value={userProfile.address || [userProfile.street, userProfile.number, userProfile.neighborhood, userProfile.city].filter(Boolean).join(', ') || 'Nao informado'} />
        </View>

        {/* CNH (locatario only) */}
        {isTenant && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>CNH</Text>
            <InfoRow label="Numero" value={userProfile.cnhNumber} />
            <InfoRow label="Categoria" value={userProfile.cnhCategory} />
            <InfoRow label="Validade" value={userProfile.cnhExpiry} />
          </View>
        )}

        {/* Seguranca */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Seguranca</Text>
          {!isGoogle && (
            <TouchableOpacity style={styles.actionRow} onPress={handleResetPassword}>
              <Text style={styles.actionIcon}>🔒</Text>
              <View style={styles.actionContent}><Text style={styles.actionTitle}>Alterar Senha</Text><Text style={styles.actionDesc}>Enviaremos um link para seu email</Text></View>
              <Text style={styles.actionArrow}>→</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.actionRow, styles.logoutRow]} onPress={handleLogout}>
            <Text style={styles.actionIcon}>🚪</Text>
            <View style={styles.actionContent}><Text style={[styles.actionTitle, styles.logoutTitle]}>Sair da Conta</Text></View>
            <Text style={[styles.actionArrow, styles.logoutTitle]}>→</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#4F46E5', padding: 32, paddingTop: 48, alignItems: 'center' },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  avatarText: { fontSize: 36, fontWeight: 'bold', color: '#4F46E5' },
  headerName: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  headerRole: { fontSize: 14, color: '#C7D2FE' },
  verifiedBadge: { backgroundColor: '#D1FAE5', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, marginTop: 10 },
  verifiedText: { color: '#065F46', fontSize: 12, fontWeight: '700' },
  section: { backgroundColor: '#fff', marginTop: 12, padding: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937', marginBottom: 4 },
  editBtn: { color: '#4F46E5', fontWeight: '700', fontSize: 15 },
  editActions: { flexDirection: 'row', gap: 16 },
  cancelBtn: { color: '#6B7280', fontWeight: '600', fontSize: 14 },
  saveBtn: { color: '#4F46E5', fontWeight: '700', fontSize: 14 },
  fieldContainer: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#F9FAFB', color: '#1F2937' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  infoLabel: { fontSize: 14, color: '#6B7280', flex: 1 },
  infoValue: { fontSize: 14, fontWeight: '600', color: '#1F2937', flex: 2, textAlign: 'right' },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  actionIcon: { fontSize: 22, marginRight: 14 },
  actionContent: { flex: 1 },
  actionTitle: { fontSize: 16, fontWeight: '600', color: '#1F2937' },
  actionDesc: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  actionArrow: { fontSize: 18, color: '#9CA3AF' },
  logoutRow: { borderBottomWidth: 0 },
  logoutTitle: { color: '#EF4444' },
});

export default ProfileScreen;
