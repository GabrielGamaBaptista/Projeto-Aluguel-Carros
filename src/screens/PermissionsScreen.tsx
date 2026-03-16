// src/screens/PermissionsScreen.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Bell, Camera, Battery } from 'lucide-react-native';
import { permissionService } from '../services/permissionService';

interface Props {
  onComplete: () => void;
}

const PermissionsScreen = ({ onComplete }: Props) => {
  const [loading, setLoading] = useState(false);

  const handleGrant = async () => {
    setLoading(true);
    await permissionService.requestAllPermissions();
    await permissionService.openBatterySettings();
    await permissionService.markPermissionsRequested();
    setLoading(false);
    onComplete();
  };

  const handleSkip = async () => {
    await permissionService.markPermissionsRequested();
    onComplete();
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Permissoes Necessarias</Text>
        <Text style={styles.subtitle}>
          Para funcionar corretamente, o app precisa de algumas permissoes. Voce pode conceder agora ou mais tarde nas configuracoes.
        </Text>

        <View style={styles.card}>
          <Bell size={28} color="#4F46E5" style={{ marginRight: 14, marginTop: 2 }} />
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Notificacoes</Text>
            <Text style={styles.cardDesc}>
              Receba avisos de tarefas, cobranças e mensagens do seu locador ou locatario.
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Camera size={28} color="#4F46E5" style={{ marginRight: 14, marginTop: 2 }} />
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Camera</Text>
            <Text style={styles.cardDesc}>
              Fotografe o hodometro, veiculos, documentos e comprovantes diretamente pelo app.
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Battery size={28} color="#4F46E5" style={{ marginRight: 14, marginTop: 2 }} />
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Otimizacao de Bateria</Text>
            <Text style={styles.cardDesc}>
              Garante a entrega de notificacoes mesmo com o app fechado em segundo plano.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.configBtn}
            onPress={() => permissionService.openBatterySettings()}
          >
            <Text style={styles.configBtnText}>Configurar</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
          onPress={handleGrant}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Conceder Permissoes</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} disabled={loading}>
          <Text style={styles.skipBtnText}>Agora nao</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  content: {
    padding: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    lineHeight: 22,
    marginBottom: 32,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  cardIcon: {
    fontSize: 28,
    marginRight: 14,
    marginTop: 2,
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  configBtn: {
    backgroundColor: '#EEF2FF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    marginTop: 8,
    marginLeft: 8,
  },
  configBtnText: {
    color: '#4F46E5',
    fontWeight: '600',
    fontSize: 13,
  },
  primaryBtn: {
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  primaryBtnDisabled: {
    opacity: 0.7,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  skipBtn: {
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 8,
  },
  skipBtnText: {
    color: '#9CA3AF',
    fontSize: 14,
  },
});

export default PermissionsScreen;
