import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import paymentService from '../services/paymentService';

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

const getChargeOrder = (c: any): number => {
  const isAvulsa = !c.contractId;
  const s = c.status;
  if (s === 'CANCELLED') return 6;
  if (isAvulsa && s === 'OVERDUE') return 0;
  if (isAvulsa && s === 'PENDING') return 1;
  if (!isAvulsa && s === 'OVERDUE') return 2;
  if (!isAvulsa && s === 'PENDING') return 3;
  if (!isAvulsa && (s === 'RECEIVED' || s === 'CONFIRMED')) return 4;
  if (isAvulsa && (s === 'RECEIVED' || s === 'CONFIRMED')) return 5;
  return 7;
};

const sortCharges = (list: any[]) =>
  [...list].sort((a, b) => {
    const orderDiff = getChargeOrder(a) - getChargeOrder(b);
    if (orderDiff !== 0) return orderDiff;
    return (a.dueDate || '').localeCompare(b.dueDate || '');
  });

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

  const loadCharges = useCallback(async () => {
    const result = await paymentService.getTenantCharges();
    if (Array.isArray(result)) {
      setCharges(sortCharges(result));
    }
  }, []);

  useEffect(() => {
    loadCharges().finally(() => setLoading(false));
  }, [loadCharges]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadCharges();
    setRefreshing(false);
  }, [loadCharges]);

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
        contentContainerStyle={charges.length === 0 ? styles.emptyContainer : styles.listContent}
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
});
