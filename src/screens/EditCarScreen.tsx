// src/screens/EditCarScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { carsService } from '../services/carsService';
import PhotoPicker from '../components/PhotoPicker';
import DocumentPicker from '../components/DocumentPicker';

const CAR_DOC_TYPES = [
  { key: 'crlve', label: 'CRLV-e', description: 'Certificado de Registro e Licenciamento do Veiculo' },
  { key: 'ipva', label: 'IPVA', description: 'Comprovante de pagamento do IPVA' },
  { key: 'licenciamento', label: 'Licenciamento Anual', description: 'Documento do licenciamento anual' },
  { key: 'seguro', label: 'Seguro', description: 'Apolice ou contrato do seguro' },
  { key: 'crv', label: 'CRV', description: 'Certificado de Registro do Veiculo' },
];

const EditCarScreen = ({ route, navigation }) => {
  const { carId } = route.params;

  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [plate, setPlate] = useState('');
  const [color, setColor] = useState('');
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [showDocs, setShowDocs] = useState(false);
  const [documents, setDocuments] = useState({});

  useEffect(() => { loadCarData(); }, []);

  const loadCarData = async () => {
    const result = await carsService.getCarById(carId);
    if (result.success) {
      const car = result.data;
      setBrand(car.brand || '');
      setModel(car.model || '');
      setYear(String(car.year || ''));
      setPlate(car.plate || '');
      setColor(car.color || '');
      setPhoto(car.photo || null);
      // Carregar documentos existentes
      if (car.documents) {
        setDocuments(car.documents);
      }
    } else {
      Alert.alert('Erro', 'Carro nao encontrado');
      navigation.goBack();
    }
    setLoadingData(false);
  };

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

  const handleUpdateCar = async () => {
    if (!brand || !model || !year || !plate) {
      Alert.alert('Erro', 'Preencha todos os campos obrigatorios');
      return;
    }

    const yearNum = parseInt(year);
    if (isNaN(yearNum) || yearNum < 1900 || yearNum > new Date().getFullYear() + 1) {
      Alert.alert('Erro', 'Ano invalido');
      return;
    }

    setLoading(true);

    const updates = {
      brand,
      model,
      year: yearNum,
      plate: plate.toUpperCase(),
      color: color || 'Nao especificado',
      photo: photo || null,
      documents: getDocCount() > 0 ? documents : null,
    };

    const result = await carsService.updateCar(carId, updates);
    setLoading(false);

    if (result.success) {
      Alert.alert('Sucesso', 'Carro atualizado com sucesso!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } else {
      Alert.alert('Erro', result.error);
    }
  };

  if (loadingData) {
    return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#4F46E5" /></View>;
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.form}>
          <PhotoPicker label="Foto do Carro" onPhotoSelected={setPhoto} currentPhotoUrl={photo} />

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

          {/* ===== DOCUMENTOS DO VEICULO ===== */}
          <View style={styles.docsSection}>
            <TouchableOpacity style={styles.docsToggle} onPress={() => setShowDocs(!showDocs)}>
              <View>
                <Text style={styles.docsSectionTitle}>Documentos do Veiculo</Text>
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
                  Anexe ou atualize os documentos em PDF ou foto.
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
              onPress={handleUpdateCar} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Salvar Alteracoes</Text>}
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
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { padding: 24 },
  form: { width: '100%' },
  inputContainer: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#F9FAFB', color: '#1F2937' },
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

export default EditCarScreen;
