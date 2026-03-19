// src/screens/TaskDetailsScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, ScrollView, Image, Platform, Modal, KeyboardAvoidingView,
  useWindowDimensions,
} from 'react-native';
import { Eye, AlertTriangle, CheckCircle2 } from 'lucide-react-native';
import { tasksService, REQUIRED_PHOTO_ANGLES, PHOTO_ANGLE_LABELS } from '../services/tasksService';
import { carsService } from '../services/carsService';
import { authService } from '../services/authService';
import PhotoPicker from '../components/PhotoPicker';
import ImageViewer from '../components/ImageViewer';

const TaskDetailsScreen = ({ route, navigation }) => {
  const { taskId, carId } = route.params;
  const { width: screenWidth } = useWindowDimensions();
  const photoGridItemWidth = Math.floor((screenWidth - 48) / 2);

  const [task, setTask] = useState(null);
  const [car, setCar] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loadingData, setLoadingData] = useState(true);
  const [loading, setLoading] = useState(false);
  const [revisionModalVisible, setRevisionModalVisible] = useState(false);
  const [revisionReason, setRevisionReason] = useState('');

  // ImageViewer state
  const [imageViewer, setImageViewer] = useState({ visible: false, url: null, title: '' });

  // KM
  const [newKm, setNewKm] = useState('');
  const [dashboardPhoto, setDashboardPhoto] = useState(null);

  // Fotos agrupadas por angulo
  const [photosByAngle, setPhotosByAngle] = useState({});

  // Oleo
  const [oilChangeKm, setOilChangeKm] = useState('');
  const [oilStickerPhoto, setOilStickerPhoto] = useState(null);
  const [oilReceiptPhoto, setOilReceiptPhoto] = useState(null);

  // Manutencao
  const [maintenanceNotes, setMaintenanceNotes] = useState('');
  const [maintenanceCost, setMaintenanceCost] = useState('');
  const [maintenancePhotos, setMaintenancePhotos] = useState([]);
  const [maintenanceReceiptPhoto, setMaintenanceReceiptPhoto] = useState(null);

  useEffect(() => { loadTaskData(); }, []);

  const loadTaskData = async () => {
    setLoadingData(true);
    try {
      const currentUser = authService.getCurrentUser();
      if (currentUser) {
        const profileResult = await authService.getCurrentUserProfile(currentUser.uid);
        if (profileResult.success) setUserProfile(profileResult.data);
      }
      if (taskId) {
        const taskResult = await tasksService.getTaskById(taskId);
        if (taskResult.success) {
          setTask(taskResult.data);
          const resolvedCarId = carId || taskResult.data.carId;
          if (resolvedCarId) {
            const carResult = await carsService.getCarById(resolvedCarId);
            if (carResult.success) setCar(carResult.data);
          }
        }
      }
    } catch (error) { console.error('Load task data error:', error); }
    setLoadingData(false);
  };

  const isCompleted = task?.status === 'completed';
  const isLandlord = userProfile?.role === 'locador';
  const isTenant = userProfile?.role === 'locatario';

  // REGRA: Locador so pode completar manutencao solicitada pelo locatario
  const isMaintenanceFromTenant = task?.type === 'maintenance' && task?.requestedByRole === 'locatario';
  const canComplete = !isCompleted && (isTenant || (isLandlord && isMaintenanceFromTenant));

  // Abrir foto no viewer
  const openPhoto = (url, title) => {
    setImageViewer({ visible: true, url, title: title || 'Foto' });
  };

  // Formatar dueDate
  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    try {
      const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return d.toLocaleDateString('pt-BR');
    } catch { return 'N/A'; }
  };

  const isDueDatePast = () => {
    if (!task?.dueDate) return false;
    try {
      const d = task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate);
      return d < new Date();
    } catch { return false; }
  };

  // ===== BANNER LOCADOR (view-only) =====
  const renderLandlordBanner = () => {
    if (isCompleted || canComplete) return null;
    if (!isLandlord) return null;
    return (
      <View style={styles.landlordBanner}>
        <Eye size={24} color="#4F46E5" style={{ marginRight: 12 }} />
        <View style={styles.landlordBannerContent}>
          <Text style={styles.landlordBannerTitle}>Modo Visualizacao</Text>
          <Text style={styles.landlordBannerText}>
            Esta tarefa deve ser concluida pelo locatario. Voce pode acompanhar o status aqui.
          </Text>
        </View>
      </View>
    );
  };

  // ===== DUE DATE INFO =====
  const renderDueDateInfo = () => {
    if (!task?.dueDate || isCompleted) return null;
    const overdue = isDueDatePast();
    return (
      <View style={[styles.dueDateCard, overdue && styles.dueDateCardOverdue]}>
        <Text style={[styles.dueDateLabel, overdue && styles.dueDateLabelOverdue]}>
          {overdue ? '⚠ Atrasada!' : 'Data Limite:'}
        </Text>
        <Text style={[styles.dueDateValue, overdue && styles.dueDateValueOverdue]}>
          {formatDate(task.dueDate)}
        </Text>
      </View>
    );
  };

  // ===== KM TASK =====
  const handleKmTaskComplete = async () => {
    const kmNum = parseInt(newKm);
    if (isNaN(kmNum) || kmNum < 0) { Alert.alert('Erro', 'Quilometragem invalida'); return; }
    if (car && kmNum < (car.totalKm || 0)) {
      Alert.alert('Erro', `A quilometragem nao pode ser menor que a atual (${car.totalKm.toLocaleString()} km).`);
      return;
    }
    if (!dashboardPhoto) { Alert.alert('Erro', 'Tire uma foto do painel mostrando a quilometragem'); return; }

    setLoading(true);
    const result = await tasksService.completeKmTask(task.id, task.carId, kmNum, dashboardPhoto);
    setLoading(false);
    if (result.success) {
      Alert.alert('Sucesso', 'Quilometragem atualizada!', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } else { Alert.alert('Erro', result.error); }
  };

  const renderKmTask = () => (
    <View style={styles.taskContent}>
      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>Carro:</Text>
        <Text style={styles.infoValue}>{car?.brand} {car?.model} - {car?.plate}</Text>
      </View>
      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>KM Atual:</Text>
        <Text style={styles.infoValue}>{car?.totalKm?.toLocaleString() || 0} km</Text>
      </View>

      {isCompleted ? (
        <>
          <View style={styles.completedCard}>
            <Text style={styles.completedLabel}>KM Registrado:</Text>
            <Text style={styles.completedValue}>{task.newKm?.toLocaleString()} km</Text>
          </View>
          {task.dashboardPhoto && (
            <View style={styles.photoSection}>
              <Text style={styles.sectionTitle}>Foto do Painel</Text>
              <TouchableOpacity onPress={() => openPhoto(task.dashboardPhoto, 'Foto do Painel')}>
                <Image source={{ uri: task.dashboardPhoto }} style={styles.reviewPhoto} />
                <Text style={styles.tapToZoom}>Toque para ampliar</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      ) : canComplete ? (
        <>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Nova Quilometragem *</Text>
            <TextInput style={styles.input} placeholder="Digite a quilometragem atual"
              placeholderTextColor="#9CA3AF" color="#1F2937"
              value={newKm} onChangeText={setNewKm} keyboardType="numeric" />
            {car?.totalKm > 0 && (
              <Text style={styles.hint}>Minimo: {car.totalKm.toLocaleString()} km</Text>
            )}
          </View>

          <Text style={styles.sectionTitle}>Foto do Painel *</Text>
          <Text style={styles.sectionSubtitle}>Tire uma foto do painel mostrando o hodometro</Text>
          <PhotoPicker label="Foto do Painel / Hodometro" onPhotoSelected={setDashboardPhoto} currentPhotoUrl={dashboardPhoto} />

          <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleKmTaskComplete} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Atualizar Quilometragem</Text>}
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  );

  // ===== PHOTO INSPECTION =====
  const addPhotoToAngle = (angle, url) => {
    setPhotosByAngle(prev => ({ ...prev, [angle]: [...(prev[angle] || []), url] }));
  };
  const removePhotoFromAngle = (angle, index) => {
    setPhotosByAngle(prev => {
      const updated = [...(prev[angle] || [])];
      updated.splice(index, 1);
      return { ...prev, [angle]: updated };
    });
  };

  const handlePhotoTaskComplete = async () => {
    const missingAngles = REQUIRED_PHOTO_ANGLES.filter(a => !photosByAngle[a] || photosByAngle[a].length === 0);
    if (missingAngles.length > 0) {
      Alert.alert('Erro', `Faltam fotos para: ${missingAngles.map(a => PHOTO_ANGLE_LABELS[a]).join(', ')}`);
      return;
    }
    setLoading(true);
    const result = await tasksService.completePhotoTask(task.id, task.carId, photosByAngle);
    setLoading(false);
    if (result.success) {
      Alert.alert('Sucesso', 'Revisao fotografica concluida!', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } else { Alert.alert('Erro', result.error); }
  };

  const getTotalPhotos = () => Object.values(photosByAngle).reduce((t, a) => t + a.length, 0);
  const getAnglesCompleted = () => REQUIRED_PHOTO_ANGLES.filter(a => photosByAngle[a] && photosByAngle[a].length > 0).length;

  const renderPhotoTask = () => {
    if (isCompleted) {
      const savedPhotos = task.photosByAngle || {};
      const hasGrouped = Object.keys(savedPhotos).length > 0;
      return (
        <View style={styles.taskContent}>
          <View style={styles.completedCard}>
            <Text style={styles.completedLabel}>Status:</Text>
            <Text style={styles.completedValue}>Concluida</Text>
          </View>
          {hasGrouped ? (
            REQUIRED_PHOTO_ANGLES.map(angle => {
              const anglePhotos = savedPhotos[angle] || [];
              if (anglePhotos.length === 0) return null;
              return (
                <View key={angle} style={styles.photoSection}>
                  <Text style={styles.angleSectionTitle}>{PHOTO_ANGLE_LABELS[angle]}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {anglePhotos.map((url, idx) => (
                      <TouchableOpacity key={idx} onPress={() => openPhoto(url, PHOTO_ANGLE_LABELS[angle])}>
                        <Image source={{ uri: url }} style={styles.reviewPhotoSmall} />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              );
            })
          ) : (
            <View style={styles.photoSection}>
              <Text style={styles.sectionTitle}>Fotos da Inspecao</Text>
              <View style={styles.photoGrid}>
                {(task.photos || []).map((url, idx) => (
                  <TouchableOpacity key={idx} onPress={() => openPhoto(url, 'Foto da Inspecao')}>
                    <Image source={{ uri: url }} style={[styles.reviewPhotoGrid, { width: photoGridItemWidth }]} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
          <Text style={styles.tapToZoomGlobal}>Toque em qualquer foto para ampliar</Text>
        </View>
      );
    }

    if (!canComplete) return <View style={styles.taskContent} />;

    return (
      <View style={styles.taskContent}>
        <View style={styles.progressCard}>
          <Text style={styles.progressLabel}>Angulos:</Text>
          <Text style={styles.progressValue}>{getAnglesCompleted()}/9</Text>
        </View>
        <View style={[styles.progressCard, { marginTop: 0 }]}>
          <Text style={styles.progressLabel}>Total de fotos:</Text>
          <Text style={styles.progressValue}>{getTotalPhotos()}</Text>
        </View>

        {REQUIRED_PHOTO_ANGLES.map((angle) => {
          const anglePhotos = photosByAngle[angle] || [];
          return (
            <View key={angle} style={styles.angleSection}>
              <Text style={styles.angleSectionTitle}>
                {PHOTO_ANGLE_LABELS[angle]} {anglePhotos.length > 0 ? `(${anglePhotos.length} foto${anglePhotos.length > 1 ? 's' : ''})` : ''}
              </Text>
              {anglePhotos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.anglePhotosRow}>
                  {anglePhotos.map((url, idx) => (
                    <View key={idx} style={styles.anglePhotoWrapper}>
                      <TouchableOpacity onPress={() => openPhoto(url, PHOTO_ANGLE_LABELS[angle])}>
                        <Image source={{ uri: url }} style={styles.anglePhotoThumb} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.removePhotoBtn} onPress={() => removePhotoFromAngle(angle, idx)}>
                        <Text style={styles.removePhotoBtnText}>X</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}
              <PhotoPicker label={anglePhotos.length === 0 ? 'Tirar Foto' : 'Adicionar Foto'}
                onPhotoSelected={(url) => addPhotoToAngle(angle, url)} currentPhotoUrl={null} />
            </View>
          );
        })}

        <TouchableOpacity style={[styles.button, (loading || getAnglesCompleted() < 9) && styles.buttonDisabled]}
          onPress={handlePhotoTaskComplete} disabled={loading || getAnglesCompleted() < 9}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Concluir Revisao ({getAnglesCompleted()}/9)</Text>}
        </TouchableOpacity>
      </View>
    );
  };

  // ===== OIL CHANGE TASK =====
  const handleOilTaskComplete = async () => {
    const kmNum = parseInt(oilChangeKm);
    if (isNaN(kmNum) || kmNum < 0) { Alert.alert('Erro', 'Quilometragem invalida'); return; }
    if (car && kmNum < (car.totalKm || 0)) {
      Alert.alert('Erro', `A quilometragem (${kmNum}) nao pode ser menor que a atual (${car.totalKm.toLocaleString()} km).`);
      return;
    }
    if (!oilStickerPhoto) { Alert.alert('Erro', 'Tire a foto do adesivo de troca de oleo.'); return; }
    if (!oilReceiptPhoto) { Alert.alert('Erro', 'Tire a foto do recibo da troca de oleo.'); return; }

    setLoading(true);
    const result = await tasksService.completeOilTask(task.id, task.carId, kmNum, oilStickerPhoto, oilReceiptPhoto);
    setLoading(false);
    if (result.success) {
      Alert.alert('Sucesso', 'Troca de oleo registrada!', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } else { Alert.alert('Erro', result.error); }
  };

  const renderOilTask = () => (
    <View style={styles.taskContent}>
      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>Carro:</Text>
        <Text style={styles.infoValue}>{car?.brand} {car?.model} - {car?.plate}</Text>
      </View>
      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>KM Atual:</Text>
        <Text style={styles.infoValue}>{car?.totalKm?.toLocaleString() || 0} km</Text>
      </View>

      {isCompleted ? (
        <>
          <View style={styles.completedCard}>
            <Text style={styles.completedLabel}>KM da Troca:</Text>
            <Text style={styles.completedValue}>{task.oilChangeKm?.toLocaleString()} km</Text>
          </View>
          {task.oilStickerPhoto && (
            <View style={styles.photoSection}>
              <Text style={styles.sectionTitle}>Foto do Adesivo</Text>
              <TouchableOpacity onPress={() => openPhoto(task.oilStickerPhoto, 'Adesivo de Troca de Oleo')}>
                <Image source={{ uri: task.oilStickerPhoto }} style={styles.reviewPhoto} />
                <Text style={styles.tapToZoom}>Toque para ampliar</Text>
              </TouchableOpacity>
            </View>
          )}
          {task.oilReceiptPhoto && (
            <View style={styles.photoSection}>
              <Text style={styles.sectionTitle}>Foto do Recibo</Text>
              <TouchableOpacity onPress={() => openPhoto(task.oilReceiptPhoto, 'Recibo de Troca de Oleo')}>
                <Image source={{ uri: task.oilReceiptPhoto }} style={styles.reviewPhoto} />
                <Text style={styles.tapToZoom}>Toque para ampliar</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      ) : canComplete ? (
        <>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>KM da Troca de Oleo *</Text>
            <TextInput style={styles.input} placeholder="Digite a quilometragem atual"
              placeholderTextColor="#9CA3AF" color="#1F2937"
              value={oilChangeKm} onChangeText={setOilChangeKm} keyboardType="numeric" />
            {car?.totalKm > 0 && (
              <Text style={styles.hint}>Minimo: {car.totalKm.toLocaleString()} km</Text>
            )}
          </View>

          <Text style={styles.sectionTitle}>Foto do Adesivo *</Text>
          <Text style={styles.sectionSubtitle}>Fotografe o adesivo que a empresa cola no painel/porta</Text>
          <PhotoPicker label="Foto do Adesivo de Troca" onPhotoSelected={setOilStickerPhoto} currentPhotoUrl={oilStickerPhoto} />

          <Text style={styles.sectionTitle}>Foto do Recibo *</Text>
          <Text style={styles.sectionSubtitle}>Fotografe o recibo ou comprovante da troca de oleo</Text>
          <PhotoPicker label="Foto do Recibo" onPhotoSelected={setOilReceiptPhoto} currentPhotoUrl={oilReceiptPhoto} />

          <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleOilTaskComplete} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Registrar Troca de Oleo</Text>}
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  );

  // ===== MAINTENANCE TASK =====
  const handleMaintenanceComplete = async () => {
    if (!maintenanceNotes.trim()) { Alert.alert('Erro', 'Descreva a manutencao realizada'); return; }
    if (maintenancePhotos.length === 0) {
      Alert.alert('Erro', 'Adicione pelo menos uma foto do reparo realizado.');
      return;
    }
    if (!maintenanceReceiptPhoto) {
      Alert.alert('Erro', 'Adicione a foto do recibo ou comprovante de pagamento.');
      return;
    }
    setLoading(true);
    const result = await tasksService.completeMaintenanceTask(task.id, task.carId, {
      notes: maintenanceNotes,
      cost: maintenanceCost ? parseFloat(maintenanceCost) : null,
      photos: maintenancePhotos,
      receiptPhoto: maintenanceReceiptPhoto,
    });
    setLoading(false);
    if (result.success) {
      Alert.alert('Sucesso', 'Manutencao registrada!', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } else { Alert.alert('Erro', result.error); }
  };

  const renderMaintenanceTask = () => (
    <View style={styles.taskContent}>
      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>Carro:</Text>
        <Text style={styles.infoValue}>{car?.brand} {car?.model} - {car?.plate}</Text>
      </View>
      {task.requestedByRole && (
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Solicitado por:</Text>
          <Text style={styles.infoValue}>{task.requestedByRole === 'locatario' ? 'Locatario' : 'Locador'}</Text>
        </View>
      )}
      {task.maintenanceType && (
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Tipo:</Text>
          <Text style={styles.infoValue}>{task.maintenanceType}</Text>
        </View>
      )}

      {isCompleted ? (
        <>
          <View style={styles.completedCard}>
            <Text style={styles.completedLabel}>Notas da Manutencao:</Text>
            <Text style={styles.completedNotes}>{task.maintenanceNotes}</Text>
          </View>
          {task.maintenanceCost && (
            <View style={styles.completedCard}>
              <Text style={styles.completedLabel}>Custo:</Text>
              <Text style={styles.completedValue}>R$ {task.maintenanceCost.toFixed(2)}</Text>
            </View>
          )}
          {task.maintenanceReceiptPhoto && (
            <View style={styles.photoSection}>
              <Text style={styles.sectionTitle}>Recibo / Comprovante</Text>
              <TouchableOpacity onPress={() => openPhoto(task.maintenanceReceiptPhoto, 'Recibo de Manutencao')}>
                <Image source={{ uri: task.maintenanceReceiptPhoto }} style={styles.reviewPhoto} />
                <Text style={styles.tapToZoom}>Toque para ampliar</Text>
              </TouchableOpacity>
            </View>
          )}
          {task.maintenancePhotos && task.maintenancePhotos.length > 0 && (
            <View style={styles.photoSection}>
              <Text style={styles.sectionTitle}>Fotos da Manutencao</Text>
              {task.maintenancePhotos.map((url, idx) => (
                <TouchableOpacity key={idx} onPress={() => openPhoto(url, 'Foto da Manutencao')}>
                  <Image source={{ uri: url }} style={styles.reviewPhoto} />
                </TouchableOpacity>
              ))}
              <Text style={styles.tapToZoomGlobal}>Toque em qualquer foto para ampliar</Text>
            </View>
          )}
        </>
      ) : canComplete ? (
        <>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Descricao da Manutencao *</Text>
            <TextInput style={[styles.input, styles.textArea]} placeholder="Descreva o que foi feito..."
              placeholderTextColor="#9CA3AF" color="#1F2937"
              value={maintenanceNotes} onChangeText={setMaintenanceNotes} multiline numberOfLines={4} />
          </View>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Custo (R$)</Text>
            <TextInput style={styles.input} placeholder="Ex: 350.00"
              placeholderTextColor="#9CA3AF" color="#1F2937"
              value={maintenanceCost} onChangeText={setMaintenanceCost} keyboardType="numeric" />
          </View>
          <Text style={styles.sectionTitle}>Fotos do Reparo *</Text>
          <Text style={styles.sectionSubtitle}>Adicione pelo menos uma foto do servico realizado</Text>
          {maintenancePhotos.map((url, idx) => (
            <View key={idx} style={styles.maintenancePhotoItem}>
              <TouchableOpacity onPress={() => openPhoto(url, 'Foto da Manutencao')}>
                <Image source={{ uri: url }} style={styles.maintenancePhotoThumb} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.removeMaintenancePhoto}
                onPress={() => { const u = [...maintenancePhotos]; u.splice(idx, 1); setMaintenancePhotos(u); }}>
                <Text style={styles.removePhotoBtnText}>Remover</Text>
              </TouchableOpacity>
            </View>
          ))}
          <PhotoPicker label="Adicionar Foto"
            onPhotoSelected={(url) => setMaintenancePhotos(prev => [...prev, url])} currentPhotoUrl={null} />
          <Text style={styles.sectionTitle}>Foto do Recibo *</Text>
          <Text style={styles.sectionSubtitle}>Fotografe o recibo ou comprovante de pagamento</Text>
          <PhotoPicker
            label="Foto do Recibo"
            onPhotoSelected={setMaintenanceReceiptPhoto}
            currentPhotoUrl={maintenanceReceiptPhoto}
          />
          <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleMaintenanceComplete} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Registrar Manutencao</Text>}
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  );

  if (loadingData) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#4F46E5" /><Text style={styles.loadingText}>Carregando tarefa...</Text></View>;
  if (!task) return <View style={styles.loadingContainer}><Text style={styles.errorText}>Tarefa nao encontrada</Text></View>;

  // ===== REVISION BANNER (locatario vê quando tarefa foi devolvida) =====
  const renderRevisionBanner = () => {
    if (!task.revisionRequested || isCompleted) return null;
    return (
      <View style={styles.revisionBanner}>
        <AlertTriangle size={24} color="#F59E0B" style={{ marginRight: 12 }} />
        <View style={styles.revisionBannerContent}>
          <Text style={styles.revisionBannerTitle}>Correcao Solicitada</Text>
          <Text style={styles.revisionBannerText}>
            {task.revisionReason || 'O locador solicitou que voce refaca esta tarefa.'}
          </Text>
        </View>
      </View>
    );
  };

  // ===== APPROVAL SECTION (locador vê em tarefas concluidas) =====
  const renderApprovalSection = () => {
    if (!isCompleted || !isLandlord) return null;

    // Ja aprovada
    if (task.approved) {
      return (
        <View style={styles.approvedBanner}>
          <CheckCircle2 size={22} color="#059669" style={{ marginRight: 10 }} />
          <Text style={styles.approvedBannerText}>Tarefa aprovada</Text>
        </View>
      );
    }

    return (
      <View style={styles.approvalSection}>
        <Text style={styles.approvalTitle}>Avaliar Tarefa</Text>
        <Text style={styles.approvalSubtitle}>Verifique os dados enviados pelo locatario.</Text>

        <TouchableOpacity style={styles.approveButton}
          onPress={async () => {
            Alert.alert('Aprovar Tarefa', 'Confirma a aprovacao desta tarefa?', [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Aprovar', onPress: async () => {
                setLoading(true);
                const result = await tasksService.approveTask(task.id);
                setLoading(false);
                if (result.success) { Alert.alert('Aprovada!', 'Tarefa aprovada com sucesso.'); loadTask(); }
                else Alert.alert('Erro', result.error);
              }},
            ]);
          }} disabled={loading}>
          <Text style={styles.approveButtonText}>Aprovar Tarefa</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.revisionButton}
          onPress={() => {
            setRevisionReason('');
            setRevisionModalVisible(true);
          }} disabled={loading}>
          <Text style={styles.revisionButtonText}>Solicitar Correcao</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>← Voltar</Text>
        </TouchableOpacity>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{task.title}</Text>
          {isCompleted && !task.approved && <View style={styles.completedBadge}><Text style={styles.completedBadgeText}>Concluida</Text></View>}
          {task.approved && <View style={styles.approvedBadge}><Text style={styles.approvedBadgeText}>Aprovada</Text></View>}
        </View>
        <Text style={styles.description}>{task.description}</Text>
      </View>

      {renderRevisionBanner()}
      {renderLandlordBanner()}
      {renderDueDateInfo()}
      {renderApprovalSection()}

      {task.type === 'km_update' && renderKmTask()}
      {task.type === 'photo_inspection' && renderPhotoTask()}
      {task.type === 'oil_change' && renderOilTask()}
      {task.type === 'maintenance' && renderMaintenanceTask()}

      {/* ImageViewer com zoom */}
      <ImageViewer
        visible={imageViewer.visible}
        imageUrl={imageViewer.url}
        title={imageViewer.title}
        onClose={() => setImageViewer({ visible: false, url: null, title: '' })}
      />

      <Modal
        visible={revisionModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRevisionModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.revisionModalOverlay}
        >
          <View style={styles.revisionModalCard}>
            <Text style={styles.revisionModalTitle}>Solicitar Correcao</Text>
            <Text style={styles.revisionModalSubtitle}>
              Descreva o motivo da correcao para que o locatario saiba o que precisa ajustar.
            </Text>

            <TextInput
              style={styles.revisionModalInput}
              placeholder="Ex: A foto do odometro nao esta legivel, por favor envie novamente com melhor qualidade."
              placeholderTextColor="#9CA3AF"
              value={revisionReason}
              onChangeText={setRevisionReason}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              maxLength={500}
            />
            <Text style={styles.revisionModalCharCount}>{revisionReason.length}/500</Text>

            <View style={styles.revisionModalButtons}>
              <TouchableOpacity
                style={styles.revisionModalCancelBtn}
                onPress={() => setRevisionModalVisible(false)}
              >
                <Text style={styles.revisionModalCancelText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.revisionModalSendBtn,
                  !revisionReason.trim() && styles.revisionModalSendBtnDisabled,
                ]}
                disabled={!revisionReason.trim() || loading}
                onPress={async () => {
                  setLoading(true);
                  const result = await tasksService.requestRevision(task.id, revisionReason.trim());
                  setLoading(false);
                  if (result.success) {
                    setRevisionModalVisible(false);
                    Alert.alert('Enviada!', 'Solicitacao de correcao enviada ao locatario.');
                    navigation.goBack();
                  } else {
                    Alert.alert('Erro', result.error);
                  }
                }}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.revisionModalSendText}>Enviar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  keyboardAvoid: { flex: 1, backgroundColor: '#F3F4F6' },
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F3F4F6' },
  loadingText: { marginTop: 12, fontSize: 16, color: '#6B7280' },
  errorText: { fontSize: 16, color: '#6B7280' },
  header: { backgroundColor: '#fff', padding: 20, paddingTop: 16, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  backButton: { marginBottom: 12 },
  backButtonText: { fontSize: 15, color: '#4F46E5', fontWeight: '600' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#1F2937', flex: 1 },
  description: { fontSize: 14, color: '#6B7280', lineHeight: 20 },
  completedBadge: { backgroundColor: '#D1FAE5', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, marginLeft: 8 },
  completedBadgeText: { color: '#065F46', fontSize: 12, fontWeight: '700' },
  // Landlord view-only banner
  landlordBanner: { flexDirection: 'row', backgroundColor: '#EEF2FF', padding: 16, marginHorizontal: 16, marginTop: 16, borderRadius: 12, borderWidth: 1, borderColor: '#C7D2FE' },
  landlordBannerIcon: { marginRight: 12 },
  landlordBannerContent: { flex: 1 },
  landlordBannerTitle: { fontSize: 15, fontWeight: 'bold', color: '#4F46E5', marginBottom: 4 },
  landlordBannerText: { fontSize: 13, color: '#6366F1', lineHeight: 18 },
  // Due date
  dueDateCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#DBEAFE', padding: 16, marginHorizontal: 16, marginTop: 12, borderRadius: 12 },
  dueDateCardOverdue: { backgroundColor: '#FEE2E2' },
  dueDateLabel: { fontSize: 14, fontWeight: '600', color: '#1E40AF' },
  dueDateLabelOverdue: { color: '#DC2626' },
  dueDateValue: { fontSize: 16, fontWeight: 'bold', color: '#1E40AF' },
  dueDateValueOverdue: { color: '#DC2626' },
  // Task content
  taskContent: { padding: 20 },
  infoCard: { backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 12 },
  infoLabel: { fontSize: 12, color: '#6B7280', marginBottom: 4 },
  infoValue: { fontSize: 16, fontWeight: '600', color: '#1F2937' },
  completedCard: { backgroundColor: '#EEF2FF', padding: 16, borderRadius: 12, marginBottom: 12 },
  completedLabel: { fontSize: 12, color: '#4F46E5', marginBottom: 4 },
  completedValue: { fontSize: 18, fontWeight: 'bold', color: '#4F46E5' },
  completedNotes: { fontSize: 14, color: '#1F2937', lineHeight: 20, marginTop: 4 },
  progressCard: { backgroundColor: '#EEF2FF', padding: 16, borderRadius: 12, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressLabel: { fontSize: 14, color: '#4F46E5', fontWeight: '600' },
  progressValue: { fontSize: 20, fontWeight: 'bold', color: '#4F46E5' },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937', marginBottom: 8, marginTop: 8 },
  sectionSubtitle: { fontSize: 14, color: '#6B7280', marginBottom: 16 },
  inputContainer: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#fff', color: '#1F2937' },
  hint: { fontSize: 12, color: '#4F46E5', marginTop: 4 },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  button: { backgroundColor: '#4F46E5', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 20, marginBottom: 40 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  // Photos
  photoSection: { marginBottom: 20, marginTop: 12 },
  reviewPhoto: { width: '100%', height: 250, borderRadius: 12, marginBottom: 4, backgroundColor: '#E5E7EB' },
  reviewPhotoSmall: { width: 200, height: 150, borderRadius: 8, marginRight: 8, backgroundColor: '#E5E7EB' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reviewPhotoGrid: { height: 150, borderRadius: 8, backgroundColor: '#E5E7EB' },
  tapToZoom: { fontSize: 12, color: '#4F46E5', textAlign: 'center', marginBottom: 8 },
  tapToZoomGlobal: { fontSize: 12, color: '#4F46E5', textAlign: 'center', marginTop: 8 },
  angleSection: { marginBottom: 24, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', paddingBottom: 16 },
  angleSectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#1F2937', marginBottom: 8 },
  anglePhotosRow: { marginBottom: 8 },
  anglePhotoWrapper: { position: 'relative', marginRight: 8 },
  anglePhotoThumb: { width: 120, height: 90, borderRadius: 8, backgroundColor: '#E5E7EB' },
  removePhotoBtn: { position: 'absolute', top: 4, right: 4, backgroundColor: '#DC2626', width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  removePhotoBtnText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  maintenancePhotoItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  maintenancePhotoThumb: { width: 100, height: 75, borderRadius: 8, marginRight: 12, backgroundColor: '#E5E7EB' },
  removeMaintenancePhoto: { backgroundColor: '#FEE2E2', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  // Revision banner
  revisionBanner: { flexDirection: 'row', backgroundColor: '#FEF3C7', padding: 16, marginHorizontal: 16, marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: '#FDE68A' },
  revisionBannerIcon: { marginRight: 12 },
  revisionBannerContent: { flex: 1 },
  revisionBannerTitle: { fontSize: 15, fontWeight: 'bold', color: '#92400E', marginBottom: 4 },
  revisionBannerText: { fontSize: 13, color: '#92400E', lineHeight: 18 },
  // Approval section
  approvalSection: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 12, padding: 20, borderRadius: 12, borderWidth: 2, borderColor: '#4F46E5' },
  approvalTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937', marginBottom: 4 },
  approvalSubtitle: { fontSize: 14, color: '#6B7280', marginBottom: 16 },
  approveButton: { backgroundColor: '#059669', padding: 16, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  approveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  revisionButton: { backgroundColor: '#FEF3C7', padding: 16, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#FDE68A' },
  revisionButtonText: { color: '#92400E', fontSize: 16, fontWeight: 'bold' },
  // Revision Modal
  revisionModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  revisionModalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 24, elevation: 5 },
  revisionModalTitle: { fontSize: 20, fontWeight: 'bold', color: '#1F2937', marginBottom: 6 },
  revisionModalSubtitle: { fontSize: 14, color: '#6B7280', marginBottom: 16, lineHeight: 20 },
  revisionModalInput: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, padding: 14, fontSize: 15, color: '#1F2937', backgroundColor: '#F9FAFB', minHeight: 120, lineHeight: 22 },
  revisionModalCharCount: { fontSize: 12, color: '#9CA3AF', textAlign: 'right', marginTop: 4, marginBottom: 16 },
  revisionModalButtons: { flexDirection: 'row', gap: 12 },
  revisionModalCancelBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#D1D5DB' },
  revisionModalCancelText: { fontSize: 15, fontWeight: '600', color: '#6B7280' },
  revisionModalSendBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: '#F59E0B' },
  revisionModalSendBtnDisabled: { backgroundColor: '#FDE68A' },
  revisionModalSendText: { fontSize: 15, fontWeight: 'bold', color: '#fff' },
  approvedBanner: { flexDirection: 'row', backgroundColor: '#D1FAE5', padding: 16, marginHorizontal: 16, marginTop: 12, borderRadius: 12, alignItems: 'center' },
  approvedBannerIcon: { marginRight: 10 },
  approvedBannerText: { fontSize: 15, fontWeight: '700', color: '#065F46' },
  approvedBadge: { backgroundColor: '#D1FAE5', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, marginLeft: 8 },
  approvedBadgeText: { color: '#065F46', fontSize: 12, fontWeight: '700' },
});

export default TaskDetailsScreen;
