// src/screens/VehicleHistoryScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, useWindowDimensions,
} from 'react-native';
import { LineChart, BarChart } from 'react-native-gifted-charts';
import { tasksService } from '../services/tasksService';
import ImageViewer from '../components/ImageViewer';

const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const getNiceYAxis = (maxVal: number) => {
  if (maxVal === 0) return { maxValue: 100, stepValue: 25, noOfSections: 4 };
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

const formatShortDate = (timestamp: any): string => {
  if (!timestamp || !timestamp.toDate) return '';
  try {
    const d = timestamp.toDate();
    return `${String(d.getDate()).padStart(2, '0')}/${MONTH_SHORT[d.getMonth()]}`;
  } catch { return ''; }
};

const formatDate = (timestamp: any): string => {
  if (!timestamp || !timestamp.toDate) return 'N/A';
  try { return timestamp.toDate().toLocaleDateString('pt-BR'); } catch { return 'N/A'; }
};

const oilKmValue = (task: any): number => task.oilChangeKm ?? task.currentKm ?? 0;

const VehicleHistoryScreen = ({ route, navigation }: any) => {
  const { carId, carLabel } = route.params;
  const [loading, setLoading] = useState(true);
  const [kmTasks, setKmTasks] = useState<any[]>([]);
  const [oilTasks, setOilTasks] = useState<any[]>([]);
  const [maintenanceTasks, setMaintenanceTasks] = useState<any[]>([]);
  const [imageViewer, setImageViewer] = useState<{ visible: boolean; url: string | null; title: string }>({
    visible: false, url: null, title: '',
  });
  const { width } = useWindowDimensions();
  const chartWidth = width - 80;

  useEffect(() => { loadHistory(); }, []);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const result = await tasksService.getCarTasks(carId, 'completed');
      if (result.success) {
        const sortByCompleted = (a: any, b: any) => {
          const da = a.completedAt?.toDate?.() || new Date(0);
          const db = b.completedAt?.toDate?.() || new Date(0);
          return da - db; // oldest first for charts
        };
        setKmTasks(result.data.filter((t: any) => t.type === 'km_update').sort(sortByCompleted));
        setOilTasks(result.data.filter((t: any) => t.type === 'oil_change').sort(sortByCompleted));
        setMaintenanceTasks(result.data.filter((t: any) => t.type === 'maintenance').sort(sortByCompleted));
      }
    } catch (error) {
      console.error('loadHistory error:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderEmpty = (msg: string) => (
    <View style={styles.emptySection}>
      <Text style={styles.emptySectionText}>{msg}</Text>
    </View>
  );

  const formatYLabel = (val: string) => {
    const n = Number(val);
    if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
    return String(n);
  };

  const commonBarProps = {
    barWidth: 32, spacing: 14, roundedTop: true,
    isAnimated: true, hideRules: false,
    rulesColor: '#F3F4F6', yAxisThickness: 0,
    xAxisThickness: 1, xAxisColor: '#E5E7EB',
    yAxisTextStyle: { color: '#9CA3AF', fontSize: 10 },
    xAxisLabelTextStyle: { color: '#6B7280', fontSize: 11 },
    width: chartWidth, formatYLabel,
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color="#4F46E5" /></View>;
  }

  // KM chart
  const kmChartData = kmTasks.map(t => ({
    value: t.newKm || 0,
    label: formatShortDate(t.completedAt),
  }));
  const kmMax = Math.max(...kmChartData.map(d => d.value), 0);
  const kmYAxis = getNiceYAxis(kmMax);

  // Oil chart
  const oilChartData = oilTasks.map(t => ({
    value: oilKmValue(t),
    label: formatShortDate(t.completedAt),
    frontColor: '#059669',
  }));
  const oilMax = Math.max(...oilChartData.map(d => d.value), 0);
  const oilYAxis = getNiceYAxis(oilMax);

  // Maintenance chart
  const mainChartData = maintenanceTasks.map(t => ({
    value: parseFloat(t.maintenanceCost) || 0,
    label: formatShortDate(t.completedAt),
    frontColor: '#F59E0B',
  }));
  const mainMax = Math.max(...mainChartData.map(d => d.value), 0);
  const mainYAxis = getNiceYAxis(mainMax);
  const hasMainCost = mainChartData.some(d => d.value > 0);

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.headerCard}>
          <Text style={styles.headerLabel}>Veiculo</Text>
          <Text style={styles.headerTitle}>{carLabel}</Text>
        </View>

        {/* ===== QUILOMETRAGEM ===== */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quilometragem</Text>
          {kmTasks.length === 0 ? renderEmpty('Nenhum registro de quilometragem') : (
            <>
              <View style={styles.chartCard}>
                <Text style={styles.chartSubtitle}>Progressao de KM ao longo do tempo</Text>
                <LineChart
                  data={kmChartData}
                  width={chartWidth}
                  height={180}
                  color="#4F46E5"
                  dataPointsColor="#4F46E5"
                  startFillColor="#4F46E580"
                  endFillColor="#4F46E508"
                  areaChart
                  curved={kmChartData.length > 2}
                  maxValue={kmYAxis.maxValue}
                  stepValue={kmYAxis.stepValue}
                  noOfSections={kmYAxis.noOfSections}
                  formatYLabel={formatYLabel}
                  yAxisTextStyle={{ color: '#9CA3AF', fontSize: 10 }}
                  xAxisLabelTextStyle={{ color: '#6B7280', fontSize: 11 }}
                  hideRules={false}
                  rulesColor="#F3F4F6"
                  yAxisThickness={0}
                  xAxisThickness={1}
                  xAxisColor="#E5E7EB"
                  isAnimated
                />
              </View>
              {[...kmTasks].reverse().map(task => (
                <View key={task.id} style={styles.historyCard}>
                  <View style={styles.historyCardMain}>
                    <Text style={styles.historyCardDate}>{formatDate(task.completedAt)}</Text>
                    <Text style={styles.historyCardValue}>
                      {task.newKm != null ? task.newKm.toLocaleString() : 'N/A'} km
                      {task.newKm != null && task.previousKm != null && (task.newKm - task.previousKm) >= 0
                        ? `  (+${(task.newKm - task.previousKm).toLocaleString()} km)`
                        : ''}
                    </Text>
                    {(task.dashboardPhoto || task.dashboardPhotoUrl) && (
                      <TouchableOpacity onPress={() => setImageViewer({
                        visible: true,
                        url: task.dashboardPhoto || task.dashboardPhotoUrl,
                        title: 'Foto do Hodometro',
                      })}>
                        <Text style={styles.photoLink}>Ver foto do hodometro →</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.detailsButton}
                    onPress={() => navigation.navigate('TaskDetails', { taskId: task.id, carId })}>
                    <Text style={styles.detailsButtonText}>Ver detalhes</Text>
                    <Text style={styles.detailsArrow}>→</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}
        </View>

        {/* ===== TROCAS DE OLEO ===== */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trocas de Oleo</Text>
          {oilTasks.length === 0 ? renderEmpty('Nenhuma troca de oleo registrada') : (
            <>
              <View style={styles.chartCard}>
                <Text style={styles.chartSubtitle}>Quilometragem por troca</Text>
                <BarChart
                  data={oilChartData}
                  {...commonBarProps}
                  maxValue={oilYAxis.maxValue}
                  stepValue={oilYAxis.stepValue}
                  noOfSections={oilYAxis.noOfSections}
                />
              </View>
              {[...oilTasks].reverse().map(task => (
                <View key={task.id} style={styles.historyCard}>
                  <View style={styles.historyCardMain}>
                    <Text style={styles.historyCardDate}>{formatDate(task.completedAt)}</Text>
                    <Text style={styles.historyCardValue}>{oilKmValue(task).toLocaleString()} km</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.detailsButton}
                    onPress={() => navigation.navigate('TaskDetails', { taskId: task.id, carId })}>
                    <Text style={styles.detailsButtonText}>Ver detalhes</Text>
                    <Text style={styles.detailsArrow}>→</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}
        </View>

        {/* ===== MANUTENCOES ===== */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Manutencoes</Text>
          {maintenanceTasks.length === 0 ? renderEmpty('Nenhuma manutencao registrada') : (
            <>
              {hasMainCost && (
                <View style={styles.chartCard}>
                  <Text style={styles.chartSubtitle}>Custo por manutencao (R$)</Text>
                  <BarChart
                    data={mainChartData}
                    {...commonBarProps}
                    maxValue={mainYAxis.maxValue}
                    stepValue={mainYAxis.stepValue}
                    noOfSections={mainYAxis.noOfSections}
                  />
                </View>
              )}
              {[...maintenanceTasks].reverse().map(task => (
                <View key={task.id} style={styles.historyCard}>
                  <View style={styles.historyCardMain}>
                    <Text style={styles.historyCardDate}>{formatDate(task.completedAt)}</Text>
                    {task.maintenanceType ? (
                      <Text style={styles.historyCardSub}>{task.maintenanceType}</Text>
                    ) : null}
                    {task.maintenanceCost ? (
                      <Text style={styles.historyCardValue}>
                        R$ {parseFloat(task.maintenanceCost).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </Text>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    style={styles.detailsButton}
                    onPress={() => navigation.navigate('TaskDetails', { taskId: task.id, carId })}>
                    <Text style={styles.detailsButtonText}>Ver detalhes</Text>
                    <Text style={styles.detailsArrow}>→</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}
        </View>

        {/* ===== DESPESAS (EM BREVE) ===== */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Despesas</Text>
          <View style={styles.comingSoonCard}>
            <Text style={styles.comingSoonIcon}>📊</Text>
            <Text style={styles.comingSoonTitle}>Em breve</Text>
            <Text style={styles.comingSoonText}>Historico de despesas do veiculo</Text>
          </View>
        </View>

        <View style={styles.bottomSpace} />
      </ScrollView>

      <ImageViewer
        visible={imageViewer.visible}
        imageUrl={imageViewer.url}
        title={imageViewer.title}
        onClose={() => setImageViewer({ visible: false, url: null, title: '' })}
      />
    </>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  content: { padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    marginBottom: 20, elevation: 2,
  },
  headerLabel: { fontSize: 12, color: '#6B7280', fontWeight: '600', textTransform: 'uppercase', marginBottom: 4 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#1F2937' },
  section: { marginBottom: 28 },
  sectionTitle: {
    fontSize: 18, fontWeight: 'bold', color: '#1F2937',
    marginBottom: 12, paddingLeft: 2,
  },
  chartCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    elevation: 2, marginBottom: 12, overflow: 'hidden',
  },
  chartSubtitle: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginBottom: 12 },
  historyCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    elevation: 2, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  historyCardMain: { flex: 1, marginRight: 12 },
  historyCardDate: { fontSize: 12, color: '#9CA3AF', marginBottom: 4 },
  historyCardValue: { fontSize: 16, fontWeight: 'bold', color: '#1F2937' },
  historyCardSub: { fontSize: 13, color: '#6B7280', marginBottom: 2 },
  photoLink: { fontSize: 13, color: '#4F46E5', fontWeight: '600', marginTop: 6 },
  detailsButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#EEF2FF', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8,
  },
  detailsButtonText: { fontSize: 13, color: '#4F46E5', fontWeight: '600' },
  detailsArrow: { fontSize: 16, color: '#4F46E5' },
  emptySection: {
    backgroundColor: '#fff', borderRadius: 12, padding: 24,
    alignItems: 'center', elevation: 1,
  },
  emptySectionText: { fontSize: 14, color: '#9CA3AF' },
  comingSoonCard: {
    backgroundColor: '#F9FAFB', borderRadius: 12, padding: 32,
    alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB',
  },
  comingSoonIcon: { fontSize: 36, marginBottom: 8 },
  comingSoonTitle: { fontSize: 16, fontWeight: 'bold', color: '#9CA3AF', marginBottom: 4 },
  comingSoonText: { fontSize: 13, color: '#9CA3AF' },
  bottomSpace: { height: 32 },
});

export default VehicleHistoryScreen;
