import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import paymentService from '../services/paymentService';

const FREQUENCY_LABELS: Record<string, string> = {
  MONTHLY: 'Mensal', BIWEEKLY: 'Quinzenal', WEEKLY: 'Semanal',
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'PENDING': return '#6B7280';
    case 'CONFIRMED': return '#3B82F6';
    case 'RECEIVED': return '#059669';
    case 'OVERDUE': return '#DC2626';
    case 'CANCELLED': return '#9CA3AF';
    default: return '#6B7280';
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'PENDING': return 'Pendente';
    case 'CONFIRMED': return 'Confirmado';
    case 'RECEIVED': return 'Recebido';
    case 'OVERDUE': return 'Vencido';
    case 'CANCELLED': return 'Cancelado';
    default: return status;
  }
};


const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const dateOnly = dateStr.split('T')[0];
  const [year, month, day] = dateOnly.split('-');
  return `${day}/${month}/${year}`;
};

export default function TenantPaymentsScreen() {
  const navigation = useNavigation<any>();
  const [charges, setCharges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Paginacao (Q3.2)
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Contrato ativo do locatario (Q5.7)
  const [activeContract, setActiveContract] = useState<any>(null);

  const sortCharges = (data: any[]) => {
    const active = ['PENDING', 'OVERDUE'];
    const paid = ['RECEIVED', 'CONFIRMED'];
    const byDueDateAsc = (a: any, b: any) => (a.dueDate || '').localeCompare(b.dueDate || '');
    const byDueDateDesc = (a: any, b: any) => (b.dueDate || '').localeCompare(a.dueDate || '');
    const pending = data.filter(c => active.includes(c.status)).sort(byDueDateAsc);
    const paidRecurring = data.filter(c => paid.includes(c.status) && c.contractId).sort(byDueDateDesc);
    const paidOneOff = data.filter(c => paid.includes(c.status) && !c.contractId).sort(byDueDateDesc);
    return [...pending, ...paidRecurring, ...paidOneOff];
  };

  const loadData = useCallback(async () => {
    const [chargesResult, contractResult] = await Promise.all([
      paymentService.getTenantChargesPaginated({ pageSize: 20 }),
      paymentService.getActiveContractForTenant(),
    ]);
    setCharges(sortCharges(chargesResult.data));
    setLastDoc(chargesResult.lastDoc);
    setHasMore(chargesResult.hasMore);
    setActiveContract(contractResult.data || null);
  }, []);

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setLastDoc(null);
    setHasMore(false);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    const result = await paymentService.getTenantChargesPaginated({ pageSize: 20, startAfter: lastDoc });
    setCharges(prev => {
      const existingIds = new Set(prev.map((c: any) => c.id));
      const newCharges = result.data.filter((c: any) => !existingIds.has(c.id));
      return sortCharges([...prev, ...newCharges]);
    });
    setLastDoc(result.lastDoc);
    setHasMore(result.hasMore);
    setLoadingMore(false);
  }, [hasMore, loadingMore, lastDoc]);

  const renderCharge = ({ item }: { item: any }) => {
    const canPay = item.status === 'PENDING' || item.status === 'OVERDUE';
    const isPaid = item.status === 'RECEIVED' || item.status === 'CONFIRMED';
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('PaymentDetails', { chargeId: item.id, charge: item })}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.carInfo}>{item.carInfo || 'Aluguel'}</Text>
          <View style={[styles.badge, { backgroundColor: getStatusColor(item.status) }]}>
            <Text style={styles.badgeText}>{getStatusLabel(item.status)}</Text>
          </View>
        </View>
        <Text style={styles.amount}>R$ {item.amount?.toFixed(2)}</Text>
        <Text style={styles.dueDate}>Vencimento: {formatDate(item.dueDate)}</Text>
        {canPay && (
          <View style={styles.payButton}>
            <Text style={styles.payButtonText}>Pagar</Text>
          </View>
        )}
        {isPaid && item.paymentDate && (
          <Text style={styles.paidText}>Pago em {formatDate(item.paymentDate)}</Text>
        )}
      </TouchableOpacity>
    );
  };

  // Sanitiza o contrato para navegacao — remove Timestamps nao-serializaveis
  const toNavContract = (c: any) => ({
    ...c,
    createdAt: null,
    updatedAt: null,
    cancelledAt: null,
    // pausedAt: preservar truthiness para o badge de "Pausado"
    pausedAt: c.pausedAt ? (c.pausedAt.toDate?.()?.toISOString?.() ?? true) : null,
  });

  const renderContractBanner = () => {
    if (!activeContract) return null;
    return (
      <TouchableOpacity
        style={styles.contractBanner}
        onPress={() => navigation.navigate('ContractDetails', {
          contractId: activeContract.id,
          contract: toNavContract(activeContract),
          readOnly: true,
        })}
        activeOpacity={0.8}
      >
        <View style={styles.contractBannerLeft}>
          <Text style={styles.contractBannerTitle}>Meu Contrato</Text>
          <Text style={styles.contractBannerSub}>
            {activeContract.carInfo} · {FREQUENCY_LABELS[activeContract.frequency] || activeContract.frequency}
          </Text>
        </View>
        <Text style={styles.contractBannerArrow}>›</Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Meus Pagamentos</Text>
      </View>
      <FlatList
        data={charges}
        keyExtractor={(item) => item.id}
        renderItem={renderCharge}
        ListHeaderComponent={renderContractBanner}
        contentContainerStyle={styles.listContent}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          loadingMore
            ? <ActivityIndicator size="small" color="#4F46E5" style={{ marginVertical: 16 }} />
            : null
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4F46E5']} />}
        ListEmptyComponent={
          <Text style={styles.emptyText}>Nenhum pagamento encontrado</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 16,
    elevation: 2,
  },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#1F2937' },
  listContent: { padding: 16 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyText: { fontSize: 16, color: '#6B7280', textAlign: 'center' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  carInfo: { fontSize: 16, fontWeight: '600', color: '#1F2937', flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  amount: { fontSize: 22, fontWeight: 'bold', color: '#1F2937', marginBottom: 4 },
  dueDate: { fontSize: 14, color: '#6B7280', marginBottom: 12 },
  payButton: {
    backgroundColor: '#4F46E5',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  payButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  paidText: { fontSize: 14, color: '#059669', fontStyle: 'italic' },
  contractBanner: {
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  contractBannerLeft: { flex: 1 },
  contractBannerTitle: { fontSize: 14, fontWeight: '700', color: '#4F46E5', marginBottom: 2 },
  contractBannerSub: { fontSize: 13, color: '#6366F1' },
  contractBannerArrow: { fontSize: 24, color: '#4F46E5', marginLeft: 8 },
});
