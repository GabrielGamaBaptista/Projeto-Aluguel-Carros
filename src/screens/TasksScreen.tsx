// src/screens/TasksScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  RefreshControl, SectionList, ScrollView,
} from 'react-native';
import { authService } from '../services/authService';
import { tasksService } from '../services/tasksService';
import { carsService } from '../services/carsService';
import { usersService } from '../services/usersService';

const TasksScreen = ({ navigation }) => {
  const [tasks, setTasks] = useState([]);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('pending');
  const [carsMap, setCarsMap] = useState({});
  const [tenantsMap, setTenantsMap] = useState({});
  const [selectedCarFilter, setSelectedCarFilter] = useState('all');

  useEffect(() => { loadTasks(); }, []);
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => loadTasks());
    return unsub;
  }, [navigation]);

  const loadTasks = async () => {
    const currentUser = authService.getCurrentUser();
    if (!currentUser) { setLoading(false); return; }

    const profileResult = await authService.getCurrentUserProfile(currentUser.uid);
    if (!profileResult.success) { setLoading(false); return; }
    setUserProfile(profileResult.data);

    const isLandlord = profileResult.data.role === 'locador';

    // Carregar carros
    let carsList = [];
    if (isLandlord) {
      const r = await carsService.getCarsByLandlord(currentUser.uid);
      if (r.success) carsList = r.data;
    } else {
      const r = await carsService.getRentedCars(currentUser.uid);
      if (r.success) carsList = r.data;
    }
    const cMap = {};
    carsList.forEach(c => { cMap[c.id] = c; });
    setCarsMap(cMap);

    // Locatarios (para locador)
    if (isLandlord) {
      const tenantIds = [...new Set(carsList.filter(c => c.tenantId).map(c => c.tenantId))];
      const tMap = {};
      for (const tid of tenantIds) {
        const tResult = await usersService.getUserById(tid);
        if (tResult.success) tMap[tid] = tResult.data;
      }
      setTenantsMap(tMap);
    }

    // Pendentes + Concluidas
    const pendR = await tasksService.getAllUserTasks(currentUser.uid, profileResult.data.role, 'pending');
    if (pendR.success) setTasks(pendR.data);

    const compR = await tasksService.getAllUserTasks(currentUser.uid, profileResult.data.role, 'completed');
    if (compR.success) setCompletedTasks(compR.data);

    setLoading(false);
  };

  const onRefresh = async () => { setRefreshing(true); await loadTasks(); setRefreshing(false); };

  const getTaskIcon = (type) => {
    switch (type) {
      case 'km_update': return '📍'; case 'photo_inspection': return '📸';
      case 'oil_change': return '🛢'; case 'maintenance': return '🔧'; default: return '📋';
    }
  };

  const getTaskColor = (type) => {
    switch (type) {
      case 'km_update': return '#3B82F6'; case 'photo_inspection': return '#8B5CF6';
      case 'oil_change': return '#F59E0B'; case 'maintenance': return '#059669'; default: return '#6B7280';
    }
  };

  const formatDueDate = (d) => {
    if (!d) return 'Sem data';
    try {
      if (d.toDate) return d.toDate().toLocaleDateString('pt-BR');
      if (d instanceof Date) return d.toLocaleDateString('pt-BR');
      return 'Sem data';
    } catch { return 'Sem data'; }
  };

  const getDueDateObj = (d) => {
    if (!d) return null;
    try { return d.toDate ? d.toDate() : d instanceof Date ? d : null; } catch { return null; }
  };

  const isLandlord = userProfile?.role === 'locador';

  const getCarFilters = () => {
    const data = activeTab === 'pending' ? tasks : completedTasks;
    const carIds = [...new Set(data.map(t => t.carId))];
    return carIds.map(cid => {
      const car = carsMap[cid];
      return { id: cid, shortLabel: car ? `${car.model} - ${car.plate}` : cid };
    });
  };

  const getFilteredTasks = () => {
    const data = activeTab === 'pending' ? tasks : completedTasks;
    if (selectedCarFilter === 'all') return data;
    return data.filter(t => t.carId === selectedCarFilter);
  };

  const getSections = () => {
    const filtered = getFilteredTasks();
    const groups = {};
    filtered.forEach(task => {
      const car = carsMap[task.carId];
      const key = task.carId;
      if (!groups[key]) {
        const tenant = car?.tenantId ? tenantsMap[car.tenantId] : null;
        groups[key] = {
          carId: key,
          title: car ? `${car.brand} ${car.model}` : 'Carro',
          plate: car?.plate || '',
          tenantName: tenant?.name || '',
          data: [],
        };
      }
      groups[key].data.push(task);
    });
    return Object.values(groups);
  };

  const renderTaskItem = ({ item }) => {
    const isCompleted = item.status === 'completed';
    const dueDateObj = getDueDateObj(isCompleted ? item.completedAt : item.dueDate);
    const isOverdue = !isCompleted && dueDateObj ? dueDateObj < new Date() : false;
    const car = carsMap[item.carId];
    const isRevision = item.revisionRequested && !isCompleted;

    return (
      <TouchableOpacity
        style={[styles.taskCard, isCompleted && styles.taskCardCompleted, isRevision && styles.taskCardRevision]}
        onPress={() => navigation.navigate('TaskDetails', { taskId: item.id, carId: item.carId })}
      >
        <View style={styles.taskHeader}>
          <View style={[styles.taskIcon, { backgroundColor: getTaskColor(item.type) + '20' }]}>
            <Text style={styles.taskIconText}>{getTaskIcon(item.type)}</Text>
          </View>
          <View style={styles.taskInfo}>
            <Text style={styles.taskTitle}>{item.title}</Text>
            {selectedCarFilter === 'all' && car && (
              <Text style={styles.carInfoInline}>{car.brand} {car.model} - {car.plate}</Text>
            )}
          </View>
          <View style={styles.taskBadges}>
            {item.manualRequest && <View style={styles.manualBadge}><Text style={styles.manualBadgeText}>Manual</Text></View>}
            {item.approved && <View style={styles.approvedSmallBadge}><Text style={styles.approvedSmallText}>✓</Text></View>}
          </View>
        </View>

        <Text style={styles.taskDescription} numberOfLines={2}>{item.description}</Text>

        {isRevision && (
          <View style={styles.revisionTag}>
            <Text style={styles.revisionTagText}>⚠️ Correcao solicitada</Text>
          </View>
        )}

        <View style={styles.taskFooter}>
          {isCompleted ? (
            <View style={item.approved ? styles.approvedTag : styles.completedTag}>
              <Text style={item.approved ? styles.approvedTagText : styles.completedText}>
                {item.approved ? 'Aprovada' : 'Concluida'} {formatDueDate(item.completedAt)}
              </Text>
            </View>
          ) : isOverdue ? (
            <View style={styles.overdueTag}>
              <Text style={styles.overdueText}>Atrasada - {formatDueDate(item.dueDate)}</Text>
            </View>
          ) : (
            <View style={styles.dueDateTag}>
              <Text style={styles.dueDateText}>Vencimento: {formatDueDate(item.dueDate)}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderSectionHeader = ({ section }) => (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderLeft}>
        <Text style={styles.sectionCarName}>{section.title}</Text>
        <Text style={styles.sectionPlate}>{section.plate}</Text>
      </View>
      {isLandlord && section.tenantName ? (
        <View style={styles.sectionTenantBadge}>
          <Text style={styles.sectionTenantText} numberOfLines={1}>{section.tenantName}</Text>
        </View>
      ) : null}
      <Text style={styles.sectionCount}>{section.data.length}</Text>
    </View>
  );

  const renderCarFilters = () => {
    const filters = getCarFilters();
    if (filters.length <= 1) return null;
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContainer}>
        <TouchableOpacity style={[styles.filterChip, selectedCarFilter === 'all' && styles.filterChipActive]}
          onPress={() => setSelectedCarFilter('all')}>
          <Text style={[styles.filterChipText, selectedCarFilter === 'all' && styles.filterChipTextActive]}>
            Todos ({(activeTab === 'pending' ? tasks : completedTasks).length})
          </Text>
        </TouchableOpacity>
        {filters.map(f => (
          <TouchableOpacity key={f.id} style={[styles.filterChip, selectedCarFilter === f.id && styles.filterChipActive]}
            onPress={() => setSelectedCarFilter(f.id)}>
            <Text style={[styles.filterChipText, selectedCarFilter === f.id && styles.filterChipTextActive]}>{f.shortLabel}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  };

  if (loading) return <View style={styles.container}><Text>Carregando...</Text></View>;

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <Text style={styles.headerTitle}>Tarefas</Text>
        <Text style={styles.headerSubtitle}>
          {tasks.length} pendente{tasks.length !== 1 ? 's' : ''} | {completedTasks.length} concluida{completedTasks.length !== 1 ? 's' : ''}
        </Text>
      </View>

      <View style={styles.tabsContainer}>
        <TouchableOpacity style={[styles.tab, activeTab === 'pending' && styles.tabActive]}
          onPress={() => { setActiveTab('pending'); setSelectedCarFilter('all'); }}>
          <Text style={[styles.tabText, activeTab === 'pending' && styles.tabTextActive]}>Pendentes ({tasks.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'completed' && styles.tabActive]}
          onPress={() => { setActiveTab('completed'); setSelectedCarFilter('all'); }}>
          <Text style={[styles.tabText, activeTab === 'completed' && styles.tabTextActive]}>Concluidas ({completedTasks.length})</Text>
        </TouchableOpacity>
      </View>

      {renderCarFilters()}

      <SectionList
        sections={getSections()}
        keyExtractor={(item) => item.id}
        renderItem={renderTaskItem}
        renderSectionHeader={renderSectionHeader}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{activeTab === 'pending' ? '✅' : '📂'}</Text>
            <Text style={styles.emptyTitle}>{activeTab === 'pending' ? 'Nenhuma tarefa pendente!' : 'Nenhuma tarefa concluida'}</Text>
            <Text style={styles.emptySubtitle}>{activeTab === 'pending' ? 'Todas as tarefas estao em dia' : 'As tarefas concluidas aparecerao aqui'}</Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  headerBar: { backgroundColor: '#fff', padding: 20, paddingTop: 48, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#1F2937' },
  headerSubtitle: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  tabsContainer: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: '#4F46E5' },
  tabText: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  tabTextActive: { color: '#4F46E5' },
  // Filters
  filterScroll: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  filterContainer: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  filterChipActive: { backgroundColor: '#EEF2FF', borderColor: '#4F46E5' },
  filterChipText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  filterChipTextActive: { color: '#4F46E5', fontWeight: '700' },
  // Sections
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#E5E7EB', paddingHorizontal: 16, paddingVertical: 10,
    marginTop: 8, borderRadius: 8, marginHorizontal: 16,
  },
  sectionHeaderLeft: { flex: 1, minWidth: 0 },
  sectionCarName: { fontSize: 15, fontWeight: 'bold', color: '#1F2937' },
  sectionPlate: { fontSize: 12, color: '#6B7280', marginTop: 1 },
  sectionTenantBadge: { backgroundColor: '#EEF2FF', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginHorizontal: 8, maxWidth: 130, flexShrink: 1 },
  sectionTenantText: { fontSize: 12, color: '#4F46E5', fontWeight: '600' },
  sectionCount: { fontSize: 14, fontWeight: 'bold', color: '#fff', backgroundColor: '#4F46E5', width: 28, height: 28, lineHeight: 28, textAlign: 'center', borderRadius: 14, overflow: 'hidden' },
  // Tasks
  list: { paddingBottom: 16 },
  taskCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 8, marginHorizontal: 16, elevation: 2 },
  taskCardCompleted: { backgroundColor: '#F0FDF4' },
  taskCardRevision: { borderLeftWidth: 4, borderLeftColor: '#F59E0B' },
  taskHeader: { flexDirection: 'row', marginBottom: 10 },
  taskIcon: { width: 44, height: 44, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  taskIconText: { fontSize: 22 },
  taskInfo: { flex: 1, justifyContent: 'center' },
  taskTitle: { fontSize: 15, fontWeight: 'bold', color: '#1F2937', marginBottom: 2 },
  carInfoInline: { fontSize: 13, color: '#6B7280' },
  taskBadges: { alignItems: 'flex-end', gap: 4 },
  manualBadge: { backgroundColor: '#DBEAFE', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  manualBadgeText: { fontSize: 10, color: '#1E40AF', fontWeight: '700' },
  approvedSmallBadge: { backgroundColor: '#D1FAE5', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  approvedSmallText: { fontSize: 12, color: '#065F46', fontWeight: '700' },
  taskDescription: { fontSize: 13, color: '#6B7280', marginBottom: 10, lineHeight: 18 },
  revisionTag: { backgroundColor: '#FEF3C7', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignSelf: 'flex-start', marginBottom: 8 },
  revisionTagText: { fontSize: 12, fontWeight: '600', color: '#92400E' },
  taskFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dueDateTag: { backgroundColor: '#DBEAFE', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  dueDateText: { fontSize: 12, color: '#1E40AF', fontWeight: '600' },
  overdueTag: { backgroundColor: '#FEE2E2', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  overdueText: { fontSize: 12, color: '#DC2626', fontWeight: '600' },
  completedTag: { backgroundColor: '#D1FAE5', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  completedText: { fontSize: 12, color: '#065F46', fontWeight: '600' },
  approvedTag: { backgroundColor: '#D1FAE5', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#059669' },
  approvedTagText: { fontSize: 12, color: '#065F46', fontWeight: '700' },
  // Empty
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center' },
});

export default TasksScreen;
