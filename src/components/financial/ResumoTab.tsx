import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { BarChart } from 'react-native-gifted-charts';
import { useFinancialData } from './FinancialDataContext';
import paymentService from '../../services/paymentService';

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// Calcula escala Y com valores "redondos" (ex: 0, 100, 200, 300)
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

const getLast6MonthsKeys = () => {
  const keys = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
};

export default function ResumoTab() {
  const { charges, contracts, loading } = useFinancialData();
  const [summary, setSummary] = useState<any>(null);
  const { width } = useWindowDimensions();

  useEffect(() => {
    const s = paymentService.getDashboardSummary(charges);
    setSummary(s);
  }, [charges]);

  if (loading || !summary) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  const activeContracts = contracts.filter(c => c.active).length;

  const monthKeys = getLast6MonthsKeys();
  const chartData = monthKeys.map(key => {
    const [year, month] = key.split('-');
    return {
      value: summary.revenueByMonth[key] || 0,
      label: MONTH_LABELS[parseInt(month, 10) - 1],
      frontColor: '#4F46E5',
    };
  });

  const hasChartData = chartData.some(d => d.value > 0);
  const maxChartVal = Math.max(...chartData.map(d => d.value));
  const yAxis = getNiceYAxis(maxChartVal);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Cards de resumo */}
      <View style={styles.cardsGrid}>
        <View style={[styles.summaryCard, styles.cardReceived]}>
          <Text style={styles.cardLabel}>Recebido</Text>
          <Text style={[styles.cardValue, { color: '#059669' }]}>{formatCurrency(summary.totalReceived)}</Text>
          <Text style={styles.cardCount}>{summary.countReceived} cobranca{summary.countReceived !== 1 ? 's' : ''}</Text>
        </View>
        <View style={[styles.summaryCard, styles.cardPending]}>
          <Text style={styles.cardLabel}>Pendente</Text>
          <Text style={[styles.cardValue, { color: '#6B7280' }]}>{formatCurrency(summary.totalPending)}</Text>
          <Text style={styles.cardCount}>{summary.countPending} cobranca{summary.countPending !== 1 ? 's' : ''}</Text>
        </View>
        <View style={[styles.summaryCard, styles.cardOverdue]}>
          <Text style={styles.cardLabel}>Atrasado</Text>
          <Text style={[styles.cardValue, { color: '#DC2626' }]}>{formatCurrency(summary.totalOverdue)}</Text>
          <Text style={styles.cardCount}>{summary.countOverdue} cobranca{summary.countOverdue !== 1 ? 's' : ''}</Text>
        </View>
        <View style={[styles.summaryCard, styles.cardContracts]}>
          <Text style={styles.cardLabel}>Contratos Ativos</Text>
          <Text style={[styles.cardValue, { color: '#4F46E5' }]}>{activeContracts}</Text>
          <Text style={styles.cardCount}>contrato{activeContracts !== 1 ? 's' : ''}</Text>
        </View>
      </View>

      {/* Grafico de receita */}
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>Receita - Ultimos 6 Meses</Text>
        {hasChartData ? (
          <BarChart
            data={chartData}
            barWidth={32}
            spacing={14}
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
            xAxisLabelTextStyle={{ color: '#6B7280', fontSize: 11 }}
            isAnimated
            hideRules={false}
            rulesColor="#F3F4F6"
            yAxisThickness={0}
            xAxisThickness={1}
            xAxisColor="#E5E7EB"
            width={width - 80}
          />
        ) : (
          <View style={styles.emptyChart}>
            <Text style={styles.emptyChartText}>Nenhum recebimento registrado ainda</Text>
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
  cardsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  summaryCard: {
    width: '47%', backgroundColor: '#fff', borderRadius: 12,
    padding: 16, elevation: 2,
  },
  cardReceived: { borderLeftWidth: 4, borderLeftColor: '#059669' },
  cardPending: { borderLeftWidth: 4, borderLeftColor: '#9CA3AF' },
  cardOverdue: { borderLeftWidth: 4, borderLeftColor: '#DC2626' },
  cardContracts: { borderLeftWidth: 4, borderLeftColor: '#4F46E5' },
  cardLabel: { fontSize: 12, color: '#6B7280', fontWeight: '600', marginBottom: 6, textTransform: 'uppercase' },
  cardValue: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  cardCount: { fontSize: 11, color: '#9CA3AF' },
  chartCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, elevation: 2,
  },
  chartTitle: { fontSize: 15, fontWeight: '700', color: '#1F2937', marginBottom: 16 },
  emptyChart: { alignItems: 'center', paddingVertical: 32 },
  emptyChartText: { fontSize: 14, color: '#9CA3AF' },
});
