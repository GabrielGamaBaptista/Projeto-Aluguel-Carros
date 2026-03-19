// src/screens/EmailVerificationScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, SafeAreaView, ScrollView } from 'react-native';
import { Mail } from 'lucide-react-native';
import { authService } from '../services/authService';

const EmailVerificationScreen = ({ onVerified }) => {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const intervalRef = useRef(null);
  const cooldownRef = useRef(null);
  const userEmail = authService.getCurrentUser()?.email || '';

  useEffect(() => {
    intervalRef.current = setInterval(async () => {
      const r = await authService.checkEmailVerified();
      if (r.verified) { clearInterval(intervalRef.current); onVerified(); }
    }, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, []);

  const startCooldown = () => {
    setResendCooldown(60);
    cooldownRef.current = setInterval(() => {
      setResendCooldown(p => { if (p <= 1) { clearInterval(cooldownRef.current); return 0; } return p - 1; });
    }, 1000);
  };

  const handleResend = async () => {
    setLoading(true);
    const r = await authService.sendVerificationEmail();
    setLoading(false);
    if (r.success) { if (r.alreadyVerified) onVerified(); else { Alert.alert('Enviado', 'Novo link enviado.'); startCooldown(); } }
    else Alert.alert('Erro', r.error);
  };

  const handleCheck = async () => {
    setChecking(true);
    const r = await authService.checkEmailVerified();
    setChecking(false);
    if (r.verified) onVerified(); else Alert.alert('Nao verificado', 'Clique no link enviado para seu email.');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconC}><Mail size={48} color="#4F46E5" /></View>
        <Text style={styles.title}>Verifique seu Email</Text>
        <Text style={styles.subtitle}>Enviamos um link para:</Text>
        <Text style={styles.email}>{userEmail}</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Como verificar:</Text>
          <Text style={styles.step}>1. Abra seu email (verifique spam)</Text>
          <Text style={styles.step}>2. Clique no link de verificacao</Text>
          <Text style={styles.step}>3. Volte aqui e toque "Ja Verifiquei"</Text>
        </View>
        <TouchableOpacity style={[styles.primary, checking && styles.disabled]} onPress={handleCheck} disabled={checking}>
          {checking ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Ja Verifiquei Meu Email</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={[styles.secondary, (loading || resendCooldown > 0) && styles.disabled]} onPress={handleResend} disabled={loading || resendCooldown > 0}>
          {loading ? <ActivityIndicator color="#4F46E5" /> :
            <Text style={styles.secondaryText}>{resendCooldown > 0 ? `Reenviar (${resendCooldown}s)` : 'Reenviar Email'}</Text>}
        </TouchableOpacity>
        <Text style={styles.auto}>A verificacao sera detectada automaticamente</Text>
        <TouchableOpacity style={styles.logout} onPress={() => authService.logout()}>
          <Text style={styles.logoutText}>Usar outro email / Sair</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  iconC: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#EEF2FF', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  icon: { fontSize: 48 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#1F2937', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 15, color: '#6B7280', textAlign: 'center', marginBottom: 4 },
  email: { fontSize: 16, fontWeight: '700', color: '#4F46E5', textAlign: 'center', marginBottom: 24 },
  card: { backgroundColor: '#F9FAFB', padding: 20, borderRadius: 12, width: '100%', marginBottom: 28, borderWidth: 1, borderColor: '#E5E7EB' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 10 },
  step: { fontSize: 14, color: '#6B7280', lineHeight: 22 },
  primary: { backgroundColor: '#4F46E5', padding: 16, borderRadius: 12, width: '100%', alignItems: 'center', marginBottom: 12 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  secondary: { backgroundColor: '#EEF2FF', padding: 16, borderRadius: 12, width: '100%', alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: '#C7D2FE' },
  secondaryText: { color: '#4F46E5', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  auto: { fontSize: 12, color: '#9CA3AF', marginBottom: 20 },
  logout: { padding: 12 },
  logoutText: { color: '#6B7280', fontSize: 14, textDecorationLine: 'underline' },
});

export default EmailVerificationScreen;
