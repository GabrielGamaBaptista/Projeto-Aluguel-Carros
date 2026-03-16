import React, { useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AlertTriangle, FileText } from 'lucide-react-native';
import { useFinancialData } from './FinancialDataContext';

const FREQUENCY_LABELS: Record<string, string> = {
  MONTHLY: 'Mensal',
  BIWEEKLY: 'Quinzenal',
  WEEKLY: 'Semanal',
};

const BILLING_LABELS: Record<string, string> = {
  PIX: 'PIX',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartao',
};

const formatCurrency = (value: number) =>
  value?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || 'R$ 0,00';

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
};

export default function ContratosTab() {
  const navigation = useNavigation<any>();
  const { contracts, getNextPendingForContract, loading, refreshing, refresh, error } = useFinancialData();

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  const renderItem = useCallback(({ item }: { item: any }) => {
    const nextPending = getNextPendingForContract(item.id);
    const displayDate = nextPending?.dueDate || item.nextDueDate;
    return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('ContractDetails', {
        contractId: item.id,
        contract: {
          carId: item.carId,
          landlordId: item.landlordId,
          tenantId: item.tenantId,
          carInfo: item.carInfo,
          tenantName: item.tenantName,
          rentAmount: item.rentAmount,
          frequency: item.frequency,
          billingType: item.billingType,
          startDate: item.startDate,
          nextDueDate: item.nextDueDate,
          dayOfMonth: item.dayOfMonth || null,
          active: item.active,
          nextChargeOverride: item.nextChargeOverride
            ? { amount: item.nextChargeOverride.amount }
            : null,
        },
      })}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.carInfo}>{item.carInfo}</Text>
        <View style={[styles.badge, item.active ? styles.badgeActive : styles.badgeInactive]}>
          <Text style={[styles.badgeText, item.active ? styles.badgeActiveText : styles.badgeInactiveText]}>
            {item.active ? 'Ativo' : 'Inativo'}
          </Text>
        </View>
      </View>

      <Text style={styles.tenantName}>{item.tenantName}</Text>

      <View style={styles.infoRow}>
        <Text style={styles.amount}>{formatCurrency(item.rentAmount)}</Text>
        <Text style={styles.separator}> · </Text>
        <Text style={styles.detail}>{FREQUENCY_LABELS[item.frequency] || item.frequency}</Text>
        <Text style={styles.separator}> · </Text>
        <Text style={styles.detail}>{BILLING_LABELS[item.billingType] || item.billingType}</Text>
      </View>

      {item.active && displayDate ? (
        <Text style={styles.nextDue}>Proxima cobranca: {formatDate(displayDate)}</Text>
      ) : item.startDate ? (
        <Text style={styles.startDate}>Inicio: {formatDate(item.startDate)}</Text>
      ) : null}

      {item.lastRecurringError ? (
        <TouchableOpacity
          style={styles.errorRow}
          onPress={() => Alert.alert(
            'Erro na cobranca automatica',
            `${item.lastRecurringError}\n\n${item.lastRecurringErrorAt ? `Ocorrido em: ${formatDate(item.lastRecurringErrorAt?.toDate?.()?.toISOString?.()?.split('T')[0] || '')}` : ''}`,
          )}
        >
          <AlertTriangle size={14} color="#F59E0B" style={{ marginRight: 6 }} />
          <Text style={styles.errorRowText}>Erro na cobranca automatica — toque para ver</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={styles.tapHint}>Ver detalhes →</Text>
    </TouchableOpacity>
    );
  }, [contracts, getNextPendingForContract, navigation]);

  return (
    <>
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>Falha ao carregar dados. Puxe para atualizar.</Text>
        </View>
      ) : null}
    <FlatList
      data={contracts}
      keyExtractor={item => item.id}
      renderItem={renderItem}
      contentContainerStyle={styles.list}
      onRefresh={refresh}
      refreshing={refreshing}
      ListEmptyComponent={
        <View style={styles.empty}>
          <FileText size={48} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>Nenhum contrato encontrado</Text>
          <Text style={styles.emptySubtitle}>Configure o pagamento em um carro com locatario atribuido</Text>
        </View>
      }
    />
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, paddingBottom: 32 },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    marginBottom: 12, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  carInfo: { fontSize: 15, fontWeight: '700', color: '#1F2937', flex: 1, marginRight: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  badgeActive: { backgroundColor: '#D1FAE5' },
  badgeInactive: { backgroundColor: '#F3F4F6' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  badgeActiveText: { color: '#059669' },
  badgeInactiveText: { color: '#9CA3AF' },
  tenantName: { fontSize: 13, color: '#6B7280', marginBottom: 8 },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  amount: { fontSize: 16, fontWeight: 'bold', color: '#1F2937' },
  separator: { color: '#D1D5DB' },
  detail: { fontSize: 13, color: '#6B7280' },
  nextDue: { fontSize: 12, color: '#4F46E5', fontWeight: '600', marginBottom: 4 },
  startDate: { fontSize: 12, color: '#9CA3AF', marginBottom: 4 },
  tapHint: { fontSize: 12, color: '#4F46E5', fontWeight: '600', marginTop: 4 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: 'bold', color: '#1F2937', marginBottom: 4 },
  emptySubtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', paddingHorizontal: 16 },
  errorRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7', borderRadius: 8, padding: 8, marginTop: 8 },
  errorIcon: { fontSize: 14, marginRight: 6 },
  errorRowText: { fontSize: 12, color: '#92400E', fontWeight: '600', flex: 1 },
  errorBanner: { backgroundColor: '#FEE2E2', paddingVertical: 10, paddingHorizontal: 16 },
  errorBannerText: { color: '#DC2626', fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
