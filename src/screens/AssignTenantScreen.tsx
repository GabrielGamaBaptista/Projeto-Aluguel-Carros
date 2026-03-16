// src/screens/AssignTenantScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, FlatList, ScrollView,
} from 'react-native';
import { Search } from 'lucide-react-native';
import { carsService } from '../services/carsService';
import { authService } from '../services/authService';
import { tenantRequestService } from '../services/tenantRequestService';
import { firestore } from '../config/firebase';

const AssignTenantScreen = ({ route, navigation }) => {
  const { carId } = route.params;
  const [car, setCar] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [searching, setSearching] = useState(false);
  const [landlordName, setLandlordName] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoadingData(true);
    const carResult = await carsService.getCarById(carId);
    if (carResult.success) setCar(carResult.data);

    // Nome do locador para a notificacao
    const user = authService.getCurrentUser();
    if (user) {
      const profile = await authService.getCurrentUserProfile(user.uid);
      if (profile.success) setLandlordName(profile.data.name || '');
    }

    // Solicitacoes pendentes para este carro
    const reqResult = await tenantRequestService.getSentRequests(carId);
    if (reqResult.success) setPendingRequests(reqResult.data);

    setLoadingData(false);
  };

  const handleSearch = async () => {
    const query = searchQuery.trim().toLowerCase();
    if (!query || query.length < 3) {
      Alert.alert('Busca', 'Digite pelo menos 3 caracteres (email ou CPF).');
      return;
    }

    setSearching(true);
    try {
      const isCpfSearch = /^\d+$/.test(query.replace(/[\.\-]/g, ''));
      let results = [];

      if (isCpfSearch) {
        const cleanCpf = query.replace(/\D/g, '');
        // Query simples por CPF, filtrar role no client
        const snapshot = await firestore().collection('users')
          .where('cpf', '==', cleanCpf)
          .limit(5).get();
        results = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(u => u.role === 'locatario');
      } else {
        // Query por email range, filtrar role no client
        const snapshot = await firestore().collection('users')
          .where('email', '>=', query)
          .where('email', '<=', query + '\uf8ff')
          .limit(20).get();
        results = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(u => u.role === 'locatario')
          .slice(0, 10);
      }

      setSearchResults(results);
      if (results.length === 0) {
        Alert.alert('Nenhum resultado', 'Nenhum locatario encontrado com esses dados. Verifique se ele ja possui conta no app.');
      }
    } catch (error) {
      console.error('Search error:', error);
      Alert.alert('Erro', 'Erro ao buscar locatario.');
    }
    setSearching(false);
  };

  const handleSendRequest = (tenant) => {
    // Verificar se ja tem solicitacao pendente
    const alreadyPending = pendingRequests.find(r => r.tenantId === tenant.id);
    if (alreadyPending) {
      Alert.alert('Ja enviada', 'Ja existe uma solicitacao pendente para este locatario.');
      return;
    }

    const carInfo = `${car.brand} ${car.model} (${car.plate})`;
    Alert.alert(
      'Enviar Solicitacao',
      `Deseja enviar uma solicitacao de atribuicao para ${tenant.name} (${tenant.email})?\n\nO locatario devera aceitar para ser atribuido ao carro.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Enviar', onPress: async () => {
            setLoading(true);
            const user = authService.getCurrentUser();
            const result = await tenantRequestService.sendRequest(
              user.uid, tenant.id, carId, carInfo, landlordName
            );
            setLoading(false);
            if (result.success) {
              Alert.alert('Enviada!', 'Solicitacao enviada. O locatario recebera uma notificacao.');
              loadData(); // Recarregar pendentes
              setSearchResults([]);
              setSearchQuery('');
            } else {
              Alert.alert('Erro', result.error);
            }
          }
        },
      ]
    );
  };

  const handleCancelRequest = (requestId) => {
    Alert.alert('Cancelar Solicitacao', 'Deseja cancelar esta solicitacao?', [
      { text: 'Nao', style: 'cancel' },
      {
        text: 'Cancelar', style: 'destructive', onPress: async () => {
          await tenantRequestService.cancelRequest(requestId);
          loadData();
        }
      },
    ]);
  };

  const handleRemoveTenant = () => {
    Alert.alert('Remover Locatario', 'Deseja remover o locatario atual deste carro?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover', style: 'destructive', onPress: async () => {
          setLoading(true);
          const result = await carsService.removeTenant(carId);
          setLoading(false);
          if (result.success) {
            Alert.alert('Sucesso', 'Locatario removido!', [{ text: 'OK', onPress: () => navigation.goBack() }]);
          } else Alert.alert('Erro', result.error);
        }
      },
    ]);
  };

  const formatCpf = (cpf) => {
    if (!cpf) return '';
    const c = cpf.replace(/\D/g, '');
    if (c.length !== 11) return cpf;
    return c.slice(0, 3) + '.' + c.slice(3, 6) + '.' + c.slice(6, 9) + '-' + c.slice(9);
  };

  if (loadingData) return <View style={styles.center}><ActivityIndicator size="large" color="#4F46E5" /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Atribuir Locatario</Text>
        <Text style={styles.subtitle}>{car?.brand} {car?.model} • {car?.plate}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Remover locatario atual */}
        {car?.tenantId && (
          <TouchableOpacity style={styles.removeButton} onPress={handleRemoveTenant}>
            <Text style={styles.removeButtonText}>Remover Locatario Atual</Text>
          </TouchableOpacity>
        )}

        {/* Buscar locatario */}
        {!car?.tenantId && (
          <>
            <View style={styles.searchSection}>
              <Text style={styles.searchLabel}>Buscar locatario por email ou CPF:</Text>
              <View style={styles.searchRow}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Email ou CPF do locatario"
                  placeholderTextColor="#9CA3AF"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  onSubmitEditing={handleSearch}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={styles.searchButton} onPress={handleSearch} disabled={searching}>
                  {searching ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.searchBtnText}>Buscar</Text>}
                </TouchableOpacity>
              </View>
            </View>

            {/* Resultados */}
            {searchResults.length > 0 && (
              <View style={styles.resultsSection}>
                <Text style={styles.resultsTitle}>Resultados:</Text>
                {searchResults.map(tenant => (
                  <TouchableOpacity key={tenant.id} style={styles.resultCard}
                    onPress={() => handleSendRequest(tenant)} disabled={loading}>
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultName}>{tenant.name}</Text>
                      <Text style={styles.resultEmail}>{tenant.email}</Text>
                      {tenant.cpf && <Text style={styles.resultCpf}>CPF: {formatCpf(tenant.cpf)}</Text>}
                    </View>
                    <View style={styles.sendBadge}>
                      <Text style={styles.sendBadgeText}>Enviar</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Solicitacoes pendentes */}
            {pendingRequests.length > 0 && (
              <View style={styles.pendingSection}>
                <Text style={styles.pendingTitle}>Solicitacoes Pendentes:</Text>
                {pendingRequests.map(req => (
                  <View key={req.id} style={styles.pendingCard}>
                    <View style={styles.pendingInfo}>
                      <View style={styles.pendingBadge}>
                        <Text style={styles.pendingBadgeText}>Aguardando</Text>
                      </View>
                      <Text style={styles.pendingText}>
                        Solicitacao enviada. Aguardando resposta do locatario.
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => handleCancelRequest(req.id)}>
                      <Text style={styles.cancelText}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Instrucao inicial */}
            {searchResults.length === 0 && pendingRequests.length === 0 && (
              <View style={styles.emptyContainer}>
                <Search size={64} color="#D1D5DB" />
                <Text style={styles.emptyTitle}>Busque um locatario</Text>
                <Text style={styles.emptySubtitle}>Digite o email ou CPF do locatario que deseja atribuir a este carro. Ele recebera uma notificacao para aceitar.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  scrollContent: { paddingBottom: 32 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#fff', padding: 20, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1F2937' },
  subtitle: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  removeButton: { backgroundColor: '#FEE2E2', padding: 16, margin: 16, borderRadius: 12, alignItems: 'center' },
  removeButtonText: { fontSize: 16, fontWeight: 'bold', color: '#DC2626' },
  // Search
  searchSection: { padding: 16 },
  searchLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  searchRow: { flexDirection: 'row', gap: 10 },
  searchInput: { flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 14, fontSize: 16, borderWidth: 1, borderColor: '#D1D5DB', color: '#1F2937' },
  searchButton: { backgroundColor: '#4F46E5', borderRadius: 10, paddingHorizontal: 20, justifyContent: 'center' },
  searchBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  // Results
  resultsSection: { paddingHorizontal: 16 },
  resultsTitle: { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 8 },
  resultCard: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10,
    alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB',
  },
  resultInfo: { flex: 1 },
  resultName: { fontSize: 16, fontWeight: 'bold', color: '#1F2937', marginBottom: 2 },
  resultEmail: { fontSize: 14, color: '#6B7280' },
  resultCpf: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  sendBadge: { backgroundColor: '#4F46E5', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  sendBadgeText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  // Pending
  pendingSection: { paddingHorizontal: 16, marginTop: 8 },
  pendingTitle: { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 8 },
  pendingCard: {
    flexDirection: 'row', backgroundColor: '#FFFBEB', borderRadius: 12, padding: 16, marginBottom: 10,
    alignItems: 'center', borderWidth: 1, borderColor: '#FDE68A',
  },
  pendingInfo: { flex: 1 },
  pendingBadge: { backgroundColor: '#FEF3C7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start', marginBottom: 6 },
  pendingBadgeText: { fontSize: 12, fontWeight: '700', color: '#92400E' },
  pendingText: { fontSize: 13, color: '#92400E' },
  cancelText: { color: '#DC2626', fontWeight: '600', fontSize: 14 },
  // Empty
  emptyContainer: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
});

export default AssignTenantScreen;
