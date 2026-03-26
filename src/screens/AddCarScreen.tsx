// src/screens/AddCarScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { showMessage } from 'react-native-flash-message';
import { authService } from '../services/authService';
import { carsService } from '../services/carsService';
import PhotoPicker from '../components/PhotoPicker';
import DocumentPicker from '../components/DocumentPicker';

// Tipos de documentos do veiculo
const CAR_DOC_TYPES = [
  { key: 'crlve', label: 'CRLV-e', description: 'Certificado de Registro e Licenciamento do Veiculo' },
  { key: 'ipva', label: 'IPVA', description: 'Comprovante de pagamento do IPVA' },
  { key: 'licenciamento', label: 'Licenciamento Anual', description: 'Documento do licenciamento anual' },
  { key: 'seguro', label: 'Seguro', description: 'Apolice ou contrato do seguro' },
  { key: 'crv', label: 'CRV', description: 'Certificado de Registro do Veiculo' },
];

const AddCarScreen = ({ navigation }) => {
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [plate, setPlate] = useState('');
  const [color, setColor] = useState('');
  const [initialKm, setInitialKm] = useState('');
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showDocs, setShowDocs] = useState(false);

  // Documentos do veiculo (cada um pode ser PDF ou foto)
  const [documents, setDocuments] = useState({});

  const handleDocSelected = (key, docData) => {
    if (docData) {
      setDocuments(prev => ({ ...prev, [key]: docData }));
    } else {
      setDocuments(prev => {
        const updated = { ...prev };
        delete updated[key];
        return updated;
      });
    }
  };

  const getDocCount = () => Object.keys(documents).length;

  const handleAddCar = async () => {
    if (!brand || !model || !year || !plate || !initialKm) {
      Alert.alert('Erro', 'Preencha todos os campos obrigatorios');
      return;
    }

    const yearNum = parseInt(year);
    if (isNaN(yearNum) || yearNum < 1900 || yearNum > new Date().getFullYear() + 1) {
      Alert.alert('Erro', 'Ano invalido');
      return;
    }

    const kmNum = parseInt(initialKm);
    if (isNaN(kmNum) || kmNum < 0) {
      Alert.alert('Erro', 'Quilometragem invalida');
      return;
    }

    setLoading(true);

    const currentUser = authService.getCurrentUser();
    const carData = {
      landlordId: currentUser.uid,
      brand,
      model,
      year: yearNum,
      plate: plate.toUpperCase(),
      color: color || 'Nao especificado',
      initialKm: kmNum,
      totalKm: kmNum,
      photo: photo || null,
      lastOilChangeKm: kmNum,
    };

    // Adicionar documentos se existirem
    if (getDocCount() > 0) {
      carData.documents = documents;
    }

    const result = await carsService.addCar(carData);
    setLoading(false);

    if (result.success) {
      showMessage({ message: 'Carro adicionado com sucesso!', type: 'success' });
      navigation.goBack();
    } else {
      Alert.alert('Erro', result.error);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Adicionar Novo Carro</Text>
          <Text style={styles.subtitle}>Preencha as informacoes do veiculo</Text>
        </View>

        <View style={styles.form}>
          <PhotoPicker label="Foto do Carro (Opcional)" onPhotoSelected={setPhoto} currentPhotoUrl={photo} />

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Marca *</Text>
            <TextInput style={styles.input} placeholderTextColor="#9CA3AF" placeholder="Ex: Toyota, Ford, Chevrolet"
              value={brand} onChangeText={setBrand} autoCapitalize="words" />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Modelo *</Text>
            <TextInput style={styles.input} placeholderTextColor="#9CA3AF" placeholder="Ex: Corolla, Fiesta, Onix"
              value={model} onChangeText={setModel} autoCapitalize="words" />
          </View>

          <View style={styles.row}>
            <View style={[styles.inputContainer, styles.flex1]}>
              <Text style={styles.label}>Ano *</Text>
              <TextInput style={styles.input} placeholderTextColor="#9CA3AF" placeholder="2020"
                value={year} onChangeText={setYear} keyboardType="numeric" maxLength={4} />
            </View>
            <View style={[styles.inputContainer, styles.flex1, styles.marginLeft]}>
              <Text style={styles.label}>Cor</Text>
              <TextInput style={styles.input} placeholderTextColor="#9CA3AF" placeholder="Branco"
                value={color} onChangeText={setColor} autoCapitalize="words" />
            </View>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Placa *</Text>
            <TextInput style={styles.input} placeholderTextColor="#9CA3AF" placeholder="ABC-1234"
              value={plate} onChangeText={setPlate} autoCapitalize="characters" maxLength={8} />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Quilometragem Atual *</Text>
            <TextInput style={styles.input} placeholderTextColor="#9CA3AF" placeholder="50000"
              value={initialKm} onChangeText={setInitialKm} keyboardType="numeric" />
            <Text style={styles.hint}>Informe a quilometragem atual do veiculo em KM</Text>
          </View>

          {/* ===== DOCUMENTOS DO VEICULO (OPCIONAL) ===== */}
          <View style={styles.docsSection}>
            <TouchableOpacity style={styles.docsToggle} onPress={() => setShowDocs(!showDocs)}>
              <View>
                <Text style={styles.docsSectionTitle}>Documentos do Veiculo (Opcional)</Text>
                <Text style={styles.docsHint}>
                  {getDocCount() > 0
                    ? `${getDocCount()} documento${getDocCount() > 1 ? 's' : ''} anexado${getDocCount() > 1 ? 's' : ''}`
                    : 'CRLV-e, IPVA, Licenciamento, Seguro, CRV'}
                </Text>
              </View>
              <Text style={styles.docsToggleIcon}>{showDocs ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            {showDocs && (
              <View style={styles.docsContent}>
                <Text style={styles.docsInfo}>
                  Anexe os documentos em PDF ou foto. Eles ficarao disponiveis na tela de detalhes do carro.
                </Text>

                {CAR_DOC_TYPES.map((docType) => (
                  <View key={docType.key} style={styles.docItem}>
                    <View style={styles.docItemHeader}>
                      <Text style={styles.docItemLabel}>{docType.label}</Text>
                      {documents[docType.key] && <Text style={styles.docItemCheck}>✓</Text>}
                    </View>
                    <Text style={styles.docItemDesc}>{docType.description}</Text>
                    <DocumentPicker
                      label={`Anexar ${docType.label}`}
                      onDocumentSelected={(data) => handleDocSelected(docType.key, data)}
                      currentDocument={documents[docType.key] || null}
                    />
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.buttonContainer}>
            <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleAddCar} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Adicionar Carro</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={() => navigation.goBack()} disabled={loading}>
              <Text style={styles.cancelButtonText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { padding: 24 },
  header: { marginBottom: 24, marginTop: 24 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1F2937', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#6B7280' },
  form: { width: '100%' },
  inputContainer: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#F9FAFB', color: '#1F2937' },
  hint: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  row: { flexDirection: 'row', marginBottom: 0 },
  flex1: { flex: 1 },
  marginLeft: { marginLeft: 12 },
  // Docs section
  docsSection: { marginBottom: 24, backgroundColor: '#F9FAFB', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', overflow: 'hidden' },
  docsToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  docsSectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#1F2937' },
  docsHint: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  docsToggleIcon: { fontSize: 16, color: '#6B7280' },
  docsContent: { padding: 16, paddingTop: 0, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  docsInfo: { fontSize: 13, color: '#6B7280', marginBottom: 16, marginTop: 12, lineHeight: 18 },
  docItem: { marginBottom: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  docItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  docItemLabel: { fontSize: 15, fontWeight: 'bold', color: '#1F2937' },
  docItemCheck: { fontSize: 16, color: '#059669', fontWeight: 'bold' },
  docItemDesc: { fontSize: 12, color: '#6B7280', marginBottom: 8 },
  // Buttons
  buttonContainer: { marginTop: 24 },
  button: { backgroundColor: '#4F46E5', padding: 16, borderRadius: 8, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cancelButton: { padding: 16, alignItems: 'center', marginTop: 12 },
  cancelButtonText: { color: '#6B7280', fontSize: 16, fontWeight: '600' },
});

export default AddCarScreen;
