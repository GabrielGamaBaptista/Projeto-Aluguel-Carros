// src/screens/HomeScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, Alert, ScrollView, ActivityIndicator, StatusBar,
} from 'react-native';
import { Bell, ClipboardList } from 'lucide-react-native';
import { showMessage } from 'react-native-flash-message';
import { MdiCar, MdiPin } from '../components/icons/MdiIcons';
import { authService } from '../services/authService';
import { carsService } from '../services/carsService';
import { tasksService } from '../services/tasksService';
import { usersService } from '../services/usersService';
import { muralService, MURAL_CATEGORIES } from '../services/muralService';
import { tenantRequestService } from '../services/tenantRequestService';

const HomeScreen = ({ navigation }) => {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [cars, setCars] = useState([]);
  const [muralPosts, setMuralPosts] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'rented' | 'available'>('all');

  useEffect(() => { loadData(); }, []);
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => { loadData(); });
    return unsub;
  }, [navigation]);

  const loadData = async () => {
    const currentUser = authService.getCurrentUser();
    if (currentUser) {
      setUser(currentUser);
      const profileResult = await authService.getCurrentUserProfile(currentUser.uid);
      if (profileResult.success) {
        setUserProfile(profileResult.data);
        if (profileResult.data.role === 'locador') {
          await loadCars(currentUser.uid);
        } else {
          await loadRentedCars(currentUser.uid);
          await loadMuralPosts(currentUser.uid);
          await loadPendingRequests(currentUser.uid);
        }
      }
    }
    setLoading(false);
  };

  const loadCars = async (userId) => {
    const result = await carsService.getCarsByLandlord(userId);
    if (result.success) {
      const carsWithTenants = await Promise.all(
        result.data.map(async (car) => {
          if (car.tenantId) {
            const tenantResult = await usersService.getUserById(car.tenantId);
            return { ...car, tenantName: tenantResult.success ? tenantResult.data.name : 'Locatario' };
          }
          return car;
        })
      );
      setCars(carsWithTenants);
      for (const car of carsWithTenants) { await tasksService.generateAutomaticTasks(car.id, car); }
    }
  };

  const loadRentedCars = async (userId) => {
    try {
      const result = await carsService.getRentedCars(userId);
      if (result.success) {
        setCars(result.data);
        for (const car of result.data) { await tasksService.generateAutomaticTasks(car.id, car); }
      }
    } catch (error) { console.error('Load rented cars error:', error); }
  };

  const loadMuralPosts = async (tenantId) => {
    try {
      const carsResult = await carsService.getRentedCars(tenantId);
      if (carsResult.success && carsResult.data.length > 0) {
        const landlordIds = [...new Set(carsResult.data.map(c => c.landlordId).filter(Boolean))];
        const postsResult = await muralService.getPostsForTenant(tenantId, landlordIds);
        if (postsResult.success) setMuralPosts(postsResult.data);
      }
    } catch (error) { console.error('Load mural posts error:', error); }
  };

  const loadPendingRequests = async (tenantId) => {
    try {
      const result = await tenantRequestService.getPendingRequests(tenantId);
      if (result.success) setPendingRequests(result.data);
    } catch (error) { console.error('Load pending requests error:', error); }
  };

  const handleAcceptRequest = async (request) => {
    Alert.alert(
      'Aceitar Solicitacao',
      `Deseja aceitar a atribuicao do carro ${request.carInfo}?\n\nVoce sera vinculado a este veiculo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Aceitar', onPress: async () => {
            setAcceptingId(request.id);
            const result = await tenantRequestService.acceptRequest(request.id, request.carId);
            setAcceptingId(null);
            if (result.success) {
              showMessage({ message: 'Voce foi atribuido ao carro com sucesso!', type: 'success' });
              loadData();
            } else { Alert.alert('Erro', result.error); }
          }
        },
      ]
    );
  };

  const handleRejectRequest = (request) => {
    Alert.alert(
      'Recusar Solicitacao',
      `Deseja recusar a atribuicao do carro ${request.carInfo}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Recusar', style: 'destructive', onPress: async () => {
            await tenantRequestService.rejectRequest(request.id, request.landlordId, request.carInfo, request.carId);
            loadData();
          }
        },
      ]
    );
  };

  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const getCategoryLabel = (val) => MURAL_CATEGORIES.find(c => c.value === val)?.label || val;
  const getCategoryColor = (val) => {
    switch (val) {
      case 'pagamento': return '#059669'; case 'contato': return '#2563EB';
      case 'regras': return '#DC2626'; case 'aviso': return '#D97706';
      case 'urgente': return '#DC2626'; case 'geral': return '#4F46E5';
      default: return '#6B7280';
    }
  };
  const formatPostDate = (ts) => {
    if (!ts?.toDate) return ''; try { return ts.toDate().toLocaleDateString('pt-BR'); } catch { return ''; }
  };

  const isLandlord = userProfile?.role === 'locador';
  const isTenant = userProfile?.role === 'locatario';

  // ===== RENDER LOCATARIO =====
  const renderTenantView = () => (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Ola, {userProfile?.name}!</Text>
          <Text style={styles.role}>Locatario</Text>
        </View>
      </View>

      {/* Solicitacoes pendentes */}
      {pendingRequests.length > 0 && (
        <View style={styles.sectionPadded}>
          <Text style={styles.sectionTitle}>Solicitacoes Pendentes</Text>
          {pendingRequests.map(req => (
            <View key={req.id} style={styles.requestCard}>
              <View style={styles.requestHeader}>
                <Bell size={28} color="#4F46E5" style={{ marginRight: 12 }} />
                <View style={styles.requestInfo}>
                  <Text style={styles.requestTitle}>{req.landlordName || 'Locador'} quer atribuir voce ao carro:</Text>
                  <Text style={styles.requestCar}>{req.carInfo}</Text>
                </View>
              </View>
              <View style={styles.requestActions}>
                <TouchableOpacity style={styles.acceptButton} onPress={() => handleAcceptRequest(req)}
                  disabled={acceptingId === req.id}>
                  {acceptingId === req.id ? <ActivityIndicator size="small" color="#fff" /> :
                    <Text style={styles.acceptButtonText}>Aceitar</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.rejectButton} onPress={() => handleRejectRequest(req)}>
                  <Text style={styles.rejectButtonText}>Recusar</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Carro atribuido */}
      <View style={styles.sectionPadded}>
        <Text style={styles.sectionTitle}>Meu Veiculo</Text>
        {cars.length === 0 ? (
          <View style={styles.emptyCard}>
            <MdiCar size={48} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>Nenhum veiculo atribuido</Text>
            <Text style={styles.emptySubtitle}>Aguarde seu locador enviar uma solicitacao</Text>
          </View>
        ) : (
          cars.map(car => (
            <TouchableOpacity key={car.id} style={styles.carCardTenant}
              onPress={() => navigation.navigate('CarDetails', { carId: car.id })}>
              <View style={styles.carCardHeader}>
                <MdiCar size={40} color="#4F46E5" style={{ marginRight: 14 }} />
                <View style={styles.carCardInfo}>
                  <Text style={styles.carBrand}>{car.brand}</Text>
                  <Text style={styles.carModel}>{car.model}</Text>
                </View>
              </View>
              <View style={styles.carCardDetails}>
                <Text style={styles.carDetailItem}>{car.year} - {car.plate}</Text>
                <Text style={styles.carDetailItem}>{car.totalKm?.toLocaleString() || 0} km</Text>
              </View>
              <Text style={styles.carCardTap}>Toque para ver detalhes e tarefas →</Text>
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* Mural */}
      <View style={styles.sectionPadded}>
        <Text style={styles.sectionTitle}>Mural de Avisos</Text>
        {muralPosts.length === 0 ? (
          <View style={styles.emptyCard}>
            <ClipboardList size={48} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>Nenhum aviso</Text>
            <Text style={styles.emptySubtitle}>Os avisos do seu locador aparecerao aqui</Text>
          </View>
        ) : (
          muralPosts.map(post => (
            <View key={post.id} style={styles.muralCard}>
              <View style={styles.muralCardHeader}>
                {post.pinned && <MdiPin size={14} color="#B45309" />}
                <View style={[styles.categoryTag, { backgroundColor: getCategoryColor(post.category) + '15' }]}>
                  <Text style={[styles.categoryTagText, { color: getCategoryColor(post.category) }]}>{getCategoryLabel(post.category)}</Text>
                </View>
                <Text style={styles.muralDate}>{formatPostDate(post.createdAt)}</Text>
              </View>
              {post.title ? <Text style={styles.muralTitle}>{post.title}</Text> : null}
              <Text style={styles.muralContent}>{post.content}</Text>
            </View>
          ))
        )}
      </View>
      <View style={styles.bottomSpace} />
    </ScrollView>
  );

  // ===== RENDER LOCADOR =====
  const renderLandlordView = () => {
    const filteredCars = statusFilter === 'all' ? cars : cars.filter(c => c.status === statusFilter);
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Ola, {userProfile?.name}!</Text>
            <Text style={styles.role}>Locador</Text>
          </View>
        </View>

        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{cars.length}</Text>
            <Text style={styles.statLabel}>Total de Carros</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{cars.filter(c => c.status === 'rented').length}</Text>
            <Text style={styles.statLabel}>Alugados</Text>
          </View>
        </View>

        <View style={styles.filterRow}>
          {([['all', 'Todos'], ['rented', 'Alugados'], ['available', 'Disponiveis']] as const).map(([val, label]) => (
            <TouchableOpacity
              key={val}
              style={[styles.filterChip, statusFilter === val && styles.filterChipActive]}
              onPress={() => setStatusFilter(val)}>
              <Text style={[styles.filterChipText, statusFilter === val && styles.filterChipTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <FlatList
          data={filteredCars}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.carCard} onPress={() => navigation.navigate('CarDetails', { carId: item.id })}>
              <View style={styles.carHeader}>
                <Text style={styles.carBrand}>{item.brand}</Text>
                <View style={[styles.statusBadge, item.status === 'rented' && styles.statusRented]}>
                  <Text style={styles.statusText}>{item.status === 'rented' ? 'Alugado' : 'Disponivel'}</Text>
                </View>
              </View>
              <Text style={styles.carModel}>{item.model}</Text>
              <Text style={styles.carYear}>{item.year} - {item.plate}</Text>
              <View style={styles.carFooter}>
                <Text style={styles.carKm}>{item.totalKm?.toLocaleString() || 0} km</Text>
                {item.tenantName && <Text style={styles.tenantNameLabel} numberOfLines={1}>{item.tenantName}</Text>}
              </View>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            cars.length === 0 ? (
              <TouchableOpacity style={styles.addCarCardEmpty} onPress={() => navigation.navigate('AddCar')}>
                <Text style={styles.addCarEmptyIcon}>+</Text>
                <Text style={styles.addCarEmptyTitle}>Adicionar seu primeiro carro</Text>
                <Text style={styles.addCarEmptySubtitle}>Toque aqui para comecar</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.emptyCard}>
                <MdiCar size={48} color="#D1D5DB" />
                <Text style={styles.emptyTitle}>Nenhum carro encontrado</Text>
                <Text style={styles.emptySubtitle}>Nenhum veiculo com o status selecionado</Text>
              </View>
            )
          }
          ListFooterComponent={
            filteredCars.length > 0 ? (
              <TouchableOpacity style={styles.addCarCard} onPress={() => navigation.navigate('AddCar')}>
                <Text style={styles.addCarPlusIcon}>+</Text>
                <Text style={styles.addCarCardText}>Adicionar Carro</Text>
              </TouchableOpacity>
            ) : null
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      </View>
    );
  };

  if (loading) return <View style={styles.container}><Text>Carregando...</Text></View>;
  return isTenant ? renderTenantView() : renderLandlordView();
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  header: { backgroundColor: '#fff', padding: 20, paddingTop: (StatusBar.currentHeight || 24) + 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  greeting: { fontSize: 24, fontWeight: 'bold', color: '#1F2937' },
  role: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  statsContainer: { flexDirection: 'row', padding: 16, gap: 12 },
  statCard: { flex: 1, backgroundColor: '#fff', padding: 16, borderRadius: 12, alignItems: 'center' },
  statNumber: { fontSize: 32, fontWeight: 'bold', color: '#4F46E5' },
  statLabel: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  sectionPadded: { padding: 16 },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', color: '#1F2937', marginBottom: 12 },
  list: { padding: 16 },
  // Request cards
  requestCard: { backgroundColor: '#fff', borderRadius: 16, padding: 18, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#F59E0B', elevation: 3 },
  requestHeader: { flexDirection: 'row', marginBottom: 14 },
  requestIcon: { fontSize: 28, marginRight: 12 },
  requestInfo: { flex: 1 },
  requestTitle: { fontSize: 14, color: '#374151', lineHeight: 20 },
  requestCar: { fontSize: 17, fontWeight: 'bold', color: '#1F2937', marginTop: 4 },
  requestActions: { flexDirection: 'row', gap: 10 },
  acceptButton: { flex: 2, backgroundColor: '#4F46E5', padding: 14, borderRadius: 10, alignItems: 'center' },
  acceptButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  rejectButton: { flex: 1, backgroundColor: '#FEE2E2', padding: 14, borderRadius: 10, alignItems: 'center' },
  rejectButtonText: { color: '#DC2626', fontWeight: 'bold', fontSize: 15 },
  // Landlord car cards
  carCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, elevation: 3 },
  carHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  carBrand: { fontSize: 14, fontWeight: '600', color: '#6B7280', textTransform: 'uppercase' },
  statusBadge: { backgroundColor: '#D1FAE5', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  statusRented: { backgroundColor: '#FEE2E2' },
  statusText: { fontSize: 12, fontWeight: '600' },
  carModel: { fontSize: 20, fontWeight: 'bold', color: '#1F2937', marginBottom: 4 },
  carYear: { fontSize: 14, color: '#6B7280', marginBottom: 12 },
  carFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  carKm: { fontSize: 14, color: '#6B7280', flexShrink: 0 },
  tenantNameLabel: { fontSize: 14, color: '#4F46E5', fontWeight: '600', flexShrink: 1, marginLeft: 8 },
  // Tenant car card
  carCardTenant: { backgroundColor: '#fff', borderRadius: 16, padding: 20, elevation: 3, borderLeftWidth: 4, borderLeftColor: '#4F46E5', marginBottom: 10 },
  carCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  carEmoji: { fontSize: 40, marginRight: 14 },
  carCardInfo: { flex: 1 },
  carCardDetails: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  carDetailItem: { fontSize: 14, color: '#6B7280', fontWeight: '500' },
  carCardTap: { fontSize: 13, color: '#4F46E5', fontWeight: '600' },
  // Mural
  muralCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10, elevation: 2 },
  muralCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  pinnedBadge: { fontSize: 14 },
  categoryTag: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  categoryTagText: { fontSize: 11, fontWeight: '700' },
  muralDate: { fontSize: 11, color: '#9CA3AF', marginLeft: 'auto' },
  muralTitle: { fontSize: 16, fontWeight: 'bold', color: '#1F2937', marginBottom: 6 },
  muralContent: { fontSize: 14, color: '#374151', lineHeight: 21 },
  // Empty
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyCard: { backgroundColor: '#fff', borderRadius: 12, padding: 32, alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: 'bold', color: '#1F2937', marginBottom: 4 },
  emptySubtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center' },
  addCarCardEmpty: {
    backgroundColor: '#EEF2FF', borderRadius: 16, padding: 40,
    alignItems: 'center', borderWidth: 2, borderColor: '#C7D2FE', borderStyle: 'dashed',
    marginBottom: 12,
  },
  addCarEmptyIcon: { fontSize: 48, color: '#4F46E5', fontWeight: 'bold' },
  addCarEmptyTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937', marginTop: 12 },
  addCarEmptySubtitle: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  addCarCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 20, marginBottom: 12,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2,
    borderColor: '#D1D5DB', borderStyle: 'dashed', minHeight: 72,
  },
  addCarPlusIcon: { fontSize: 28, color: '#4F46E5', fontWeight: 'bold' },
  addCarCardText: { fontSize: 15, color: '#4F46E5', fontWeight: '600', marginTop: 2 },
  bottomSpace: { height: 40 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  filterChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#D1D5DB',
  },
  filterChipActive: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  filterChipText: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  filterChipTextActive: { color: '#fff' },
});

export default HomeScreen;
