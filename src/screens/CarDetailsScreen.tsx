// src/screens/CarDetailsScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, ScrollView,
  Alert, ActivityIndicator, TextInput, Modal, Linking, KeyboardAvoidingView, Platform,
} from 'react-native';
import { authService } from '../services/authService';
import { carsService } from '../services/carsService';
import { tasksService, TASK_TYPES } from '../services/tasksService';
import { usersService } from '../services/usersService';
import { getPdfPreviewUrl, getPdfFullUrl } from '../config/cloudinary';
import PdfViewer from '../components/PdfViewer';
import ImageViewer from '../components/ImageViewer';

const DOC_LABELS = {
  crlve: 'CRLV-e',
  ipva: 'IPVA',
  licenciamento: 'Licenciamento Anual',
  seguro: 'Seguro',
  crv: 'CRV',
};

const CarDetailsScreen = ({ route, navigation }) => {
  const { carId } = route.params;
  const [car, setCar] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [tenantInfo, setTenantInfo] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [maintenanceDesc, setMaintenanceDesc] = useState('');
  const [maintenanceType, setMaintenanceType] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);
  const [dueDateText, setDueDateText] = useState('');
  const [pdfViewer, setPdfViewer] = useState({ visible: false, url: null, title: '' });
  const [imageViewer, setImageViewer] = useState({ visible: false, url: null, title: '' });

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => { loadCarDetails(); });
    return unsubscribe;
  }, [navigation]);

  const loadCarDetails = async () => {
    setLoading(true);
    const currentUser = authService.getCurrentUser();
    if (currentUser) {
      const profileResult = await authService.getCurrentUserProfile(currentUser.uid);
      if (profileResult.success) setUserProfile(profileResult.data);
    }

    const carResult = await carsService.getCarById(carId);
    if (carResult.success) {
      setCar(carResult.data);
      if (carResult.data.tenantId) {
        const tenantResult = await usersService.getUserById(carResult.data.tenantId);
        if (tenantResult.success) setTenantInfo(tenantResult.data);
      } else {
        setTenantInfo(null);
      }
    }

    const tasksResult = await tasksService.getCarTasks(carId, 'pending');
    if (tasksResult.success) setTasks(tasksResult.data);
    const completedResult = await tasksService.getCarTasks(carId, 'completed');
    if (completedResult.success) setCompletedTasks(completedResult.data);
    setLoading(false);
  };

  const handleDeleteCar = () => {
    Alert.alert('Deletar Carro', 'Tem certeza? Esta acao nao pode ser desfeita.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Deletar', style: 'destructive', onPress: async () => {
        const result = await carsService.deleteCar(carId);
        if (result.success) Alert.alert('Sucesso', 'Carro deletado!', [{ text: 'OK', onPress: () => navigation.goBack() }]);
        else Alert.alert('Erro', result.error);
      }},
    ]);
  };

  const parseDueDate = (text) => {
    if (!text || text.length < 10) return null;
    const parts = text.split('/');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const year = parseInt(parts[2]);
    const date = new Date(year, month, day, 23, 59, 59);
    if (isNaN(date.getTime()) || date <= new Date()) return null;
    return date;
  };

  const formatDueDateInput = (text) => {
    const clean = text.replace(/\D/g, '');
    if (clean.length <= 2) return clean;
    if (clean.length <= 4) return clean.slice(0, 2) + '/' + clean.slice(2);
    return clean.slice(0, 2) + '/' + clean.slice(2, 4) + '/' + clean.slice(4, 8);
  };

  const handleRequestTask = async (taskType) => {
    if (!car.tenantId) { Alert.alert('Erro', 'Este carro nao tem locatario atribuido.'); return; }

    // Validar due date
    const dueDate = parseDueDate(dueDateText);
    if (!dueDateText.trim()) {
      Alert.alert('Erro', 'Defina uma data limite para a tarefa.');
      return;
    }
    if (!dueDate) {
      Alert.alert('Erro', 'Data limite invalida. Use o formato DD/MM/AAAA e uma data futura.');
      return;
    }

    const extraData = { dueDate };
    if (taskDesc.trim()) extraData.description = taskDesc;
    if (taskType === TASK_TYPES.MAINTENANCE) {
      extraData.requestedBy = authService.getCurrentUser()?.uid;
      extraData.requestedByRole = 'locador';
      extraData.maintenanceType = maintenanceType || 'geral';
    }
    const result = await tasksService.createManualTask(carId, taskType, extraData);
    if (result.success) {
      Alert.alert('Sucesso', 'Tarefa solicitada ao locatario!');
      setShowTaskModal(false); setTaskDesc(''); setDueDateText(''); loadCarDetails();
    } else { Alert.alert('Erro', result.error); }
  };

  const handleRequestMaintenance = async () => {
    if (!maintenanceDesc.trim()) { Alert.alert('Erro', 'Descreva o problema ou a manutencao necessaria.'); return; }
    const result = await tasksService.createMaintenanceRequest(carId, authService.getCurrentUser()?.uid, maintenanceDesc, maintenanceType);
    if (result.success) {
      Alert.alert('Sucesso', 'Solicitacao de manutencao enviada ao locador!');
      setShowMaintenanceModal(false); setMaintenanceDesc(''); setMaintenanceType(''); loadCarDetails();
    } else { Alert.alert('Erro', result.error); }
  };

  const handleRemoveTenant = () => {
    Alert.alert(
      'Remover Locatario',
      `Deseja remover o locatario "${tenantInfo?.name}" deste carro?\n\nIsso ira:\n- Voltar o carro para "Disponivel"\n- Cancelar todas as tarefas pendentes`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Remover', style: 'destructive', onPress: async () => {
          const result = await carsService.removeTenant(carId);
          if (result.success) { Alert.alert('Sucesso', 'Locatario removido.'); loadCarDetails(); }
          else Alert.alert('Erro', result.error);
        }},
      ]
    );
  };

  const formatDate = (timestamp) => {
    if (!timestamp || !timestamp.toDate) return 'N/A';
    try { return timestamp.toDate().toLocaleDateString('pt-BR'); } catch { return 'N/A'; }
  };

  const getTaskIcon = (type) => {
    switch (type) {
      case 'km_update': return '📍'; case 'photo_inspection': return '📸';
      case 'oil_change': return '🛢'; case 'maintenance': return '🔧'; default: return '📋';
    }
  };

  const formatCpf = (cpf) => {
    if (!cpf) return '';
    const c = cpf.replace(/\D/g, '');
    if (c.length !== 11) return cpf;
    return c.slice(0, 3) + '.' + c.slice(3, 6) + '.' + c.slice(6, 9) + '-' + c.slice(9);
  };

  const openDocument = (url, docType, docLabel) => {
    if (!url) return;
    if (docType === 'pdf') {
      setPdfViewer({ visible: true, url, title: docLabel || 'Documento' });
    } else {
      setImageViewer({ visible: true, url, title: docLabel || 'Foto' });
    }
  };

  const getDocumentCount = () => {
    if (!car?.documents) return 0;
    return Object.keys(car.documents).length;
  };

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#4F46E5" /></View>;
  if (!car) return <View style={styles.errorContainer}><Text style={styles.errorText}>Carro nao encontrado</Text></View>;

  const isLandlord = userProfile?.role === 'locador';
  const isTenant = userProfile?.role === 'locatario';

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <ScrollView style={styles.container}>
      {car.photo ? (
        <Image source={{ uri: car.photo }} style={styles.carPhoto} />
      ) : (
        <View style={styles.noPhoto}><Text style={styles.noPhotoText}>🚗</Text></View>
      )}

      <View style={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{car.brand}</Text>
            <Text style={styles.model}>{car.model}</Text>
          </View>
          <View style={[styles.statusBadge, car.status === 'rented' && styles.statusRented]}>
            <Text style={styles.statusText}>{car.status === 'rented' ? 'Alugado' : 'Disponivel'}</Text>
          </View>
        </View>

        <View style={styles.detailsGrid}>
          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>Ano</Text>
            <Text style={styles.detailValue}>{car.year}</Text>
          </View>
          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>Placa</Text>
            <Text style={styles.detailValue}>{car.plate}</Text>
          </View>
          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>Cor</Text>
            <Text style={styles.detailValue}>{car.color || 'N/A'}</Text>
          </View>
          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>Quilometragem</Text>
            <Text style={styles.detailValue}>{car.totalKm?.toLocaleString() || 0} km</Text>
          </View>
        </View>

        {/* ===== DOCUMENTOS DO VEICULO ===== */}
        {getDocumentCount() > 0 && (
          <View style={styles.section}>
            <TouchableOpacity onPress={() => setShowDocuments(!showDocuments)}>
              <Text style={styles.sectionTitle}>
                Documentos ({getDocumentCount()}) {showDocuments ? '▲' : '▼'}
              </Text>
            </TouchableOpacity>

            {showDocuments && Object.entries(car.documents).map(([key, doc]) => {
              const previewUri = doc.type === 'pdf'
                ? (doc.preview || getPdfPreviewUrl(doc.url))
                : doc.url;
              return (
                <View key={key} style={styles.documentCard}>
                  <View style={styles.documentHeader}>
                    <Text style={styles.documentName}>{DOC_LABELS[key] || key}</Text>
                    {doc.type === 'pdf' && (
                      <View style={styles.pdfTag}><Text style={styles.pdfTagText}>PDF</Text></View>
                    )}
                  </View>
                  {previewUri && (
                    <Image source={{ uri: previewUri }} style={styles.documentPreview} resizeMode="cover" />
                  )}
                  <TouchableOpacity style={styles.documentOpenBtn} onPress={() => openDocument(doc.url, doc.type, DOC_LABELS[key])}>
                    <Text style={styles.documentOpenText}>Visualizar em Tela Cheia</Text>
                    <Text style={styles.documentArrow}>→</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {/* Locatario */}
        {tenantInfo && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Locatario</Text>
            <View style={styles.tenantCard}>
              <View style={styles.tenantAvatar}>
                <Text style={styles.tenantAvatarText}>{tenantInfo.name?.charAt(0)?.toUpperCase()}</Text>
              </View>
              <View style={styles.tenantMainInfo}>
                <Text style={styles.tenantName}>{tenantInfo.name}</Text>
                <Text style={styles.tenantEmail}>{tenantInfo.email}</Text>
                {tenantInfo.phone && <Text style={styles.tenantPhone}>{tenantInfo.phone}</Text>}
                {tenantInfo.cpf && <Text style={styles.tenantCpf}>CPF: {formatCpf(tenantInfo.cpf)}</Text>}
              </View>
            </View>
            {isLandlord && car.tenantId && (
              <TouchableOpacity style={styles.viewTenantBtn}
                onPress={() => navigation.navigate('TenantDetails', { tenantId: car.tenantId })}>
                <Text style={styles.viewTenantBtnText}>Ver Dados Completos do Locatario</Text>
                <Text style={styles.viewTenantArrow}>→</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Acoes do Locador */}
        {isLandlord && (
          <View style={styles.actionsSection}>
            <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('EditCar', { carId: car.id })}>
              <Text style={styles.actionButtonText}>Editar Carro</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('AssignTenant', { carId: car.id })}>
              <Text style={styles.actionButtonText}>{car.tenantId ? 'Alterar Locatario' : 'Atribuir Locatario'}</Text>
            </TouchableOpacity>
            {car.tenantId && (
              <TouchableOpacity style={[styles.actionButton, styles.removeTenantButton]} onPress={handleRemoveTenant}>
                <Text style={styles.removeTenantText}>Remover Locatario</Text>
              </TouchableOpacity>
            )}
            {car.tenantId && (
              <TouchableOpacity style={[styles.actionButton, styles.requestButton]} onPress={() => setShowTaskModal(true)}>
                <Text style={styles.actionButtonText}>Solicitar Tarefa ao Locatario</Text>
              </TouchableOpacity>
            )}
            {car.tenantId && (
              <TouchableOpacity style={[styles.actionButton, styles.financialButton]} onPress={() => navigation.navigate('Charges', {
                carId: car.id,
                landlordId: car.landlordId,
                tenantId: car.tenantId,
                carInfo: `${car.brand} ${car.model} (${car.plate})`,
                tenantName: tenantInfo?.name || '',
                landlordName: userProfile?.name || '',
              })}>
                <Text style={styles.actionButtonText}>Cobranças</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Acao do Locatario */}
        {isTenant && (
          <View style={styles.actionsSection}>
            <TouchableOpacity style={[styles.actionButton, styles.maintenanceButton]} onPress={() => setShowMaintenanceModal(true)}>
              <Text style={styles.actionButtonText}>Solicitar Manutencao</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Tarefas Pendentes */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tarefas Pendentes ({tasks.length})</Text>
          {tasks.length === 0 ? (
            <View style={styles.emptyTasks}><Text style={styles.emptyTasksText}>Nenhuma tarefa pendente</Text></View>
          ) : tasks.map((task) => (
            <TouchableOpacity key={task.id} style={styles.taskItem}
              onPress={() => navigation.navigate('TaskDetails', { taskId: task.id, carId: task.carId })}>
              <Text style={styles.taskTitle}>{getTaskIcon(task.type)} {task.title}</Text>
              <Text style={styles.taskArrow}>></Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tarefas Concluidas */}
        {isLandlord && completedTasks.length > 0 && (
          <View style={styles.section}>
            <TouchableOpacity onPress={() => setShowCompletedTasks(!showCompletedTasks)}>
              <Text style={styles.sectionTitle}>
                Tarefas Concluidas ({completedTasks.length}) {showCompletedTasks ? '▲' : '▼'}
              </Text>
            </TouchableOpacity>
            {showCompletedTasks && completedTasks.map((task) => (
              <TouchableOpacity key={task.id} style={[styles.taskItem, styles.completedTaskItem]}
                onPress={() => navigation.navigate('TaskDetails', { taskId: task.id, carId: task.carId })}>
                <View>
                  <Text style={styles.taskTitle}>{getTaskIcon(task.type)} {task.title}</Text>
                  <Text style={styles.completedDate}>{formatDate(task.completedAt)}</Text>
                </View>
                <Text style={styles.taskArrow}>></Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Manutencao */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Manutencao</Text>
          {car.lastOilChangeKm !== undefined && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Ultima troca de oleo:</Text>
              <Text style={styles.infoValue}>{car.lastOilChangeKm.toLocaleString()} km</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Ultima atualizacao KM:</Text>
            <Text style={styles.infoValue}>{formatDate(car.lastKmUpdate)}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Ultima inspecao:</Text>
            <Text style={styles.infoValue}>{formatDate(car.lastPhotoInspection)}</Text>
          </View>
        </View>

        {isLandlord && (
          <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteCar}>
            <Text style={styles.deleteButtonText}>Deletar Carro</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Modal: Solicitar Tarefa */}
      <Modal visible={showTaskModal} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentInner}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Solicitar Tarefa</Text>
              <TouchableOpacity onPress={() => { setShowTaskModal(false); setTaskDesc(''); setDueDateText(''); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.modalCloseIcon}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Escolha o tipo de tarefa para o locatario</Text>
            <View style={styles.inputContainer}>
              <Text style={styles.modalLabel}>Data Limite *</Text>
              <TextInput style={styles.modalInput} placeholder="DD/MM/AAAA"
                placeholderTextColor="#9CA3AF"
                value={dueDateText} onChangeText={(t) => setDueDateText(formatDueDateInput(t))}
                keyboardType="numeric" maxLength={10} />
              <Text style={styles.inputHint}>A tarefa deve ser concluida ate esta data</Text>
            </View>
            <View style={styles.inputContainer}>
              <Text style={styles.modalLabel}>Observacao (opcional)</Text>
              <TextInput style={styles.modalInput} placeholder="Adicione uma observacao..."
                placeholderTextColor="#9CA3AF"
                value={taskDesc} onChangeText={setTaskDesc} multiline />
            </View>
            <TouchableOpacity style={styles.taskOptionButton} onPress={() => handleRequestTask(TASK_TYPES.KM_UPDATE)}>
              <Text style={styles.taskOptionIcon}>📍</Text>
              <View style={styles.taskOptionInfo}><Text style={styles.taskOptionTitle}>Atualizacao de KM</Text><Text style={styles.taskOptionDesc}>Locatario envia KM + foto do painel</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.taskOptionButton} onPress={() => handleRequestTask(TASK_TYPES.PHOTO_INSPECTION)}>
              <Text style={styles.taskOptionIcon}>📸</Text>
              <View style={styles.taskOptionInfo}><Text style={styles.taskOptionTitle}>Revisao Fotografica</Text><Text style={styles.taskOptionDesc}>9 angulos com 1+ foto cada</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.taskOptionButton} onPress={() => handleRequestTask(TASK_TYPES.OIL_CHANGE)}>
              <Text style={styles.taskOptionIcon}>🛢</Text>
              <View style={styles.taskOptionInfo}><Text style={styles.taskOptionTitle}>Troca de Oleo</Text><Text style={styles.taskOptionDesc}>KM + foto do adesivo + recibo</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.taskOptionButton} onPress={() => handleRequestTask(TASK_TYPES.MAINTENANCE)}>
              <Text style={styles.taskOptionIcon}>🔧</Text>
              <View style={styles.taskOptionInfo}><Text style={styles.taskOptionTitle}>Manutencao</Text><Text style={styles.taskOptionDesc}>Locatario registra manutencao</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCancelButton} onPress={() => { setShowTaskModal(false); setTaskDesc(''); setDueDateText(''); }}>
              <Text style={styles.modalCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal: Solicitar Manutencao */}
      <Modal visible={showMaintenanceModal} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentInner}>
            <Text style={styles.modalTitle}>Solicitar Manutencao</Text>
            <View style={styles.inputContainer}>
              <Text style={styles.modalLabel}>Tipo de Manutencao</Text>
              <TextInput style={styles.modalInput} placeholder="Ex: Freios, Pneus, Motor..."
                placeholderTextColor="#9CA3AF"
                value={maintenanceType} onChangeText={setMaintenanceType} />
            </View>
            <View style={styles.inputContainer}>
              <Text style={styles.modalLabel}>Descricao do Problema *</Text>
              <TextInput style={[styles.modalInput, styles.textArea]} placeholder="Descreva o problema..."
                placeholderTextColor="#9CA3AF"
                value={maintenanceDesc} onChangeText={setMaintenanceDesc} multiline numberOfLines={4} />
            </View>
            <TouchableOpacity style={styles.modalButton} onPress={handleRequestMaintenance}>
              <Text style={styles.modalButtonText}>Enviar Solicitacao</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCancelButton}
              onPress={() => { setShowMaintenanceModal(false); setMaintenanceDesc(''); setMaintenanceType(''); }}>
              <Text style={styles.modalCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Visualizador PDF multi-pagina */}
      <PdfViewer visible={pdfViewer.visible} pdfUrl={pdfViewer.url} title={pdfViewer.title}
        onClose={() => setPdfViewer({ visible: false, url: null, title: '' })} />

      {/* Visualizador de imagem com zoom */}
      <ImageViewer visible={imageViewer.visible} imageUrl={imageViewer.url} title={imageViewer.title}
        onClose={() => setImageViewer({ visible: false, url: null, title: '' })} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  keyboardAvoid: { flex: 1, backgroundColor: '#F3F4F6' },
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: '#6B7280' },
  carPhoto: { width: '100%', height: 250, backgroundColor: '#E5E7EB' },
  noPhoto: { width: '100%', height: 250, backgroundColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center' },
  noPhotoText: { fontSize: 80 },
  content: { padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  brand: { fontSize: 14, fontWeight: '600', color: '#6B7280', textTransform: 'uppercase' },
  model: { fontSize: 28, fontWeight: 'bold', color: '#1F2937', marginTop: 4 },
  statusBadge: { backgroundColor: '#D1FAE5', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  statusRented: { backgroundColor: '#FEE2E2' },
  statusText: { fontSize: 12, fontWeight: '600' },
  detailsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  detailCard: { backgroundColor: '#fff', padding: 16, borderRadius: 12, width: '48%' },
  detailLabel: { fontSize: 12, color: '#6B7280', marginBottom: 4 },
  detailValue: { fontSize: 18, fontWeight: 'bold', color: '#1F2937' },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937', marginBottom: 12 },
  // Documents
  documentCard: { backgroundColor: '#fff', borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB', overflow: 'hidden' },
  documentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  documentName: { fontSize: 15, fontWeight: '600', color: '#1F2937' },
  pdfTag: { backgroundColor: '#DC2626', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  pdfTagText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  documentPreview: { width: '100%', height: 180, backgroundColor: '#F3F4F6' },
  documentOpenBtn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  documentOpenText: { fontSize: 14, fontWeight: '600', color: '#4F46E5' },
  documentArrow: { fontSize: 18, color: '#4F46E5', fontWeight: 'bold' },
  // Tenant
  tenantCard: { backgroundColor: '#fff', padding: 16, borderRadius: 12, flexDirection: 'row', alignItems: 'center' },
  tenantAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#EEF2FF', justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  tenantAvatarText: { fontSize: 22, fontWeight: 'bold', color: '#4F46E5' },
  tenantMainInfo: { flex: 1 },
  tenantName: { fontSize: 16, fontWeight: 'bold', color: '#1F2937', marginBottom: 2 },
  tenantEmail: { fontSize: 13, color: '#6B7280' },
  tenantPhone: { fontSize: 13, color: '#6B7280', marginTop: 1 },
  tenantCpf: { fontSize: 13, color: '#4F46E5', fontWeight: '600', marginTop: 2 },
  viewTenantBtn: { backgroundColor: '#EEF2FF', padding: 14, borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: '#C7D2FE' },
  viewTenantBtnText: { fontSize: 14, fontWeight: '700', color: '#4F46E5' },
  viewTenantArrow: { fontSize: 18, color: '#4F46E5' },
  // Actions
  actionsSection: { marginBottom: 24, gap: 12 },
  actionButton: { backgroundColor: '#4F46E5', padding: 16, borderRadius: 12, alignItems: 'center' },
  requestButton: { backgroundColor: '#059669' },
  removeTenantButton: { backgroundColor: '#FEE2E2' },
  removeTenantText: { fontSize: 16, fontWeight: 'bold', color: '#DC2626' },
  maintenanceButton: { backgroundColor: '#D97706' },
  financialButton: { backgroundColor: '#0F766E' },
  actionButtonText: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  emptyTasks: { backgroundColor: '#fff', padding: 20, borderRadius: 12, alignItems: 'center' },
  emptyTasksText: { fontSize: 14, color: '#6B7280' },
  taskItem: { backgroundColor: '#fff', padding: 16, borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  completedTaskItem: { backgroundColor: '#F0FDF4' },
  taskTitle: { fontSize: 16, color: '#1F2937', fontWeight: '600' },
  completedDate: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  taskArrow: { fontSize: 20, color: '#9CA3AF' },
  infoRow: { backgroundColor: '#fff', padding: 16, borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  infoLabel: { fontSize: 14, color: '#6B7280' },
  infoValue: { fontSize: 14, fontWeight: '600', color: '#1F2937' },
  deleteButton: { backgroundColor: '#FEE2E2', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 12, marginBottom: 40 },
  deleteButtonText: { fontSize: 16, fontWeight: 'bold', color: '#DC2626' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' },
  modalContentInner: { padding: 24, paddingBottom: 32 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalCloseIcon: { fontSize: 20, color: '#6B7280', fontWeight: '600' },
  modalTitle: { fontSize: 22, fontWeight: 'bold', color: '#1F2937' },
  modalSubtitle: { fontSize: 14, color: '#6B7280', marginBottom: 20 },
  modalLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  modalInput: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#F9FAFB', color: '#1F2937' },
  inputContainer: { marginBottom: 16 },
  inputHint: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  taskOptionButton: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#F9FAFB', borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#E5E7EB' },
  taskOptionIcon: { fontSize: 28, marginRight: 12 },
  taskOptionInfo: { flex: 1 },
  taskOptionTitle: { fontSize: 16, fontWeight: 'bold', color: '#1F2937' },
  taskOptionDesc: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  modalButton: { backgroundColor: '#4F46E5', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  modalButtonText: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  modalCancelButton: { padding: 16, alignItems: 'center', marginTop: 8 },
  modalCancelText: { fontSize: 16, color: '#6B7280', fontWeight: '600' },
});

export default CarDetailsScreen;
