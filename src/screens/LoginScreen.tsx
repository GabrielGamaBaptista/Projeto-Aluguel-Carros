// src/screens/LoginScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { MdiCar } from '../components/icons/MdiIcons';
import { authService } from '../services/authService';
import { auth } from '../config/firebase';

const LoginScreen = ({ navigation }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const clean = (t) => t.replace(/\D/g, '');
  const isCpf = (t) => clean(t).length === 11 && !t.includes('@');
  const isCnpj = (t) => clean(t).length === 14 && !t.includes('@');

  const handleLogin = async () => {
    if (!identifier.trim() || !password) { Alert.alert('Erro', 'Preencha todos os campos'); return; }
    setLoading(true);
    const cleanId = clean(identifier);
    const result = (isCpf(identifier) || isCnpj(identifier))
      ? await authService.loginWithIdentifier(cleanId, password)
      : await authService.login(identifier.trim(), password);
    setLoading(false);
    if (!result.success) Alert.alert('Erro', result.error);
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    const result = await authService.signInWithGoogle();
    setGoogleLoading(false);
    if (!result.success && result.error !== 'Login cancelado.') Alert.alert('Erro', result.error);
  };

  const handleForgotPassword = () => {
    const email = identifier.trim();
    if (!email || isCpf(email) || isCnpj(email)) { Alert.alert('Esqueceu a senha?', 'Digite seu email no campo acima e tente novamente.'); return; }
    Alert.alert('Redefinir Senha', `Enviaremos um link para:\n${email}`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Enviar', onPress: async () => {
        try {
          await auth().sendPasswordResetEmail(email);
          Alert.alert('Email Enviado', 'Verifique sua caixa de entrada (e spam).');
        } catch (e) {
          if (e.code === 'auth/user-not-found') Alert.alert('Erro', 'Nenhuma conta com este email.');
          else if (e.code === 'auth/too-many-requests') Alert.alert('Erro', 'Muitas tentativas. Aguarde.');
          else Alert.alert('Erro', 'Nao foi possivel enviar.');
        }
      }},
    ]);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <MdiCar size={64} color="#4F46E5" />
          <Text style={styles.title}>Aluguel de Carros</Text>
          <Text style={styles.subtitle}>Faca login para continuar</Text>
        </View>

        <View style={styles.form}>
          <TouchableOpacity style={[styles.googleButton, googleLoading && styles.buttonDisabled]} onPress={handleGoogleSignIn} disabled={googleLoading}>
            {googleLoading ? <ActivityIndicator color="#1F2937" /> : (
              <><Text style={styles.googleIcon}>G</Text><Text style={styles.googleButtonText}>Continuar com Google</Text></>
            )}
          </TouchableOpacity>

          <View style={styles.separator}><View style={styles.separatorLine} /><Text style={styles.separatorText}>ou</Text><View style={styles.separatorLine} /></View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Email, CPF ou CNPJ</Text>
            <TextInput style={styles.input} placeholder="seu@email.com, 000.000.000-00 ou CNPJ" placeholderTextColor="#9CA3AF" value={identifier} onChangeText={setIdentifier} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.hint}>{isCnpj(identifier) ? 'Login via CNPJ' : isCpf(identifier) ? 'Login via CPF' : 'Login via Email'}</Text>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Senha</Text>
            <TextInput style={styles.input} placeholder="Sua senha" placeholderTextColor="#9CA3AF" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
          </View>

          <TouchableOpacity style={styles.forgotButton} onPress={handleForgotPassword}>
            <Text style={styles.forgotText}>Esqueci minha senha</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleLogin} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Entrar</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.linkButton} onPress={() => navigation.navigate('Register')}>
            <Text style={styles.linkText}>Nao tem conta? <Text style={styles.linkTextBold}>Criar conta</Text></Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 36 },
  logo: { fontSize: 64, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1F2937', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#6B7280' },
  form: { width: '100%' },
  googleButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 2, borderColor: '#E5E7EB', padding: 14, borderRadius: 12, marginBottom: 16 },
  googleIcon: { fontSize: 20, fontWeight: 'bold', color: '#4285F4', marginRight: 10, width: 28, height: 28, lineHeight: 28, textAlign: 'center', backgroundColor: '#F1F3F4', borderRadius: 14, overflow: 'hidden' },
  googleButtonText: { fontSize: 16, fontWeight: '600', color: '#1F2937' },
  separator: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  separatorLine: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  separatorText: { marginHorizontal: 16, fontSize: 14, color: '#9CA3AF', fontWeight: '500' },
  inputContainer: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#F9FAFB', color: '#1F2937' },
  hint: { fontSize: 12, color: '#4F46E5', marginTop: 4 },
  forgotButton: { alignItems: 'flex-end', marginBottom: 8, marginTop: -8 },
  forgotText: { color: '#4F46E5', fontSize: 14, fontWeight: '600' },
  button: { backgroundColor: '#4F46E5', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  linkButton: { marginTop: 16, alignItems: 'center' },
  linkText: { color: '#6B7280', fontSize: 14 },
  linkTextBold: { color: '#4F46E5', fontWeight: 'bold' },
});

export default LoginScreen;
