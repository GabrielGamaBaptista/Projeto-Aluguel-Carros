import React, { useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useFinancialData } from './FinancialDataContext';
import { EXPENSE_CATEGORIES, getSubcategoryLabel } from '../../constants/expenseCategories';
import expenseService from '../../services/expenseService';

const CATEGORY_FILTER_OPTIONS = [
  { key: 'TODOS', label: 'Todas' },
  { key: 'documentacao', label: 'Documentacao' },
  { key: 'manutencao', label: 'Manutencao' },
  { key: 'seguro', label: 'Seguro' },
];

const formatCurrency = (value: number) => {
  if (value == null || isNaN(value)) return 'R$ 0,00';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
};

export default function DespesasTab() {
  const navigation = useNavigation<any>();
  const { expenses, loading, refreshing, refresh, error } = useFinancialData();
  const [selectedCar, setSelectedCar] = useState('TODOS');
  const [selectedCategory, setSelectedCategory] = useState('TODOS');

  const carOptions = useMemo(() => {
    const unique = [...new Set(expenses.map(e => e.carInfo).filter(Boolean))];
    return unique;
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    return expenses
      .filter(e => {
        const carMatch = selectedCar === 'TODOS' || e.carInfo === selectedCar;
        const catMatch = selectedCategory === 'TODOS' || e.category === selectedCategory;
        return carMatch && catMatch;
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [expenses, selectedCar, selectedCategory]);

  const handleExpensePress = (item: any) => {
    Alert.alert(
      getSubcategoryLabel(item.category, item.subcategory) || EXPENSE_CATEGORIES[item.category as keyof typeof EXPENSE_CATEGORIES]?.label || 'Despesa',
      `Valor: ${formatCurrency(item.amount)}\nData: ${formatDate(item.date)}${item.splitWithTenant ? '\nDividido com locatario' : ''}${item.description ? `\n\n${item.description}` : ''}`,
      [
        { text: 'Fechar', style: 'cancel' },
        {
          text: 'Editar',
          onPress: () => navigation.navigate('AddExpense', {
            carId: item.carId,
            carInfo: item.carInfo,
            tenantId: item.tenantId,
            landlordId: item.landlordId,
            expense: item,
          }),
        },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Confirmar', 'Excluir esta despesa?', [
              { text: 'Cancelar', style: 'cancel' },
              {
                text: 'Excluir',
                style: 'destructive',
                onPress: async () => {
                  const result = await expenseService.deleteExpense(item.id);
                  if (result.success) refresh();
                  else Alert.alert('Erro', result.error || 'Falha ao excluir.');
                },
              },
            ]);
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  const renderItem = ({ item }: { item: any }) => {
    const catInfo = EXPENSE_CATEGORIES[item.category as keyof typeof EXPENSE_CATEGORIES];
    return (
      <TouchableOpacity style={[styles.card, { borderLeftColor: catInfo?.color || '#6B7280' }]} onPress={() => handleExpensePress(item)}>
        <View style={styles.cardHeader}>
          <Text style={styles.amount}>{formatCurrency(item.amount)}</Text>
          {item.splitWithTenant && (
            <View style={styles.splitBadge}>
              <Text style={styles.splitBadgeText}>Dividido</Text>
            </View>
          )}
        </View>
        <Text style={styles.categoryLabel}>{catInfo?.icon} {catInfo?.label}{item.subcategory ? ` - ${getSubcategoryLabel(item.category, item.subcategory)}` : ''}</Text>
        {item.carInfo && <Text style={styles.carInfo}>{item.carInfo}</Text>}
        <Text style={styles.dateText}>{formatDate(item.date)}</Text>
        {item.description && <Text style={styles.description} numberOfLines={1}>{item.description}</Text>}
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
                <Text style={[styles.chipText, selectedCar === car && styles.chipTextActive]} numberOfLines={1}>{car}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Filtro por categoria */}
      <View style={styles.filterSection}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {CATEGORY_FILTER_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.chip, selectedCategory === opt.key && styles.chipActive]}
              onPress={() => setSelectedCategory(opt.key)}
            >
              <Text style={[styles.chipText, selectedCategory === opt.key && styles.chipTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={filteredExpenses}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        onRefresh={refresh}
        refreshing={refreshing}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📊</Text>
            <Text style={styles.emptyTitle}>Nenhuma despesa encontrada</Text>
            <Text style={styles.emptySubtitle}>
              {selectedCar !== 'TODOS' || selectedCategory !== 'TODOS'
                ? 'Tente mudar os filtros'
                : 'Lance despesas nos detalhes de cada carro'}
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
    marginBottom: 12, elevation: 2, borderLeftWidth: 4,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  amount: { fontSize: 18, fontWeight: 'bold', color: '#1F2937' },
  splitBadge: { backgroundColor: '#FEF3C7', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  splitBadgeText: { fontSize: 11, fontWeight: '600', color: '#D97706' },
  categoryLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 4 },
  carInfo: { fontSize: 13, color: '#4F46E5', fontWeight: '600', marginBottom: 4 },
  dateText: { fontSize: 13, color: '#6B7280' },
  description: { fontSize: 12, color: '#9CA3AF', marginTop: 4 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: 'bold', color: '#1F2937', marginBottom: 4 },
  emptySubtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', paddingHorizontal: 16 },
  errorBanner: { backgroundColor: '#FEE2E2', paddingVertical: 10, paddingHorizontal: 16 },
  errorBannerText: { color: '#DC2626', fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
