import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  TextInput,
  Linking,
} from 'react-native';
import { showMessage } from 'react-native-flash-message';
import Clipboard from '@react-native-clipboard/clipboard';
import { useNavigation, useRoute } from '@react-navigation/native';
import paymentService from '../services/paymentService';
import { auth } from '../config/firebase';
import firestore from '@react-native-firebase/firestore';

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

const formatDate = (dateStr: string) => {
  if (!dateStr) return '-';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
};

const formatDateInput = (text: string) => {
  const nums = text.replace(/\D/g, '').slice(0, 8);
  if (nums.length <= 2) return nums;
  if (nums.length <= 4) return nums.slice(0, 2) + '/' + nums.slice(2);
  return nums.slice(0, 2) + '/' + nums.slice(2, 4) + '/' + nums.slice(4);
};

const parseDateToISO = (ddmmyyyy: string) => {
  const [dd, mm, yyyy] = ddmmyyyy.split('/');
  return `${yyyy}-${mm}-${dd}`;
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

export default function PaymentDetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { chargeId, charge: initialCharge } = route.params;

  // onSnapshot garante dados sempre atualizados (ex: status muda via webhook enquanto tela esta aberta)
  const [charge, setCharge] = useState(initialCharge ?? null);
  const [pixData, setPixData] = useState<{ encodedImage: string; payload: string } | null>(null);
  const [loadingPix, setLoadingPix] = useState(false);
  const [pixLoadError, setPixLoadError] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDueDate, setEditDueDate] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const pixLoadedForPaymentId = useRef<string | null>(null); // rastreia o asaasPaymentId para o qual o QR foi carregado

  useEffect(() => {
    const uid = auth().currentUser?.uid;
    if (!uid) return;

    // Buscar role do usuario
    firestore().collection('users').doc(uid).get().then(userDoc => {
      setUserRole(userDoc.data()?.role ?? null);
    });

    // Listener em tempo real para o charge — atualiza status automaticamente via webhook
    const unsubscribe = firestore()
      .collection('charges')
      .doc(chargeId)
      .onSnapshot(snapshot => {
        if (snapshot.exists) {
          setCharge({ id: snapshot.id, ...snapshot.data() });
        } else {
          Alert.alert(
            'Cobranca nao encontrada',
            'Esta cobranca foi removida ou cancelada. Voce sera redirecionado.',
            [{ text: 'OK', onPress: () => navigation.goBack() }],
          );
        }
      });

    return () => unsubscribe();
  }, [chargeId]);

  // Carregar QR Code PIX quando charge e role estiverem prontos.
  // Recarrega apenas quando asaasPaymentId muda (ex: apos editCharge), nao a cada mudanca de status.
  useEffect(() => {
    let active = true;

    if (!charge || !userRole) return;
    const canPay = charge.status === 'PENDING' || charge.status === 'OVERDUE';
    if (!canPay) {
      // Limpar estado de loading/erro quando cobranca nao e mais pagavel (ex: foi paga enquanto tela estava aberta)
      setPixLoadError(false);
      setLoadingPix(false);
      setPixData(null);
      return;
    }
    const currentPaymentId = charge.asaasPaymentId;
    if (!currentPaymentId) return;
    if (pixLoadedForPaymentId.current === currentPaymentId) return; // ja carregado para este asaasPaymentId
    if (userRole === 'locatario' && charge.billingType === 'PIX') {
      pixLoadedForPaymentId.current = currentPaymentId;
      setLoadingPix(true);
      setPixData(null);
      setPixLoadError(false);
      paymentService.getPixQrCode(chargeId).then((result: any) => {
        if (!active) return; // componente desmontado ou effect re-executado, descartar resultado
        if (result && !result.error) {
          setPixData(result);
        } else {
          setPixLoadError(true);
        }
        setLoadingPix(false);
      });
    }

    return () => { active = false; };
  }, [charge, userRole, chargeId]);

  const handleCancel = async () => {
    Alert.alert(
      'Cancelar Cobrança',
      'Tem certeza que deseja cancelar esta cobrança?',
      [
        { text: 'Não', style: 'cancel' },
        {
          text: 'Sim, cancelar',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            const result: any = await paymentService.cancelCharge(chargeId);
            setCancelling(false);
            if (result?.success) {
              showMessage({ message: 'Cobranca cancelada.', type: 'success' });
              navigation.goBack();
            } else {
              Alert.alert('Erro', result?.error || 'Não foi possível cancelar.');
            }
          },
        },
      ]
    );
  };

  const handleEdit = () => {
    if (!charge.dueDate) {
      Alert.alert('Aviso', 'Esta cobranca nao possui data de vencimento definida. Apenas o valor pode ser editado.');
    }
    const [yyyy, mm, dd] = (charge.dueDate || '').split('-');
    setEditDueDate(yyyy && mm && dd ? `${dd}/${mm}/${yyyy}` : '');
    setEditAmount(charge.amount?.toString() || '');
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    const newAmount = parseFloat(editAmount);
    if (isNaN(newAmount) || newAmount <= 0) {
      Alert.alert('Erro', 'Valor invalido.');
      return;
    }

    // Se charge.dueDate existe, a data e obrigatoria no formulario
    const hasDueDateField = !!charge.dueDate;
    if (hasDueDateField && (!editDueDate || editDueDate.length < 10)) {
      Alert.alert('Erro', 'Data de vencimento invalida. Use o formato DD/MM/AAAA.');
      return;
    }

    const parsedDueDate = hasDueDateField ? parseDateToISO(editDueDate) : null;
    const dueDateChanged = hasDueDateField && parsedDueDate !== charge.dueDate;
    const amountChanged = newAmount !== charge.amount;

    if (!dueDateChanged && !amountChanged) {
      Alert.alert('Aviso', 'Nenhuma alteracao detectada.');
      return;
    }

    // Validar que a nova data de vencimento nao esta no passado
    if (dueDateChanged && parsedDueDate) {
      const today = new Date().toISOString().split('T')[0];
      if (parsedDueDate < today) {
        Alert.alert('Erro', 'A data de vencimento nao pode ser no passado.');
        return;
      }
    }

    setSaving(true);
    const result: any = await paymentService.editCharge(chargeId, {
      newDueDate: dueDateChanged ? parsedDueDate : undefined,
      newAmount: amountChanged ? newAmount : undefined,
    });
    setSaving(false);
    if (result?.success) {
      setEditing(false);
      showMessage({ message: 'Cobranca atualizada.', type: 'success' });
    } else {
      Alert.alert('Erro', result?.error || 'Nao foi possivel editar a cobranca.');
    }
  };

  const handleCopyPix = () => {
    if (pixData?.payload) {
      Clipboard.setString(pixData.payload);
      Alert.alert('Copiado!', 'Código Pix copiado para a área de transferência.');
    }
  };

  // Guard: charge pode ser null enquanto o onSnapshot carrega
  if (!charge) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  const canPay = charge.status === 'PENDING' || charge.status === 'OVERDUE';

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Detalhes do Pagamento</Text>

      {/* Card principal */}
      <View style={styles.card}>
        <Text style={styles.carInfo}>{charge.carInfo || 'Aluguel'}</Text>
        <Text style={styles.amount}>R$ {(charge.amount ?? 0).toFixed(2)}</Text>
        <Text style={styles.dueDate}>Vencimento: {formatDate(charge.dueDate)}</Text>
        <View style={[styles.badge, { backgroundColor: getStatusColor(charge.status) }]}>
          <Text style={styles.badgeText}>{getStatusLabel(charge.status)}</Text>
        </View>
        <Text style={styles.billingType}>
          Método: {charge.billingType === 'PIX' ? 'PIX' : charge.billingType === 'BOLETO' ? 'Boleto' : 'Cartão'}
        </Text>
      </View>

      {/* Comprovante de pagamento */}
      {(charge.status === 'RECEIVED' || charge.status === 'CONFIRMED') && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Comprovante de Pagamento</Text>
          {charge.transactionReceiptUrl ? (
            <TouchableOpacity
              style={styles.receiptButton}
              onPress={() => {
                if (charge.transactionReceiptUrl) {
                  Linking.openURL(charge.transactionReceiptUrl).catch(() =>
                    Alert.alert('Erro', 'Nao foi possivel abrir o comprovante.')
                  );
                }
              }}
            >
              <Text style={styles.receiptButtonText}>Ver Comprovante</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.pendingReceiptText}>Comprovante sendo processado...</Text>
          )}
        </View>
      )}

      {/* Seção PIX para locatário */}
      {userRole === 'locatario' && charge.billingType === 'PIX' && canPay && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Pagar com PIX</Text>
          {loadingPix ? (
            <ActivityIndicator size="large" color="#4F46E5" style={{ marginVertical: 16 }} />
          ) : pixData ? (
            <>
              <Image
                source={{ uri: pixData.encodedImage ? `data:image/png;base64,${pixData.encodedImage}` : '' }}
                style={styles.qrCode}
                resizeMode="contain"
              />
              <TouchableOpacity style={styles.copyButton} onPress={handleCopyPix}>
                <Text style={styles.copyButtonText}>Copiar código Pix</Text>
              </TouchableOpacity>
            </>
          ) : pixLoadError ? (
            <Text style={styles.errorText}>Nao foi possivel carregar o QR Code.</Text>
          ) : null}
        </View>
      )}

      {/* Boleto para locatário */}
      {userRole === 'locatario' && charge.billingType === 'BOLETO' && canPay && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Pagar com Boleto</Text>
          <TouchableOpacity
            style={styles.boletoButton}
            onPress={() => {
              if (charge.bankSlipUrl) {
                Linking.openURL(charge.bankSlipUrl).catch(() =>
                  Alert.alert('Erro', 'Nao foi possivel abrir o boleto.')
                );
              } else {
                Alert.alert('Boleto indisponivel', 'O link do boleto ainda nao esta disponivel.');
              }
            }}
          >
            <Text style={styles.boletoButtonText}>Abrir Boleto</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Info de recebimento para locador */}
      {userRole === 'locador' && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Informações de Recebimento</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Valor líquido:</Text>
            <Text style={styles.infoValue}>
              {charge.netAmount != null ? `R$ ${charge.netAmount.toFixed(2)}` : '-'}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Taxa plataforma:</Text>
            <Text style={styles.infoValue}>
              {charge.platformFee != null ? `R$ ${charge.platformFee.toFixed(2)}` : '-'}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Data pagamento:</Text>
            <Text style={styles.infoValue}>{formatDate(charge.paymentDate)}</Text>
          </View>
        </View>
      )}

      {userRole === 'locador' && charge.status === 'PENDING' && !editing && (
        <TouchableOpacity style={styles.editButton} onPress={handleEdit}>
          <Text style={styles.editButtonText}>Editar Cobranca</Text>
        </TouchableOpacity>
      )}

      {editing && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Editar Cobranca</Text>
          <Text style={styles.infoLabel}>Novo valor (R$)</Text>
          <TextInput
            style={styles.editInput}
            keyboardType="numeric"
            value={editAmount}
            onChangeText={setEditAmount}
          />
          <Text style={styles.infoLabel}>Nova data de vencimento</Text>
          <TextInput
            style={[styles.editInput, !charge.dueDate && { opacity: 0.4 }]}
            value={editDueDate}
            onChangeText={(text) => setEditDueDate(formatDateInput(text))}
            placeholder="DD/MM/AAAA"
            keyboardType="numeric"
            maxLength={10}
            editable={!!charge.dueDate}
          />
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <TouchableOpacity
              style={[{ flex: 1, marginRight: 8, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center' }]}
              onPress={() => setEditing(false)}
            >
              <Text style={{ color: '#6B7280', fontWeight: '600' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[{ flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#4F46E5', alignItems: 'center' }, saving && { opacity: 0.6 }]}
              onPress={handleSaveEdit}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Salvar</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Cancelar (apenas locador, status PENDING) */}
      {userRole === 'locador' && charge.status === 'PENDING' && (
        <TouchableOpacity
          style={[styles.cancelButton, cancelling && { opacity: 0.6 }]}
          onPress={handleCancel}
          disabled={cancelling}
        >
          {cancelling ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.cancelButtonText}>Cancelar Cobranca</Text>
          )}
        </TouchableOpacity>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: { flex: 1, backgroundColor: '#F3F4F6' },
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#1F2937', marginBottom: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
  },
  carInfo: { fontSize: 16, fontWeight: '600', color: '#1F2937', marginBottom: 4 },
  amount: { fontSize: 28, fontWeight: 'bold', color: '#1F2937', marginVertical: 8 },
  dueDate: { fontSize: 14, color: '#6B7280', marginBottom: 8 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginBottom: 8 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  billingType: { fontSize: 14, color: '#6B7280' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1F2937', marginBottom: 12 },
  qrCode: { width: 200, height: 200, alignSelf: 'center', marginBottom: 16 },
  copyButton: {
    backgroundColor: '#4F46E5',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  copyButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  boletoButton: {
    backgroundColor: '#4F46E5',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  boletoButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  infoLabel: { fontSize: 14, color: '#6B7280', flex: 1, marginRight: 8 },
  infoValue: { fontSize: 14, fontWeight: '600', color: '#1F2937', flexShrink: 0, textAlign: 'right' },
  cancelButton: {
    backgroundColor: '#DC2626',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  errorText: { color: '#DC2626', textAlign: 'center', marginVertical: 8 },
  receiptButton: {
    backgroundColor: '#059669',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  receiptButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  pendingReceiptText: { fontSize: 14, color: '#6B7280', fontStyle: 'italic', textAlign: 'center' },
  editButton: {
    backgroundColor: '#F59E0B', borderRadius: 8,
    paddingVertical: 14, alignItems: 'center', marginTop: 8, marginBottom: 8,
  },
  editButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  editInput: {
    borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8,
    padding: 12, fontSize: 15, color: '#1F2937', marginBottom: 12, marginTop: 4,
  },
});
