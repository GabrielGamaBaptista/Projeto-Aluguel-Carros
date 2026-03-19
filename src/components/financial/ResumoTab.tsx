import React, { useState, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, useWindowDimensions, TouchableOpacity, RefreshControl,
} from 'react-native';
import { BarChart } from 'react-native-gifted-charts';
import { useFinancialData } from './FinancialDataContext';
import paymentService from '../../services/paymentService';

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const PERIOD_OPTIONS = [
  { key: 'month', label: 'Mes Atual' },
  { key: '3months', label: 'Trimestre' },
  { key: '6months', label: 'Semestre' },
  { key: 'year', label: 'Ano' },
  { key: 'all', label: 'Todos' },
];

const getNiceYAxis = (maxVal: number) => {
  if (maxVal === 0) return { maxValue: 500, stepValue: 100, noOfSections: 5 };
  const rawStep = maxVal / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  let niceStep: number;
  if (normalized < 1.5) niceStep = 1 * magnitude;
  else if (normalized < 3) niceStep = 2 * magnitude;
  else if (normalized < 7) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;
  const sections = Math.ceil(maxVal / niceStep);
  return { maxValue: sections * niceStep, stepValue: niceStep, noOfSections: sections };
};

const formatCurrency = (value: number) => {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const fmtShort = (n: number): string => {
  if (n === 0) return '';
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(Math.round(n));
};

const getMonthKeysForPeriod = (period: string, charges: any[], expenses: any[]) => {
  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth(); // 0-based

  let count: number;
  switch (period) {
    case 'month': count = 1; break;
    case '3months': count = 3; break;
    case '6months': count = 6; break;
    case 'year': {
      // Ano calendario: Janeiro ate o mes atual
      const keys = [];
      for (let m = 1; m <= nowMonth + 1; m++) {
        keys.push(`${nowYear}-${String(m).padStart(2, '0')}`);
      }
      return keys;
    }
    case 'all': {
      // Derivar do range real dos dados
      let minKey = `${nowYear}-${String(nowMonth + 1).padStart(2, '0')}`;
      let maxKey = minKey;
      const extractKey = (dateStr: string) => {
        if (!dateStr || dateStr.length < 7) return null;
        const parts = dateStr.split('-');
        if (parts.length < 2) return null;
        return `${parts[0]}-${parts[1]}`;
      };
      for (const c of charges) {
        const k = extractKey(c.paymentDate || c.dueDate);
        if (k) { if (k < minKey) minKey = k; if (k > maxKey) maxKey = k; }
      }
      for (const e of expenses) {
        const k = extractKey(e.date);
        if (k) { if (k < minKey) minKey = k; if (k > maxKey) maxKey = k; }
      }
      // Gerar keys de minKey ate maxKey
      const [sY, sM] = minKey.split('-').map(Number);
      const [eY, eM] = maxKey.split('-').map(Number);
      const keys = [];
      let y = sY, m = sM;
      while (y < eY || (y === eY && m <= eM)) {
        keys.push(`${y}-${String(m).padStart(2, '0')}`);
        m++;
        if (m > 12) { m = 1; y++; }
      }
      return keys.length > 0 ? keys : [`${nowYear}-${String(nowMonth + 1).padStart(2, '0')}`];
    }
    default: count = 6;
  }

  const keys = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(nowYear, nowMonth - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
};

// Extrai ano e mes de uma string YYYY-MM-DD sem usar new Date() (evita bugs de timezone)
const getYearMonth = (dateStr: string): { year: number; month: number } | null => {
  if (!dateStr || dateStr.length < 7) return null;
  const parts = dateStr.split('-');
  if (parts.length < 2) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (isNaN(year) || isNaN(month)) return null;
  return { year, month };
};

const isDateInPeriod = (dateStr: string, period: string): boolean => {
  if (period === 'all') return true;
  const ym = getYearMonth(dateStr);
  if (!ym) return false;
  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1; // 1-based para comparar com parsed month

  switch (period) {
    case 'month':
      return ym.year === nowYear && ym.month === nowMonth;
    case '3months': {
      // Mes atual e 2 meses anteriores
      const threeAgoTotal = nowYear * 12 + nowMonth - 2;
      const dateTotal = ym.year * 12 + ym.month;
      return dateTotal >= threeAgoTotal && dateTotal <= nowYear * 12 + nowMonth;
    }
    case '6months': {
      const sixAgoTotal = nowYear * 12 + nowMonth - 5;
      const dateTotal = ym.year * 12 + ym.month;
      return dateTotal >= sixAgoTotal && dateTotal <= nowYear * 12 + nowMonth;
    }
    case 'year':
      return ym.year === nowYear && ym.month <= nowMonth;
    default:
      return true;
  }
};

export default function ResumoTab() {
  const { charges, contracts, expenses, loading, refreshing, refresh } = useFinancialData();
  const { width } = useWindowDimensions();
  const [selectedCar, setSelectedCar] = useState('TODOS');
  const [selectedPeriod, setSelectedPeriod] = useState('all');
  const [selectedBarIdx, setSelectedBarIdx] = useState<number | null>(null);

  // Reset bar selection when filters change
  useEffect(() => {
    setSelectedBarIdx(null);
  }, [selectedPeriod, selectedCar]);

  const carOptions = useMemo(() => {
    const fromCharges = charges.map(c => c.carInfo).filter(Boolean);
    const fromExpenses = expenses.map(e => e.carInfo).filter(Boolean);
    return [...new Set([...fromCharges, ...fromExpenses])];
  }, [charges, expenses]);

  const { filteredCharges, filteredExpenses } = useMemo(() => {
    const fc = charges.filter(c => {
      const carMatch = selectedCar === 'TODOS' || c.carInfo === selectedCar;
      const dateStr = c.paymentDate || c.dueDate;
      const periodMatch = isDateInPeriod(dateStr, selectedPeriod);
      return carMatch && periodMatch;
    });
    const fe = expenses.filter(e => {
      const carMatch = selectedCar === 'TODOS' || e.carInfo === selectedCar;
      const periodMatch = isDateInPeriod(e.date, selectedPeriod);
      return carMatch && periodMatch;
    });
    return { filteredCharges: fc, filteredExpenses: fe };
  }, [charges, expenses, selectedCar, selectedPeriod]);

  const summary = useMemo(() => {
    return paymentService.getDashboardSummary(filteredCharges) as any;
  }, [filteredCharges]);

  const totalExpenses = useMemo(() => {
    return filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  }, [filteredExpenses]);

  const effectiveExpenses = useMemo(() => {
    return filteredExpenses.reduce((sum, e) => {
      return sum + (e.splitWithTenant ? (e.amount || 0) / 2 : (e.amount || 0));
    }, 0);
  }, [filteredExpenses]);

  const lucroLiquido = summary.totalReceived - effectiveExpenses;

  const activeContracts = useMemo(() => contracts.filter(c => {
    if (!c.active) return false;
    if (selectedCar !== 'TODOS' && c.carInfo !== selectedCar) return false;
    return true;
  }).length, [contracts, selectedCar]);

  // Chart data: grouped bars (revenue vs expenses)
  const monthKeys = useMemo(() =>
    getMonthKeysForPeriod(selectedPeriod, filteredCharges, filteredExpenses),
  [selectedPeriod, filteredCharges, filteredExpenses]);

  // Reset bar selection when number of bars changes (e.g. pull-to-refresh on 'all' period adds new months)
  useEffect(() => {
    setSelectedBarIdx(null);
  }, [monthKeys.length]);

  const expensesByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    filteredExpenses.forEach(e => {
      if (!e.date) return;
      const ym = getYearMonth(e.date);
      if (!ym) return;
      const key = `${ym.year}-${String(ym.month).padStart(2, '0')}`;
      map[key] = (map[key] || 0) + (e.splitWithTenant ? (e.amount || 0) / 2 : (e.amount || 0));
    });
    return map;
  }, [filteredExpenses]);

  const chartData = useMemo(() => monthKeys.flatMap((key, mIdx) => {
    const [, month] = key.split('-');
    const revIdx = mIdx * 2;
    const expIdx = mIdx * 2 + 1;
    const revVal = summary.revenueByMonth[key] || 0;
    const expVal = expensesByMonth[key] || 0;
    return [
      {
        value: revVal,
        label: MONTH_LABELS[parseInt(month, 10) - 1],
        labelWidth: 34,
        labelTextStyle: { textAlign: 'center', color: '#6B7280', fontSize: 10 },
        frontColor: selectedBarIdx === revIdx ? '#3730A3' : '#4F46E5',
        spacing: 2,
        onPress: () => setSelectedBarIdx(prev => prev === revIdx ? null : revIdx),
        topLabelComponent: selectedBarIdx === revIdx && revVal > 0
          ? () => <Text style={styles.barLabel} numberOfLines={1}>{fmtShort(revVal)}</Text>
          : undefined,
      },
      {
        value: expVal,
        label: '',
        frontColor: selectedBarIdx === expIdx ? '#B45309' : '#F59E0B',
        spacing: 14,
        onPress: () => setSelectedBarIdx(prev => prev === expIdx ? null : expIdx),
        topLabelComponent: selectedBarIdx === expIdx && expVal > 0
          ? () => <Text style={styles.barLabel} numberOfLines={1}>{fmtShort(expVal)}</Text>
          : undefined,
      },
    ];
  }), [monthKeys, summary.revenueByMonth, expensesByMonth, selectedBarIdx]);

  const hasChartData = chartData.some(d => d.value > 0);
  const maxChartVal = chartData.length > 0 ? Math.max(...chartData.map(d => d.value)) : 0;
  const yAxis = getNiceYAxis(maxChartVal);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={['#4F46E5']} />}
    >
      {/* Filtro por carro */}
      {carOptions.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} style={styles.filterScroll}>
          <TouchableOpacity
            style={[styles.filterChip, selectedCar === 'TODOS' && styles.filterChipActive]}
            onPress={() => setSelectedCar('TODOS')}
          >
            <Text style={[styles.filterChipText, selectedCar === 'TODOS' && styles.filterChipTextActive]}>Todos</Text>
          </TouchableOpacity>
          {carOptions.map(car => (
            <TouchableOpacity
              key={car}
              style={[styles.filterChip, selectedCar === car && styles.filterChipActive]}
              onPress={() => setSelectedCar(car)}
            >
              <Text style={[styles.filterChipText, selectedCar === car && styles.filterChipTextActive]} numberOfLines={1}>{car}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Filtro por periodo */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} style={styles.filterScroll}>
        {PERIOD_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.key}
            style={[styles.filterChip, selectedPeriod === opt.key && styles.filterChipActive]}
            onPress={() => setSelectedPeriod(opt.key)}
          >
            <Text style={[styles.filterChipText, selectedPeriod === opt.key && styles.filterChipTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Cards de resumo */}
      <View style={styles.cardsGrid}>
        <View style={[styles.summaryCard, styles.cardReceived]}>
          <Text style={styles.cardLabel}>Recebido</Text>
          <Text style={[styles.cardValue, { color: '#059669' }]} numberOfLines={1}>{formatCurrency(summary.totalReceived)}</Text>
          <Text style={styles.cardCount}>{summary.countReceived} cobranca{summary.countReceived !== 1 ? 's' : ''}</Text>
        </View>
        <View style={[styles.summaryCard, styles.cardPending]}>
          <Text style={styles.cardLabel}>Pendente</Text>
          <Text style={[styles.cardValue, { color: '#6B7280' }]} numberOfLines={1}>{formatCurrency(summary.totalPending)}</Text>
          <Text style={styles.cardCount}>{summary.countPending} cobranca{summary.countPending !== 1 ? 's' : ''}</Text>
        </View>
        <View style={[styles.summaryCard, styles.cardOverdue]}>
          <Text style={styles.cardLabel}>Atrasado</Text>
          <Text style={[styles.cardValue, { color: '#DC2626' }]} numberOfLines={1}>{formatCurrency(summary.totalOverdue)}</Text>
          <Text style={styles.cardCount}>{summary.countOverdue} cobranca{summary.countOverdue !== 1 ? 's' : ''}</Text>
        </View>
        <View style={[styles.summaryCard, styles.cardContracts]}>
          <Text style={styles.cardLabel}>Contratos Ativos</Text>
          <Text style={[styles.cardValue, { color: '#4F46E5' }]} numberOfLines={1}>{activeContracts}</Text>
          <Text style={styles.cardCount}>contrato{activeContracts !== 1 ? 's' : ''}</Text>
        </View>
        <View style={[styles.summaryCard, styles.cardExpenses]}>
          <Text style={styles.cardLabel}>Despesas</Text>
          <Text style={[styles.cardValue, { color: '#D97706' }]} numberOfLines={1}>{formatCurrency(totalExpenses)}</Text>
          <Text style={styles.cardCount}>{filteredExpenses.length} despesa{filteredExpenses.length !== 1 ? 's' : ''}</Text>
        </View>
        <View style={[styles.summaryCard, lucroLiquido >= 0 ? styles.cardProfit : styles.cardLoss]}>
          <Text style={styles.cardLabel}>Lucro Liquido</Text>
          <Text style={[styles.cardValue, { color: lucroLiquido >= 0 ? '#059669' : '#DC2626' }]} numberOfLines={1}>
            {formatCurrency(lucroLiquido)}
          </Text>
          <Text style={styles.cardCount}>receita - despesas efetivas</Text>
        </View>
      </View>

      {/* Grafico receita vs despesas */}
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>Receita vs Despesas{selectedPeriod === 'month' ? ' - Mes Atual' : selectedPeriod === '3months' ? ' - Trimestre' : selectedPeriod === '6months' ? ' - Semestre' : selectedPeriod === 'year' ? ' - Ano' : ''}</Text>
        {hasChartData ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled contentContainerStyle={{ paddingRight: 16 }}>
            <BarChart
              key={`${selectedPeriod}-${selectedCar}-${monthKeys.length}`}
              data={chartData}
              barWidth={16}
              spacing={2}
              roundedTop
              maxValue={yAxis.maxValue}
              stepValue={yAxis.stepValue}
              noOfSections={yAxis.noOfSections}
              formatYLabel={(val) => {
                const n = Number(val);
                if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
                return String(n);
              }}
              yAxisTextStyle={{ color: '#9CA3AF', fontSize: 10 }}
              xAxisLabelTextStyle={{ color: '#6B7280', fontSize: 10 }}
              hideRules={false}
              rulesColor="#F3F4F6"
              yAxisThickness={0}
              xAxisThickness={1}
              xAxisColor="#E5E7EB"
              width={Math.max(monthKeys.length * 48 + 45, width - 80)}
            />
            </ScrollView>
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#4F46E5' }]} />
                <Text style={styles.legendText}>Receita</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} />
                <Text style={styles.legendText}>Despesas</Text>
              </View>
            </View>
          </>
        ) : (
          <View style={styles.emptyChart}>
            <Text style={styles.emptyChartText}>Nenhum dado registrado ainda</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  content: { padding: 16, paddingBottom: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  filterScroll: { marginBottom: 8 },
  filterRow: { gap: 8 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB',
  },
  filterChipActive: { backgroundColor: '#EEF2FF', borderColor: '#4F46E5' },
  filterChipText: { fontSize: 12, color: '#6B7280', fontWeight: '500' },
  filterChipTextActive: { color: '#4F46E5', fontWeight: '700' },
  cardsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  summaryCard: {
    flexBasis: '47%', flexGrow: 1, backgroundColor: '#fff', borderRadius: 12,
    padding: 16, elevation: 2,
  },
  cardReceived: { borderLeftWidth: 4, borderLeftColor: '#059669' },
  cardPending: { borderLeftWidth: 4, borderLeftColor: '#9CA3AF' },
  cardOverdue: { borderLeftWidth: 4, borderLeftColor: '#DC2626' },
  cardContracts: { borderLeftWidth: 4, borderLeftColor: '#4F46E5' },
  cardExpenses: { borderLeftWidth: 4, borderLeftColor: '#F59E0B' },
  cardProfit: { borderLeftWidth: 4, borderLeftColor: '#059669' },
  cardLoss: { borderLeftWidth: 4, borderLeftColor: '#DC2626' },
  cardLabel: { fontSize: 12, color: '#6B7280', fontWeight: '600', marginBottom: 6, textTransform: 'uppercase' },
  cardValue: { fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  cardCount: { fontSize: 11, color: '#9CA3AF' },
  chartCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 2,
  },
  chartTitle: { fontSize: 15, fontWeight: '700', color: '#1F2937', marginBottom: 16 },
  emptyChart: { alignItems: 'center', paddingVertical: 32 },
  emptyChartText: { fontSize: 14, color: '#9CA3AF' },
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { fontSize: 12, color: '#6B7280', fontWeight: '600' },
  barLabel: { fontSize: 9, fontWeight: '700', color: '#374151', textAlign: 'center' },
});
