import React, { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { showMessage } from 'react-native-flash-message';
import { firestore } from '../config/firebase';
import paymentService from '../services/paymentService';

const FREQUENCY_LABELS: Record<string, string> = {
  MONTHLY: 'Mensal',
  BIWEEKLY: 'Quinzenal',
  WEEKLY: 'Semanal',
};

const BILLING_LABELS: Record<string, string> = {
  PIX: 'PIX',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartao de Credito',
};

const formatCurrency = (value: number) =>
  value?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || 'R$ 0,00';

const formatDate = (dateStr: string) => {
  if (!dateStr) return '-';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
};

// Converte input BR (ex: "1.200,50") para numero float
const parseBRCurrency = (value: string): number => {
  const normalized = value.replace(/\./g, '').replace(',', '.');
  return parseFloat(normalized);
};

export default function ContractDetailsScreen({ route, navigation }: any) {
  const { contractId, contract: initialContract, readOnly = false } = route.params;

  const [contract, setContract] = useState(initialContract);
  const [loading, setLoading] = useState(false);

  // --- Cobranca PENDING mais proxima ---
  const [pendingCharge, setPendingCharge] = useState<any>(null);
  const [loadingCharge, setLoadingCharge] = useState(true);

  // --- Edicao permanente do valor ---
  const [editingAmount, setEditingAmount] = useState(false);
  const [newAmount, setNewAmount] = useState(String(initialContract.rentAmount || ''));

  // --- Edicao direta da proxima cobranca ---
  const [editingCharge, setEditingCharge] = useState(false);
  const [chargeEditAmount, setChargeEditAmount] = useState('');

  // Bug 3: listener em tempo real para o contrato
  useEffect(() => {
    const unsub = firestore().collection('rentalContracts').doc(contractId).onSnapshot(snap => {
      if (snap.exists) {
        setContract({ id: snap.id, ...snap.data() });
      }
    });
    return () => unsub();
  }, [contractId]);

  // Carregar cobrança PENDING mais proxima — re-executa ao ganhar foco
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const loadPendingCharge = async () => {
        setLoadingCharge(true);
        const charge = await paymentService.getPendingChargeByContract(contractId);
        if (!active) return;
        setPendingCharge(charge);
        if (charge) setChargeEditAmount(String(charge.amount || ''));
        setLoadingCharge(false);
      };
      loadPendingCharge();
      return () => { active = false; };
    }, [contractId])
  );

  const handleSaveAmount = useCallback(async () => {
    const parsed = parseBRCurrency(newAmount);
    if (isNaN(parsed) || parsed <= 0) {
      Alert.alert('Valor invalido', 'Informe um valor maior que zero.');
      return;
    }
    if (parsed === contract.rentAmount) {
      setEditingAmount(false);
      return;
    }

    const doSave = async (alsoUpdateCharge: boolean) => {
      setLoading(true);
      try {
        const result = await paymentService.editContract(contractId, { rentAmount: parsed });
        if (!result?.success) {
          Alert.alert('Erro', result?.error || 'Nao foi possivel salvar o contrato.');
          return;
        }

        if (alsoUpdateCharge && pendingCharge) {
          const editResult = await paymentService.editCharge(pendingCharge.id, { newAmount: parsed });
          if (editResult?.success) {
            setPendingCharge((prev: any) => prev ? { ...prev, amount: parsed } : null);
            setChargeEditAmount(String(parsed));
          } else {
            Alert.alert(
              'Atencao',
              'O valor do contrato foi atualizado, mas nao foi possivel atualizar a cobranca pendente. Edite-a manualmente.'
            );
          }
        }

        setEditingAmount(false);
        showMessage({ message: 'Valor do contrato atualizado com sucesso.', type: 'success' });
      } catch (err: any) {
        Alert.alert('Erro', err?.message || 'Nao foi possivel salvar.');
      } finally {
        setLoading(false);
      }
    };

    if (pendingCharge) {
      Alert.alert(
        'Cobranca pendente encontrada',
        `Existe uma cobranca de ${formatCurrency(pendingCharge.amount)} com vencimento em ${formatDate(pendingCharge.dueDate)} ainda nao paga. Deseja atualiza-la para ${formatCurrency(parsed)} tambem?`,
        [
          { text: 'Nao, so futuras', onPress: () => doSave(false) },
          { text: 'Sim, atualizar', onPress: () => doSave(true) },
        ]
      );
    } else {
      await doSave(false);
    }
  }, [newAmount, contract.rentAmount, contractId, pendingCharge]);

  const handleCancelContract = useCallback(() => {
    Alert.alert(
      'Cancelar Contrato',
      'Tem certeza? Isso cancelara o contrato e todas as cobrancas pendentes/vencidas. Esta acao nao pode ser desfeita.',
      [
        { text: 'Nao', style: 'cancel' },
        {
          text: 'Cancelar Contrato',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const result = await paymentService.cancelActiveContractByCar(contract.carId);
              if (!result?.success) {
                Alert.alert('Erro', result?.error || 'Nao foi possivel cancelar o contrato.');
                return;
              }
              showMessage({ message: 'Contrato e cobrancas cancelados com sucesso.', type: 'success' });
            } catch (err: any) {
              Alert.alert('Erro', err?.message || 'Nao foi possivel cancelar.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  }, [contract.carId]);

  const handlePauseContract = useCallback(() => {
    const isPaused = !!contract.pausedAt;
    const action = isPaused ? 'Retomar' : 'Pausar';
    const actionBody = isPaused
      ? 'O contrato sera retomado e voltara a gerar cobranças recorrentes normalmente.'
      : 'O contrato sera pausado. Nenhuma cobrança recorrente sera gerada enquanto estiver pausado.';

    Alert.alert(
      `${action} Contrato`,
      actionBody,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: action,
          onPress: async () => {
            setLoading(true);
            try {
              const result = await paymentService.pauseContract(contractId);
              if (!result?.success) {
                Alert.alert('Erro', result?.error || `Nao foi possivel ${action.toLowerCase()} o contrato.`);
                return;
              }
              showMessage({ message: `Contrato ${isPaused ? 'retomado' : 'pausado'} com sucesso.`, type: 'success' });
            } catch (err: any) {
              Alert.alert('Erro', err?.message || 'Nao foi possivel completar a operacao.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  }, [contract.pausedAt, contractId]);

  const handleDeleteContract = useCallback(() => {
    Alert.alert(
      'Excluir Contrato',
      'Tem certeza que deseja excluir este contrato inativo? Esta acao nao pode ser desfeita.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            let deleted = false;
            try {
              const result = await paymentService.deleteContract(contractId);
              if (!result?.success) {
                Alert.alert('Erro', result?.error || 'Nao foi possivel excluir o contrato.');
                return;
              }
              deleted = true;
            } catch (err: any) {
              Alert.alert('Erro', err?.message || 'Nao foi possivel excluir.');
            } finally {
              setLoading(false);
            }
            if (deleted) { showMessage({ message: 'Contrato excluido.', type: 'success' }); navigation.goBack(); }
          },
        },
      ]
    );
  }, [contractId, navigation]);

  const handleSaveChargeEdit = useCallback(async () => {
    // Fix 5: guardar contra pendingCharge ter ficado null entre o render e a acao
    if (!pendingCharge) {
      Alert.alert('Atencao', 'Nenhuma cobranca pendente encontrada. Recarregue a tela.');
      setEditingCharge(false);
      return;
    }

    const parsed = parseBRCurrency(chargeEditAmount);
    if (isNaN(parsed) || parsed <= 0) {
      Alert.alert('Valor invalido', 'Informe um valor maior que zero.');
      return;
    }

    setLoading(true);
    try {
      const result = await paymentService.editCharge(pendingCharge.id, { newAmount: parsed });
      if (!result?.success) {
        Alert.alert('Erro', result?.error || 'Nao foi possivel atualizar a cobranca.');
        return;
      }
      setPendingCharge((prev: any) => prev ? { ...prev, amount: parsed } : null);
      setEditingCharge(false);
      showMessage({ message: 'Cobranca atualizada com sucesso.', type: 'success' });
    } catch (err: any) {
      Alert.alert('Erro', err?.message || 'Nao foi possivel salvar.');
    } finally {
      setLoading(false);
    }
  }, [chargeEditAmount, pendingCharge]);

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Info do contrato */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Informacoes do Contrato</Text>
        <Row label="Carro" value={contract.carInfo} />
        {readOnly
          ? <Row label="Locador" value={contract.landlordName} />
          : <Row label="Locatario" value={contract.tenantName} />
        }
        <Row label="Frequencia" value={FREQUENCY_LABELS[contract.frequency] || contract.frequency} />
        <Row label="Metodo" value={BILLING_LABELS[contract.billingType] || contract.billingType} />
        <Row label="Inicio" value={formatDate(contract.startDate)} />
        <View style={styles.statusRow}>
          <Text style={styles.rowLabel}>Status</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <View style={[styles.badge, contract.active ? styles.badgeActive : styles.badgeInactive]}>
              <Text style={[styles.badgeText, contract.active ? styles.badgeActiveText : styles.badgeInactiveText]}>
                {contract.active ? 'Ativo' : 'Inativo'}
              </Text>
            </View>
            {contract.active && !!contract.pausedAt && (
              <View style={styles.badgePaused}>
                <Text style={styles.badgePausedText}>Pausado</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Edicao permanente do valor */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Valor do Aluguel</Text>
        {!readOnly && (
          <Text style={styles.cardSubtitle}>
            Altera o valor de todas as cobrancas futuras geradas por este contrato.
          </Text>
        )}
        {!readOnly && editingAmount ? (
          <View style={styles.editRow}>
            <TextInput
              style={styles.input}
              value={newAmount}
              onChangeText={setNewAmount}
              keyboardType="decimal-pad"
              placeholder="0,00"
              autoFocus
            />
            <TouchableOpacity style={styles.btnSave} onPress={handleSaveAmount} disabled={loading}>
              {loading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.btnSaveText}>Salvar</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btnCancel}
              onPress={() => { setEditingAmount(false); setNewAmount(String(contract.rentAmount)); }}
              disabled={loading}
            >
              <Text style={styles.btnCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.valueRow}>
            <Text style={styles.valueText}>{formatCurrency(contract.rentAmount)}</Text>
            {!readOnly && contract.active && (
              <TouchableOpacity style={styles.btnEdit} onPress={() => setEditingAmount(true)}>
                <Text style={styles.btnEditText}>Editar</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Proxima Cobranca PENDING */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Proxima Cobranca</Text>
        {loadingCharge ? (
          <ActivityIndicator size="small" color="#4F46E5" style={{ marginTop: 8 }} />
        ) : pendingCharge ? (
          <>
            <Row label="Vencimento" value={formatDate(pendingCharge.dueDate)} />
            {!readOnly && editingCharge ? (
              <View style={styles.editRow}>
                <TextInput
                  style={styles.input}
                  value={chargeEditAmount}
                  onChangeText={setChargeEditAmount}
                  keyboardType="decimal-pad"
                  placeholder="0,00"
                  autoFocus
                />
                <TouchableOpacity style={styles.btnSave} onPress={handleSaveChargeEdit} disabled={loading}>
                  {loading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.btnSaveText}>Salvar</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnCancel}
                  onPress={() => { setEditingCharge(false); setChargeEditAmount(String(pendingCharge.amount)); }}
                  disabled={loading}
                >
                  <Text style={styles.btnCancelText}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.valueRow}>
                <Text style={styles.valueText}>{formatCurrency(pendingCharge.amount)}</Text>
                {!readOnly && contract.active && (
                  <TouchableOpacity
                    style={styles.btnEdit}
                    onPress={() => { setEditingCharge(true); setChargeEditAmount(String(pendingCharge.amount)); }}
                  >
                    <Text style={styles.btnEditText}>Editar</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </>
        ) : (
          <>
            <Row label="Data prevista" value={formatDate(contract.nextDueDate)} />
            <Text style={styles.noChargeHint}>Nenhuma cobranca pendente no momento.</Text>
          </>
        )}
      </View>

      {/* Ver cobrancas — apenas para o locador */}
      {!readOnly && (
        <TouchableOpacity
          style={styles.btnCharges}
          onPress={() => navigation.navigate('Charges', {
            carId: contract.carId,
            landlordId: contract.landlordId,
            tenantId: contract.tenantId,
            carInfo: contract.carInfo,
          })}
        >
          <Text style={styles.btnChargesText}>Ver Cobranças deste Contrato →</Text>
        </TouchableOpacity>
      )}

      {/* Pausar/Retomar contrato — apenas para o locador */}
      {!readOnly && contract.active && (
        <TouchableOpacity
          style={[styles.btnPause, contract.pausedAt ? styles.btnResume : null]}
          onPress={handlePauseContract}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.btnPauseText}>{contract.pausedAt ? 'Retomar Contrato' : 'Pausar Contrato'}</Text>}
        </TouchableOpacity>
      )}

      {/* Cancelar contrato ativo — apenas para o locador */}
      {!readOnly && contract.active && (
        <TouchableOpacity
          style={styles.btnCancelContract}
          onPress={handleCancelContract}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.btnCancelContractText}>Cancelar Contrato</Text>}
        </TouchableOpacity>
      )}

      {/* Excluir contrato inativo — apenas para o locador */}
      {!readOnly && !contract.active && (
        <TouchableOpacity
          style={styles.btnDelete}
          onPress={handleDeleteContract}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator size="small" color="#DC2626" />
            : <Text style={styles.btnDeleteText}>Excluir Contrato</Text>}
        </TouchableOpacity>
      )}

    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value || '-'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: { flex: 1, backgroundColor: '#F3F4F6' },
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, elevation: 2 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1F2937', marginBottom: 4 },
  cardSubtitle: { fontSize: 12, color: '#9CA3AF', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  rowLabel: { fontSize: 13, color: '#6B7280' },
  rowValue: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  valueRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 12 },
  valueText: { fontSize: 22, fontWeight: 'bold', color: '#1F2937' },
  editRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  input: {
    flex: 1, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, color: '#1F2937',
  },
  btnEdit: { backgroundColor: '#EEF2FF', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  btnEditText: { color: '#4F46E5', fontWeight: '600', fontSize: 13 },
  btnSave: { backgroundColor: '#4F46E5', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  btnSaveText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnCancel: { paddingHorizontal: 10, paddingVertical: 10 },
  btnCancelText: { color: '#6B7280', fontSize: 13 },
  noChargeHint: { fontSize: 12, color: '#9CA3AF', marginTop: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  badgeActive: { backgroundColor: '#D1FAE5' },
  badgeInactive: { backgroundColor: '#F3F4F6' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  badgeActiveText: { color: '#059669' },
  badgeInactiveText: { color: '#9CA3AF' },
  btnCharges: {
    backgroundColor: '#4F46E5', borderRadius: 12, padding: 16,
    alignItems: 'center', marginBottom: 8,
  },
  btnChargesText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  badgePaused: { backgroundColor: '#FEF3C7', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  badgePausedText: { fontSize: 12, fontWeight: '600', color: '#D97706' },
  btnPause: {
    backgroundColor: '#F59E0B', borderRadius: 12, padding: 14,
    alignItems: 'center', marginBottom: 8,
  },
  btnResume: { backgroundColor: '#059669' },
  btnPauseText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  btnCancelContract: {
    backgroundColor: '#DC2626', borderRadius: 12, padding: 14,
    alignItems: 'center', marginBottom: 8,
  },
  btnCancelContractText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  btnDelete: {
    borderWidth: 1, borderColor: '#DC2626', borderRadius: 12, padding: 14,
    alignItems: 'center', marginBottom: 8,
  },
  btnDeleteText: { color: '#DC2626', fontWeight: '600', fontSize: 14 },
});
