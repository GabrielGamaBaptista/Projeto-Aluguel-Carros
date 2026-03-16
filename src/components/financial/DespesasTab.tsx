import React, { useMemo, useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { FileText, Wrench, Shield, BarChart3, X, Pencil, Trash2, Calendar, Car, SplitSquareHorizontal } from 'lucide-react-native';
import { useFinancialData } from './FinancialDataContext';
import { EXPENSE_CATEGORIES, getSubcategoryLabel } from '../../constants/expenseCategories';
import expenseService from '../../services/expenseService';

const CATEGORY_ICONS: Record<string, React.ComponentType<any>> = {
  FileText, Wrench, Shield,
};

const CATEGORY_FILTER_OPTIONS = [
  { key: 'TODOS', label: 'Todas' },
  { key: 'documentacao', label: 'Documentacao' },
  { key: 'manutencao', label: 'Manutencao' },
  { key: 'seguro', label: 'Seguro' },
];

const PERIOD_OPTIONS = [
  { key: 'all', label: 'Todo' },
  { key: 'month', label: 'Mes Atual' },
  { key: 'quarter', label: 'Trimestre' },
  { key: 'semester', label: 'Semestre' },
  { key: 'year', label: 'Ano' },
];

const isDateInPeriod = (dateStr: string, period: string, now: Date): boolean => {
  if (period === 'all') return true;
  if (!dateStr) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  switch (period) {
    case 'month':
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    case 'quarter': {
      const diff = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
      return diff >= 0 && diff < 3;
    }
    case 'semester': {
      const diff = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
      return diff >= 0 && diff < 6;
    }
    case 'year':
      return date.getFullYear() === now.getFullYear();
    default:
      return true;
  }
};

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
  const [selectedPeriod, setSelectedPeriod] = useState('all');
  const [selectedExpense, setSelectedExpense] = useState<any>(null);

  useEffect(() => {
    if (selectedCategory === 'TODOS') {
      setSelectedPeriod('all');
    }
  }, [selectedCategory]);

  const carOptions = useMemo(() => {
    const unique = [...new Set(expenses.map(e => e.carInfo).filter(Boolean))];
    return unique;
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    const now = new Date();
    return expenses
      .filter(e => {
        const carMatch = selectedCar === 'TODOS' || e.carInfo === selectedCar;
        const catMatch = selectedCategory === 'TODOS' || e.category === selectedCategory;
        const periodMatch = selectedCategory === 'TODOS' || isDateInPeriod(e.date, selectedPeriod, now);
        return carMatch && catMatch && periodMatch;
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [expenses, selectedCar, selectedCategory, selectedPeriod]);

  const categoryTotal = useMemo(() => {
    if (selectedCategory === 'TODOS') return null;
    return filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  }, [filteredExpenses, selectedCategory]);

  const handleEdit = (item: any) => {
    setSelectedExpense(null);
    setTimeout(() => {
      navigation.navigate('AddExpense', {
        carId: item.carId,
        carInfo: item.carInfo,
        tenantId: item.tenantId,
        landlordId: item.landlordId,
        expense: item,
      });
    }, 300);
  };

  const handleDelete = (item: any) => {
    Alert.alert('Confirmar', 'Excluir esta despesa?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          setSelectedExpense(null);
          const result = await expenseService.deleteExpense(item.id);
          if (result.success) refresh();
          else Alert.alert('Erro', result.error || 'Falha ao excluir.');
        },
      },
    ]);
  };

  const selectedCatInfo = selectedCategory !== 'TODOS'
    ? EXPENSE_CATEGORIES[selectedCategory as keyof typeof EXPENSE_CATEGORIES]
    : null;
  const selectedCatLabel = CATEGORY_FILTER_OPTIONS.find(o => o.key === selectedCategory)?.label || selectedCategory;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  const renderDetailModal = () => {
    if (!selectedExpense) return null;
    const item = selectedExpense;
    const catInfo = EXPENSE_CATEGORIES[item.category as keyof typeof EXPENSE_CATEGORIES];
    const subcatLabel = getSubcategoryLabel(item.category, item.subcategory);
    const IconComp = catInfo?.icon ? CATEGORY_ICONS[catInfo.icon] : null;

    return (
      <Modal visible animationType="slide" transparent onRequestClose={() => setSelectedExpense(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Detalhes da Despesa</Text>
              <TouchableOpacity onPress={() => setSelectedExpense(null)} style={styles.modalClose}>
                <X size={22} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent} showsVerticalScrollIndicator={false}>
              {/* Valor destaque */}
              <View style={[styles.detailAmountCard, { borderLeftColor: catInfo?.color || '#6B7280' }]}>
                <Text style={styles.detailAmountLabel}>Valor</Text>
                <Text style={styles.detailAmountValue}>{formatCurrency(item.amount)}</Text>
                {item.splitWithTenant && (
                  <View style={styles.detailSplitRow}>
                    <SplitSquareHorizontal size={14} color="#D97706" />
                    <Text style={styles.detailSplitText}>Dividido com locatario (50%)</Text>
                  </View>
                )}
              </View>

              {/* Categoria */}
              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>Categoria</Text>
                <View style={styles.detailCatRow}>
                  {IconComp && <IconComp size={20} color={catInfo?.color || '#6B7280'} />}
                  <Text style={[styles.detailCatText, { color: catInfo?.color || '#374151' }]}>{catInfo?.label || item.category}</Text>
                </View>
              </View>

              {/* Subcategoria */}
              {subcatLabel && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>Subcategoria</Text>
                  <Text style={styles.detailText}>{subcatLabel}</Text>
                </View>
              )}

              {/* Veiculo */}
              {item.carInfo && (
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>Veiculo</Text>
                  <View style={styles.detailIconRow}>
                    <Car size={16} color="#4F46E5" />
                    <Text style={[styles.detailText, { color: '#4F46E5', fontWeight: '600' }]}>{item.carInfo}</Text>
                  </View>
                </View>
              )}

              {/* Data */}
              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>Data</Text>
                <View style={styles.detailIconRow}>
                  <Calendar size={16} color="#6B7280" />
                  <Text style={styles.detailText}>{formatDate(item.date)}</Text>
                </View>
              </View>

              {/* Descricao manutencao */}
              {item.maintenanceDescription ? (
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>Descricao do Servico</Text>
                  <View style={styles.detailTextBox}>
                    <Text style={styles.detailTextBoxContent}>{item.maintenanceDescription}</Text>
                  </View>
                </View>
              ) : null}

              {/* Observacoes */}
              {item.description ? (
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>Observacoes</Text>
                  <View style={styles.detailTextBox}>
                    <Text style={styles.detailTextBoxContent}>{item.description}</Text>
                  </View>
                </View>
              ) : null}
            </ScrollView>

            {/* Footer actions */}
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.footerBtnEdit} onPress={() => handleEdit(item)}>
                <Pencil size={18} color="#fff" />
                <Text style={styles.footerBtnEditText}>Editar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.footerBtnDelete} onPress={() => handleDelete(item)}>
                <Trash2 size={18} color="#DC2626" />
                <Text style={styles.footerBtnDeleteText}>Excluir</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  const renderItem = ({ item }: { item: any }) => {
    const catInfo = EXPENSE_CATEGORIES[item.category as keyof typeof EXPENSE_CATEGORIES];
    return (
      <TouchableOpacity style={[styles.card, { borderLeftColor: catInfo?.color || '#6B7280' }]} onPress={() => setSelectedExpense(item)}>
        <View style={styles.cardHeader}>
          <Text style={styles.amount}>{formatCurrency(item.amount)}</Text>
          {item.splitWithTenant && (
            <View style={styles.splitBadge}>
              <Text style={styles.splitBadgeText}>Dividido</Text>
            </View>
          )}
        </View>
        <View style={styles.categoryRow}>
          {catInfo?.icon && CATEGORY_ICONS[catInfo.icon] && React.createElement(CATEGORY_ICONS[catInfo.icon], { size: 16, color: catInfo.color || '#6B7280' })}
          <Text style={styles.categoryLabel}>{catInfo?.label}{item.subcategory ? ` - ${getSubcategoryLabel(item.category, item.subcategory)}` : ''}</Text>
        </View>
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

      {/* Card de total por categoria com subfiltro de periodo */}
      {selectedCategory !== 'TODOS' && categoryTotal !== null && (
        <View style={[styles.totalCard, { borderLeftColor: selectedCatInfo?.color || '#6B7280' }]}>
          <Text style={styles.totalCardTitle}>Total em {selectedCatLabel}</Text>
          <Text style={styles.totalCardAmount}>{formatCurrency(categoryTotal)}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodChipsRow}>
            {PERIOD_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.periodChip, selectedPeriod === opt.key && styles.periodChipActive]}
                onPress={() => setSelectedPeriod(opt.key)}
              >
                <Text style={[styles.periodChipText, selectedPeriod === opt.key && styles.periodChipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <FlatList
        data={filteredExpenses}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        onRefresh={refresh}
        refreshing={refreshing}
        ListEmptyComponent={
          <View style={styles.empty}>
            <BarChart3 size={48} color="#9CA3AF" style={{ marginBottom: 12 }} />
            <Text style={styles.emptyTitle}>Nenhuma despesa encontrada</Text>
            <Text style={styles.emptySubtitle}>
              {selectedCar !== 'TODOS' || selectedCategory !== 'TODOS'
                ? 'Tente mudar os filtros'
                : 'Lance despesas nos detalhes de cada carro'}
            </Text>
          </View>
        }
      />

      {renderDetailModal()}
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
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  categoryLabel: { fontSize: 14, fontWeight: '600', color: '#374151' },
  carInfo: { fontSize: 13, color: '#4F46E5', fontWeight: '600', marginBottom: 4 },
  dateText: { fontSize: 13, color: '#6B7280' },
  description: { fontSize: 12, color: '#9CA3AF', marginTop: 4 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 17, fontWeight: 'bold', color: '#1F2937', marginBottom: 4 },
  emptySubtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', paddingHorizontal: 16 },
  errorBanner: { backgroundColor: '#FEE2E2', paddingVertical: 10, paddingHorizontal: 16 },
  errorBannerText: { color: '#DC2626', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  totalCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    marginHorizontal: 16, marginTop: 8, marginBottom: 4,
    elevation: 2, borderLeftWidth: 4,
  },
  totalCardTitle: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginBottom: 4 },
  totalCardAmount: { fontSize: 24, fontWeight: 'bold', color: '#1F2937', marginBottom: 12 },
  periodChipsRow: { paddingHorizontal: 0, gap: 6 },
  periodChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14,
    backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB',
  },
  periodChipActive: { backgroundColor: '#EEF2FF', borderColor: '#4F46E5' },
  periodChipText: { fontSize: 11, color: '#6B7280', fontWeight: '500' },
  periodChipTextActive: { color: '#4F46E5', fontWeight: '700' },

  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContainer: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, height: '80%' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937' },
  modalClose: { padding: 4 },
  modalBody: { flex: 1 },
  modalBodyContent: { padding: 20 },
  modalFooter: {
    flexDirection: 'row', gap: 12, padding: 20, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: '#F3F4F6',
  },

  // Detail content
  detailAmountCard: {
    backgroundColor: '#F9FAFB', borderRadius: 12, padding: 16,
    marginBottom: 20, borderLeftWidth: 4,
  },
  detailAmountLabel: { fontSize: 13, color: '#6B7280', marginBottom: 4 },
  detailAmountValue: { fontSize: 28, fontWeight: 'bold', color: '#1F2937' },
  detailSplitRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  detailSplitText: { fontSize: 13, color: '#D97706', fontWeight: '600' },
  detailSection: { marginBottom: 16 },
  detailSectionTitle: { fontSize: 12, fontWeight: '600', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  detailCatRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailCatText: { fontSize: 16, fontWeight: '700' },
  detailIconRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailText: { fontSize: 15, color: '#374151' },
  detailTextBox: {
    backgroundColor: '#F9FAFB', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  detailTextBoxContent: { fontSize: 15, color: '#374151', lineHeight: 22 },

  // Footer buttons
  footerBtnEdit: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#4F46E5', paddingVertical: 14, borderRadius: 12,
  },
  footerBtnEditText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  footerBtnDelete: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FEE2E2', paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12,
  },
  footerBtnDeleteText: { fontSize: 15, fontWeight: '700', color: '#DC2626' },
});
