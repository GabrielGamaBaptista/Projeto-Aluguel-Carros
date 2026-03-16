import React, { useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MdiCash } from '../icons/MdiIcons';
import { useFinancialData } from './FinancialDataContext';

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  PENDING:   { bg: '#F3F4F6', text: '#6B7280', label: 'Pendente' },
  CONFIRMED: { bg: '#DBEAFE', text: '#1D4ED8', label: 'Confirmado' },
  RECEIVED:  { bg: '#D1FAE5', text: '#059669', label: 'Recebido' },
  OVERDUE:   { bg: '#FEE2E2', text: '#DC2626', label: 'Atrasado' },
  REFUNDED:  { bg: '#FEF3C7', text: '#D97706', label: 'Estornado' },
  CANCELLED: { bg: '#F3F4F6', text: '#9CA3AF', label: 'Cancelado' },
};

const BILLING_LABELS: Record<string, string> = {
  PIX: 'PIX',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartao',
};

const STATUS_FILTER_OPTIONS = [
  { key: 'TODOS', label: 'Todos' },
  { key: 'PENDING', label: 'Pendente' },
  { key: 'OVERDUE', label: 'Atrasado' },
  { key: 'RECEIVED', label: 'Recebido' },
  { key: 'CANCELLED', label: 'Cancelado' },
];

const formatCurrency = (value: number) =>
  value?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || 'R$ 0,00';

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
};

const STATUS_ORDER: Record<string, number> = {
  OVERDUE: 0,
  PENDING: 1,
  CONFIRMED: 2,
  RECEIVED: 3,
  REFUNDED: 4,
  CANCELLED: 5,
};

export default function CobrancasTab() {
  const navigation = useNavigation<any>();
  const { charges, loading, refreshing, refresh, error, selectedCar, setSelectedCar, selectedStatus, setSelectedStatus } = useFinancialData();

  const carOptions = useMemo(() => {
    const unique = [...new Set(charges.map(c => c.carInfo).filter(Boolean))];
    return unique;
  }, [charges]);

  const filteredCharges = useMemo(() => {
    return charges
      .filter(c => {
        const carMatch = selectedCar === 'TODOS' || c.carInfo === selectedCar;
        const statusMatch = selectedStatus === 'TODOS' || c.status === selectedStatus;
        return carMatch && statusMatch;
      })
      .sort((a, b) => {
        const orderDiff = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
        if (orderDiff !== 0) return orderDiff;
        return (a.dueDate || '').localeCompare(b.dueDate || '');
      });
  }, [charges, selectedCar, selectedStatus]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  const renderItem = ({ item }: { item: any }) => {
    const statusInfo = STATUS_COLORS[item.status] || STATUS_COLORS.PENDING;
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('PaymentDetails', { chargeId: item.id, charge: item })}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.amount}>{formatCurrency(item.amount)}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
            <Text style={[styles.statusText, { color: statusInfo.text }]}>{statusInfo.label}</Text>
          </View>
        </View>

        {item.carInfo ? <Text style={styles.carInfo}>{item.carInfo}</Text> : null}

        <View style={styles.detailsRow}>
          <Text style={styles.detail}>Venc. {formatDate(item.dueDate)}</Text>
          <Text style={styles.separator}> · </Text>
          <Text style={styles.detail}>{BILLING_LABELS[item.billingType] || item.billingType}</Text>
          {item.paymentDate ? (
            <>
              <Text style={styles.separator}> · </Text>
              <Text style={[styles.detail, { color: '#059669' }]}>Pago {formatDate(item.paymentDate)}</Text>
            </>
          ) : null}
        </View>

        {item.description ? (
          <Text style={styles.description} numberOfLines={1}>{item.description}</Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>Falha ao carregar dados. Puxe para atualizar.</Text>
        </View>
      ) : null}
      {/* Filtro por carro */}
      {carOptions.length > 0 && (
        <View style={styles.filterSection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            <TouchableOpacity
              style={[styles.chip, selectedCar === 'TODOS' && styles.chipActive]}
              onPress={() => setSelectedCar('TODOS')}
            >
              <Text style={[styles.chipText, selectedCar === 'TODOS' && styles.chipTextActive]}>Todos</Text>
            </TouchableOpacity>
            {carOptions.map(car => (
              <TouchableOpacity
                key={car}
                style={[styles.chip, selectedCar === car && styles.chipActive]}
                onPress={() => setSelectedCar(car)}
              >
                <Text style={[styles.chipText, selectedCar === car && styles.chipTextActive]} numberOfLines={1}>
                  {car}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Filtro por status */}
      <View style={styles.filterSection}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {STATUS_FILTER_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.chip, selectedStatus === opt.key && styles.chipActive]}
              onPress={() => setSelectedStatus(opt.key)}
            >
              <Text style={[styles.chipText, selectedStatus === opt.key && styles.chipTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={filteredCharges}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        onRefresh={refresh}
        refreshing={refreshing}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MdiCash size={48} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>Nenhuma cobranca encontrada</Text>
            <Text style={styles.emptySubtitle}>
              {selectedCar !== 'TODOS' || selectedStatus !== 'TODOS'
                ? 'Tente mudar os filtros'
                : 'As cobranças geradas aparecerao aqui'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  filterSection: { backgroundColor: '#fff', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  chipsRow: { paddingHorizontal: 12, gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB',
  },
  chipActive: { backgroundColor: '#EEF2FF', borderColor: '#4F46E5' },
  chipText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  chipTextActive: { color: '#4F46E5', fontWeight: '700' },
  list: { padding: 16, paddingBottom: 32 },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    marginBottom: 12, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  amount: { fontSize: 18, fontWeight: 'bold', color: '#1F2937' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  statusText: { fontSize: 12, fontWeight: '600' },
  carInfo: { fontSize: 13, color: '#4F46E5', fontWeight: '600', marginBottom: 6 },
  detailsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  detail: { fontSize: 13, color: '#6B7280' },
  separator: { color: '#D1D5DB' },
  description: { fontSize: 12, color: '#9CA3AF', marginTop: 6 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: 'bold', color: '#1F2937', marginBottom: 4 },
  emptySubtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', paddingHorizontal: 16 },
  errorBanner: { backgroundColor: '#FEE2E2', paddingVertical: 10, paddingHorizontal: 16 },
  errorBannerText: { color: '#DC2626', fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
