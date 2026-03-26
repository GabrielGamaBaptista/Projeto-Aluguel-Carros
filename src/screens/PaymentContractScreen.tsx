import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { showMessage } from 'react-native-flash-message';
import paymentService from '../services/paymentService';
import { auth } from '../config/firebase';

type RootStackParamList = {
  PaymentContract: {
    carId: string;
    tenantId: string;
    landlordId: string;
    carInfo: string;
    tenantName: string;
    landlordName: string;
  };
};

type Props = NativeStackScreenProps<RootStackParamList, 'PaymentContract'>;

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

const PaymentContractScreen: React.FC<Props> = ({ route, navigation }) => {
  const { carId, tenantId, landlordId, carInfo, tenantName, landlordName } = route.params;

  const [rentAmount, setRentAmount] = useState('');
  const [frequency, setFrequency] = useState<'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'>('MONTHLY');
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  });
  const [billingType, setBillingType] = useState<'PIX' | 'BOLETO' | 'CREDIT_CARD'>('PIX');

  // Calcula a data da primeira cobrança mensal com base no dayOfMonth selecionado
  const firstMonthlyChargeHint = React.useMemo(() => {
    if (frequency !== 'MONTHLY') return null;
    const day = parseInt(dayOfMonth);
    if (isNaN(day) || day < 1 || day > 28) return null;
    const today = new Date();
    const currentDay = today.getDate();
    let targetYear = today.getFullYear();
    let targetMonth = today.getMonth(); // 0-based
    if (day < currentDay) {
      // Dia já passou este mês — primeira cobrança será no mês seguinte
      targetMonth += 1;
      if (targetMonth > 11) { targetMonth = 0; targetYear += 1; }
    }
    const dd = String(day).padStart(2, '0');
    const mm = String(targetMonth + 1).padStart(2, '0');
    return day < currentDay
      ? `A primeira cobranca sera em ${dd}/${mm}/${targetYear} (proximo mes)`
      : null;
  }, [frequency, dayOfMonth]);
  const [loading, setLoading] = useState(false);
  const [hasSubaccount, setHasSubaccount] = useState(false);
  const [subaccountCreating, setSubaccountCreating] = useState(false);

  useEffect(() => {
    const checkOnboarding = async () => {
      try {
        const onboardingStatus: any = await paymentService.checkOnboarding();
        if (onboardingStatus?.exists) {
          setHasSubaccount(true);
        } else if (onboardingStatus?.creating) {
          setSubaccountCreating(true);
          Alert.alert(
            'Conta em configuracao',
            'Sua conta de recebimentos esta sendo configurada. Aguarde alguns instantes e tente novamente.'
          );
        } else {
          Alert.alert(
            'Atencao',
            'Uma subconta no Asaas sera criada automaticamente para voce receber os pagamentos.'
          );
        }
      } catch (error) {
        console.error('Error checking onboarding:', error);
      }
    };
    checkOnboarding();
  }, [landlordId]);

  const handleCreateContract = async () => {
    if (subaccountCreating) {
      Alert.alert('Aguarde', 'Sua conta de recebimentos ainda esta sendo configurada. Tente novamente em instantes.');
      return;
    }

    const amount = parseFloat(rentAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Erro', 'Por favor, insira um valor de aluguel válido.');
      return;
    }

    if (frequency === 'MONTHLY') {
      const day = parseInt(dayOfMonth);
      if (isNaN(day) || day < 1 || day > 28) {
        Alert.alert('Erro', 'O dia de vencimento deve ser entre 1 e 28.');
        return;
      }
    }

    if (startDate.length < 10) {
      Alert.alert('Erro', 'Por favor, insira uma data de início válida (DD/MM/AAAA).');
      return;
    }
    const startDateISO = parseDateToISO(startDate);
    const today = new Date().toISOString().split('T')[0];
    if (startDateISO < today) {
      Alert.alert('Erro', 'A data de início não pode ser no passado.');
      return;
    }

    const currentUid = auth().currentUser?.uid;
    if (!currentUid || currentUid !== landlordId) {
      Alert.alert('Erro', 'Nao autorizado.');
      return;
    }

    setLoading(true);
    try {
      // Verificar se já existe contrato ativo para este carro
      const existingContract = await paymentService.getContractByCar(carId);
      if (existingContract && existingContract.id) {
        Alert.alert('Contrato existente', 'Este carro já possui um contrato de pagamento ativo.');
        setLoading(false);
        return;
      }

      if (!hasSubaccount) {
        const onboardingResult: any = await paymentService.createSubaccount();
        if (onboardingResult && onboardingResult.success === false) {
          throw new Error(onboardingResult.error || 'Falha ao criar subconta no Asaas.');
        }
      }

      const contractData = {
        carId,
        tenantId,
        landlordId,
        rentAmount: amount,
        frequency,
        startDate: startDateISO,
        nextDueDate: startDateISO,
        dayOfMonth: frequency === 'MONTHLY' ? parseInt(dayOfMonth) : null,
        billingType,
        carInfo,
        tenantName,
        landlordName,
      };

      const result: any = await paymentService.createContract(contractData);

      if (result && result.success) {
        showMessage({ message: 'Contrato criado!', type: 'success' });
        navigation.goBack();
      } else {
        throw new Error(result?.error || 'Erro ao salvar contrato.');
      }
    } catch (error: any) {
      console.error('Error creating contract:', error);
      Alert.alert('Erro', error.message || 'Falha ao criar contrato.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Configurar Pagamento</Text>
        <Text style={styles.subtitle}>{carInfo}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Valor do Aluguel (R$)</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          value={rentAmount}
          onChangeText={setRentAmount}
          placeholder="Ex: 1500.00"
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Frequência</Text>
        <View style={styles.row}>
          {(['MONTHLY', 'BIWEEKLY', 'WEEKLY'] as const).map((freq) => (
            <TouchableOpacity
              key={freq}
              style={[styles.freqButton, frequency === freq && styles.activeButton]}
              onPress={() => setFrequency(freq)}
            >
              <Text style={[styles.freqText, frequency === freq && styles.activeText]}>
                {freq === 'MONTHLY' ? 'Mensal' : freq === 'BIWEEKLY' ? 'Quinzenal' : 'Semanal'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {frequency === 'MONTHLY' && (
        <View style={styles.card}>
          <Text style={styles.label}>Dia de vencimento (1-28)</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={dayOfMonth}
            onChangeText={setDayOfMonth}
            placeholder="1"
          />
          {firstMonthlyChargeHint ? (
            <Text style={styles.hintText}>{firstMonthlyChargeHint}</Text>
          ) : null}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.label}>Método preferido</Text>
        <View style={styles.row}>
          {(['PIX', 'BOLETO', 'CREDIT_CARD'] as const).map((type) => (
            <TouchableOpacity
              key={type}
              style={[styles.freqButton, billingType === type && styles.activeButton]}
              onPress={() => setBillingType(type)}
            >
              <Text style={[styles.freqText, billingType === type && styles.activeText]}>
                {type === 'PIX' ? 'PIX' : type === 'BOLETO' ? 'Boleto' : 'Cartão'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Data de início</Text>
        <TextInput
          style={styles.input}
          value={startDate}
          onChangeText={(text) => setStartDate(formatDateInput(text))}
          placeholder="DD/MM/AAAA"
          keyboardType="numeric"
          maxLength={10}
        />
      </View>

      <TouchableOpacity
        style={[styles.saveButton, subaccountCreating && { opacity: 0.5 }]}
        onPress={handleCreateContract}
        disabled={loading || subaccountCreating}
      >
        {loading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.saveButtonText}>Criar Contrato</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    marginBottom: 24,
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
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4B5563',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#1F2937',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  freqButton: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  activeButton: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  freqText: {
    color: '#4B5563',
    fontWeight: '500',
  },
  activeText: {
    color: '#FFFFFF',
  },
  saveButton: {
    backgroundColor: '#4F46E5',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 32,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  hintText: {
    marginTop: 8,
    fontSize: 13,
    color: '#4F46E5',
    fontWeight: '500',
  },
});

export default PaymentContractScreen;
