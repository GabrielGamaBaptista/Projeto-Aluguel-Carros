import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, RefreshControl, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { showMessage } from 'react-native-flash-message';
import { MdiCash } from '../components/icons/MdiIcons';
import paymentService from '../services/paymentService';
import { auth } from '../config/firebase';

type RootStackParamList = {
  Charges: {
    carId: string;
    landlordId: string;
    tenantId: string;
    carInfo: string;
    tenantName: string;
    landlordName: string;
  };
};

type Props = NativeStackScreenProps<RootStackParamList, 'Charges'>;

const ChargesScreen: React.FC<Props> = ({ route }) => {
  const { carId, landlordId, tenantId, carInfo, tenantName, landlordName } = route.params;
  const navigation = useNavigation<any>();

  const [charges, setCharges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [contract, setContract] = useState<any>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [manualAmount, setManualAmount] = useState('');
  const [manualDueDate, setManualDueDate] = useState(() => {
    const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
  });
  const [manualBillingType, setManualBillingType] = useState<'PIX' | 'BOLETO' | 'CREDIT_CARD'>('PIX');
  const [manualDescription, setManualDescription] = useState('');
  const [creatingCharge, setCreatingCharge] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [contractResult, chargesResult] = await Promise.all([
        paymentService.getContractByCar(carId, 'locador'),
        paymentService.getChargesByCar(carId)
      ]);
      setContract(contractResult.data || null);
      setCharges(chargesResult.data || []);
    } catch (error) {
      console.error('Error fetching charges data:', error);
      Alert.alert('Erro', 'Falha ao carregar cobranças.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [carId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
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
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const [year, month, day] = parts;
    return `${day}/${month}/${year}`;
  };

  const formatDateInput = (text: string) => {
    const clean = text.replace(/\D/g, '');
    if (clean.length <= 2) return clean;
    if (clean.length <= 4) return clean.slice(0, 2) + '/' + clean.slice(2);
    return clean.slice(0, 2) + '/' + clean.slice(2, 4) + '/' + clean.slice(4, 8);
  };

  const parseDateToISO = (text: string): string | null => {
    if (!text || text.length < 10) return null;
    const parts = text.split('/');
    if (parts.length !== 3) return null;
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    if (year.length !== 4) return null;
    return `${year}-${month}-${day}`;
  };

  const handleNewManualCharge = () => setModalVisible(true);

  const handleCreateManualCharge = async () => {
    const amount = parseFloat(manualAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Erro', 'Informe um valor valido.');
      return;
    }
    const isoDate = parseDateToISO(manualDueDate);
    if (!isoDate || isoDate < new Date().toISOString().split('T')[0]) {
      Alert.alert('Erro', 'A data de vencimento nao pode ser no passado. Use o formato DD/MM/AAAA.');
      return;
    }
    const currentUid = auth().currentUser?.uid;
    if (!currentUid || currentUid !== landlordId) {
      Alert.alert('Erro', 'Nao autorizado.');
      return;
    }

    setCreatingCharge(true);
    const result: any = await paymentService.createCharge({
      contractId: null,
      carId,
      tenantId,
      landlordId,
      amount,
      billingType: manualBillingType,
      dueDate: isoDate,
      description: manualDescription || `Cobranca avulsa - ${carInfo}`,
      carInfo,
    });
    setCreatingCharge(false);
    if (result?.success) {
      setModalVisible(false);
      setManualAmount('');
      setManualDescription('');
      fetchData();
      showMessage({ message: 'Cobranca avulsa criada!', type: 'success' });
    } else {
      Alert.alert('Erro', result?.error || 'Nao foi possivel criar a cobranca.');
    }
  };

  const renderChargeItem = ({ item }: { item: any }) => (
    <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('PaymentDetails', { chargeId: item.id, charge: item })} activeOpacity={0.7}>
      <View style={styles.chargeHeader}>
        <Text style={styles.chargeValue}>R$ {item.amount?.toFixed(2) ?? '0.00'}</Text>
        <View style={[styles.badge, { backgroundColor: getStatusColor(item.status) }]}>
          <Text style={styles.badgeText}>{getStatusLabel(item.status)}</Text>
        </View>
      </View>
      <View style={styles.chargeDetails}>
        <Text style={styles.detailText}>Vencimento: {formatDate(item.dueDate)}</Text>
        <Text style={styles.detailText}>Metodo: {item.billingType}</Text>
      </View>
    </TouchableOpacity>
  );

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Cobranças</Text>
        <Text style={styles.subtitle}>{carInfo}</Text>
      </View>

      {!loading && !contract && (
        <TouchableOpacity
          style={styles.setupContractButton}
          onPress={() => navigation.navigate('PaymentContract', {
            carId, tenantId, landlordId, carInfo, tenantName, landlordName,
          })}
        >
          <MdiCash size={28} color="#4F46E5" style={{ marginRight: 12 }} />
          <View style={styles.setupContractTexts}>
            <Text style={styles.setupContractTitle}>Configurar Pagamento Recorrente</Text>
            <Text style={styles.setupContractSubtitle}>Crie um contrato para cobranças automáticas</Text>
          </View>
          <Text style={styles.setupContractArrow}>→</Text>
        </TouchableOpacity>
      )}

      {contract && (
        <TouchableOpacity
          style={[styles.card, styles.contractSummary]}
          onPress={() => navigation.navigate('ContractDetails', {
            contractId: contract.id,
            contract: {
              carId: contract.carId,
              landlordId: contract.landlordId,
              tenantId: contract.tenantId,
              carInfo: contract.carInfo,
              tenantName: contract.tenantName,
              rentAmount: contract.rentAmount,
              frequency: contract.frequency,
              billingType: contract.billingType,
              startDate: contract.startDate,
              nextDueDate: contract.nextDueDate,
              dayOfMonth: contract.dayOfMonth || null,
              active: contract.active,
              nextChargeOverride: contract.nextChargeOverride
                ? { amount: contract.nextChargeOverride.amount }
                : null,
            },
          })}
        >
          <View style={styles.contractHeader}>
            <Text style={styles.label}>Contrato Ativo</Text>
            <Text style={styles.contractEditHint}>Editar →</Text>
          </View>
          <Text style={styles.contractText}>Valor: R$ {contract.rentAmount?.toFixed(2)}</Text>
          <Text style={styles.contractText}>Frequência: {contract.frequency}</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.manualButton} onPress={handleNewManualCharge}>
        <Text style={styles.manualButtonText}>+ Nova Cobrança Avulsa</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView style={styles.modalCard} contentContainerStyle={styles.modalCardInner}>
            <Text style={styles.modalTitle}>Nova Cobranca Avulsa</Text>
            <Text style={styles.label}>Valor (R$)</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={manualAmount}
              onChangeText={setManualAmount}
              placeholder="Ex: 500.00"
            />
            <Text style={styles.label}>Vencimento (DD/MM/AAAA)</Text>
            <TextInput
              style={styles.input}
              value={manualDueDate}
              onChangeText={(t) => setManualDueDate(formatDateInput(t))}
              placeholder="DD/MM/AAAA"
              keyboardType="numeric"
              maxLength={10}
            />
            <Text style={styles.label}>Metodo</Text>
            <View style={styles.row}>
              {(['PIX', 'BOLETO', 'CREDIT_CARD'] as const).map(type => (
                <TouchableOpacity
                  key={type}
                  style={[styles.typeButton, manualBillingType === type && styles.typeButtonActive]}
                  onPress={() => setManualBillingType(type)}
                >
                  <Text style={[styles.typeButtonText, manualBillingType === type && styles.typeButtonTextActive]}>
                    {type === 'PIX' ? 'PIX' : type === 'BOLETO' ? 'Boleto' : 'Cartao'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>Descricao (opcional)</Text>
            <TextInput
              style={styles.input}
              value={manualDescription}
              onChangeText={setManualDescription}
              placeholder="Motivo da cobranca"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelModalButton} onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelModalButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, creatingCharge && { opacity: 0.6 }]}
                onPress={handleCreateManualCharge}
                disabled={creatingCharge}
              >
                {creatingCharge
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.confirmButtonText}>Criar</Text>
                }
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <FlatList
        data={charges}
        keyExtractor={(item) => item.id || item.invoiceId}
        renderItem={renderChargeItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.emptyText}>Nenhuma cobranca encontrada</Text>}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  contractSummary: {
    borderLeftWidth: 4,
    borderLeftColor: '#4F46E5',
  },
  contractHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  contractEditHint: {
    fontSize: 13,
    color: '#4F46E5',
    fontWeight: '600',
  },
  setupContractButton: {
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  setupContractIcon: { fontSize: 28, marginRight: 12 },
  setupContractTexts: { flex: 1 },
  setupContractTitle: { fontSize: 15, fontWeight: '700', color: '#4F46E5' },
  setupContractSubtitle: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  setupContractArrow: { fontSize: 18, color: '#4F46E5', fontWeight: 'bold' },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4B5563',
    marginBottom: 4,
  },
  contractText: {
    fontSize: 16,
    color: '#374151',
  },
  manualButton: {
    borderWidth: 1,
    borderColor: '#4F46E5',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  manualButtonText: {
    color: '#4F46E5',
    fontWeight: '600',
  },
  chargeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  chargeValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  chargeDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailText: {
    fontSize: 14,
    color: '#6B7280',
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 40,
    color: '#9CA3AF',
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  modalCardInner: { padding: 20, paddingBottom: 36 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937', marginBottom: 16 },
  input: {
    borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8,
    padding: 12, fontSize: 15, color: '#1F2937', marginBottom: 12,
  },
  row: { flexDirection: 'row', marginBottom: 12, flexWrap: 'wrap' },
  typeButton: {
    flex: 1, paddingVertical: 10, borderWidth: 1, borderColor: '#D1D5DB',
    borderRadius: 8, marginHorizontal: 3, alignItems: 'center',
  },
  typeButtonActive: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  typeButtonText: { color: '#4B5563', fontWeight: '500', fontSize: 13 },
  typeButtonTextActive: { color: '#fff' },
  modalButtons: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  cancelModalButton: {
    flex: 1, paddingVertical: 12, borderWidth: 1, borderColor: '#D1D5DB',
    borderRadius: 8, alignItems: 'center', marginRight: 8,
  },
  cancelModalButtonText: { color: '#6B7280', fontWeight: '600' },
  confirmButton: {
    flex: 1, paddingVertical: 12, backgroundColor: '#4F46E5',
    borderRadius: 8, alignItems: 'center',
  },
  confirmButtonText: { color: '#fff', fontWeight: '700' },
});

export default ChargesScreen;
