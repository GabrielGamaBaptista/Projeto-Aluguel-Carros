// src/services/tasksService.js
import { firestore } from '../config/firebase';
import { differenceInDays } from 'date-fns';
import { notificationService } from './notificationService';

// Tipos de tarefas
export const TASK_TYPES = {
  KM_UPDATE: 'km_update',
  PHOTO_INSPECTION: 'photo_inspection',
  OIL_CHANGE: 'oil_change',
  MAINTENANCE: 'maintenance',
};

export const TASK_TYPE_LABELS = {
  km_update: 'Atualizacao de Km',
  photo_inspection: 'Revisao Fotografica',
  oil_change: 'Troca de Oleo',
  maintenance: 'Manutencao',
};

export const REQUIRED_PHOTO_ANGLES = [
  'frente', 'traseira', 'lado_esquerdo', 'lado_direito',
  'painel', 'banco_dianteiro', 'banco_traseiro', 'porta_malas', 'motor',
];

export const PHOTO_ANGLE_LABELS = {
  frente: 'Frente do Veiculo',
  traseira: 'Traseira do Veiculo',
  lado_esquerdo: 'Lado Esquerdo',
  lado_direito: 'Lado Direito',
  painel: 'Painel / Interior',
  banco_dianteiro: 'Banco Dianteiro',
  banco_traseiro: 'Banco Traseiro',
  porta_malas: 'Porta-Malas',
  motor: 'Motor',
};

// Intervalos para geracao automatica de tarefas (Q9.8)
const KM_UPDATE_INTERVAL_DAYS = 7;
const KM_UPDATE_DEADLINE_DAYS = 3;
const PHOTO_INSPECTION_INTERVAL_DAYS = 10;
const PHOTO_INSPECTION_DEADLINE_DAYS = 5;
const OIL_CHANGE_KM_INTERVAL = 10000;
const OIL_CHANGE_DEADLINE_DAYS = 7;
const MAINTENANCE_DEADLINE_DAYS = 7;
const MANUAL_TASK_DEFAULT_DEADLINE_DAYS = 7; // prazo padrao quando locador nao especifica

// Rate-limit: evita chamadas duplicadas de generateAutomaticTasks no mesmo periodo (Q3.4)
const _autoTaskLastRun = {}; // { [carId]: timestamp }
const AUTO_TASK_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos

// Helper: buscar tenantId e landlordId a partir do carId (Q9.5)
const getCarInfo = async (carId) => {
  try {
    const carDoc = await firestore().collection('cars').doc(carId).get();
    if (!carDoc.exists) return { tenantId: null, landlordId: null };
    const data = carDoc.data();
    return { tenantId: data.tenantId || null, landlordId: data.landlordId || null };
  } catch { return { tenantId: null, landlordId: null }; }
};

// Helper: formatar data para notificacao
const formatDateBR = (date) => {
  if (!date) return '';
  try {
    const d = date instanceof Date ? date : date.toDate?.() || new Date(date);
    return d.toLocaleDateString('pt-BR');
  } catch { return ''; }
};

export const tasksService = {
  _hasPendingTask: async (carId, taskType) => {
    try {
      const snapshot = await firestore()
        .collection('tasks')
        .where('carId', '==', carId)
        .where('type', '==', taskType)
        .where('status', '==', 'pending')
        .limit(1)
        .get();
      return !snapshot.empty;
    } catch (error) {
      console.error('Check pending task error:', error);
      return false;
    }
  },

  // ===== CRIACAO MANUAL DE TAREFAS (LOCADOR → LOCATARIO) =====

  createManualTask: async (carId, taskType, extraData = {}) => {
    try {
      // Buscar tenantId e landlordId para notificacao e indexacao (Q9.5)
      const { tenantId, landlordId } = await getCarInfo(carId);

      // Due date: usar a fornecida pelo locador ou default 7 dias
      let dueDate;
      if (extraData.dueDate) {
        dueDate = firestore.Timestamp.fromDate(extraData.dueDate);
      } else {
        const defaultDue = new Date();
        defaultDue.setDate(defaultDue.getDate() + MANUAL_TASK_DEFAULT_DEADLINE_DAYS);
        dueDate = firestore.Timestamp.fromDate(defaultDue);
      }

      const taskData = {
        carId,
        type: taskType,
        status: 'pending',
        createdAt: firestore.FieldValue.serverTimestamp(),
        dueDate,
        manualRequest: true,
        tenantId: tenantId || null,
        landlordId: landlordId || null,
        ...extraData,
        dueDate, // Garantir que nao seja sobrescrito pelo spread
      };

      // Remover dueDate do extraData se for um Date object (ja convertemos)
      delete taskData.dueDateText;

      switch (taskType) {
        case TASK_TYPES.KM_UPDATE:
          taskData.title = 'Atualizacao de Quilometragem';
          taskData.description = extraData.description || 'Solicitacao do locador: atualize a quilometragem e envie foto do painel.';
          break;
        case TASK_TYPES.PHOTO_INSPECTION:
          taskData.title = 'Revisao Fotografica';
          taskData.description = extraData.description || 'Solicitacao do locador: envie fotos atualizadas do veiculo.';
          taskData.requiredPhotos = REQUIRED_PHOTO_ANGLES;
          taskData.photosByAngle = {};
          break;
        case TASK_TYPES.MAINTENANCE:
          taskData.title = 'Solicitacao de Manutencao';
          taskData.description = extraData.description || 'Preencha os detalhes da manutencao.';
          taskData.requestedBy = extraData.requestedBy || null;
          taskData.requestedByRole = extraData.requestedByRole || 'locador';
          taskData.maintenanceType = extraData.maintenanceType || '';
          break;
        case TASK_TYPES.OIL_CHANGE:
          taskData.title = 'Troca de Oleo';
          taskData.description = extraData.description || 'Solicitacao do locador: realize a troca de oleo e envie fotos do adesivo e recibo.';
          break;
        default:
          taskData.title = extraData.title || 'Tarefa';
          taskData.description = extraData.description || '';
      }

      const docRef = await firestore().collection('tasks').add(taskData);

      // Enviar notificacao push ao locatario
      if (tenantId) {
        const dueDateFormatted = formatDateBR(dueDate.toDate());
        await notificationService.createNotification(
          tenantId,
          `Nova tarefa: ${taskData.title}`,
          `Voce tem uma nova tarefa a cumprir ate ${dueDateFormatted}. ${taskData.description}`,
          { taskId: docRef.id, carId, type: 'new_task' }
        );
      }

      return { success: true, id: docRef.id };
    } catch (error) {
      console.error('Create manual task error:', error);
      return { success: false, error: error.message };
    }
  },

  createMaintenanceRequest: async (carId, requestedBy, description, maintenanceType) => {
    try {
      // Buscar tenantId e landlordId do carro (Q2.1 + Q9.5)
      const carDoc = await firestore().collection('cars').doc(carId).get();
      const carData = carDoc.exists ? carDoc.data() : {};
      const tenantId = carData.tenantId || null;
      const landlordId = carData.landlordId || null;

      // dueDate: +7 dias (Q2.2)
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + MAINTENANCE_DEADLINE_DAYS);

      const docRef = await firestore().collection('tasks').add({
        carId,
        type: TASK_TYPES.MAINTENANCE,
        title: 'Solicitacao de Manutencao',
        description: description || 'O locatario solicita manutencao para este veiculo.',
        status: 'pending',
        createdAt: firestore.FieldValue.serverTimestamp(),
        dueDate: firestore.Timestamp.fromDate(dueDate),
        requestedBy,
        requestedByRole: 'locatario',
        maintenanceType: maintenanceType || 'geral',
        manualRequest: true,
        tenantId,
        landlordId,
      });

      // Notificar o locador sobre pedido de manutencao
      if (landlordId) {
        try {
          await notificationService.createNotification(
            landlordId,
            'Solicitacao de Manutencao',
            `O locatario solicitou manutencao: ${maintenanceType || 'geral'}. ${description}`,
            { taskId: docRef.id, carId, type: 'maintenance_request' }
          );
        } catch (e) { console.error('Notif landlord error:', e); }
      }

      return { success: true, id: docRef.id };
    } catch (error) {
      console.error('Create maintenance request error:', error);
      return { success: false, error: error.message };
    }
  },

  // ===== GERACAO AUTOMATICA =====

  generateAutomaticTasks: async (carId, carData) => {
    // Rate-limit: evita execucoes duplicadas dentro do cooldown (Q3.4)
    const now = Date.now();
    if (_autoTaskLastRun[carId] && (now - _autoTaskLastRun[carId]) < AUTO_TASK_COOLDOWN_MS) {
      return { success: true, skipped: true };
    }
    _autoTaskLastRun[carId] = now;

    try {
      const nowDate = new Date();
      let tasksGenerated = 0;
      const tenantId = carData.tenantId || null;
      const landlordId = carData.landlordId || null;

      // KM update a cada KM_UPDATE_INTERVAL_DAYS dias (Q9.8)
      const lastKmUpdate = carData.lastKmUpdate?.toDate?.() || nowDate;
      const daysSinceKmUpdate = differenceInDays(nowDate, lastKmUpdate);
      if (daysSinceKmUpdate >= KM_UPDATE_INTERVAL_DAYS) {
        const hasPending = await tasksService._hasPendingTask(carId, TASK_TYPES.KM_UPDATE);
        if (!hasPending) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + KM_UPDATE_DEADLINE_DAYS);
          const kmDocRef = await firestore().collection('tasks').add({
            carId, type: TASK_TYPES.KM_UPDATE,
            title: 'Atualizacao de Quilometragem',
            description: `Atualize a quilometragem do veiculo e envie foto do painel (tarefa automatica a cada ${KM_UPDATE_INTERVAL_DAYS} dias).`,
            dueDate: firestore.Timestamp.fromDate(dueDate),
            status: 'pending', createdAt: firestore.FieldValue.serverTimestamp(), manualRequest: false,
            tenantId, landlordId,
          });
          if (tenantId) {
            await notificationService.createNotification(tenantId,
              'Atualizacao de Quilometragem',
              `Atualize a quilometragem do veiculo ate ${formatDateBR(dueDate)}.`,
              { carId, taskId: kmDocRef.id, type: 'auto_task' }
            );
          }
          tasksGenerated++;
        }
      }

      // Fotos a cada PHOTO_INSPECTION_INTERVAL_DAYS dias (Q9.8)
      const lastPhotoInspection = carData.lastPhotoInspection?.toDate?.() || nowDate;
      const daysSincePhotos = differenceInDays(nowDate, lastPhotoInspection);
      if (daysSincePhotos >= PHOTO_INSPECTION_INTERVAL_DAYS) {
        const hasPending = await tasksService._hasPendingTask(carId, TASK_TYPES.PHOTO_INSPECTION);
        if (!hasPending) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + PHOTO_INSPECTION_DEADLINE_DAYS);
          const photoDocRef = await firestore().collection('tasks').add({
            carId, type: TASK_TYPES.PHOTO_INSPECTION,
            title: 'Revisao Fotografica',
            description: `Envie fotos atualizadas do veiculo (tarefa automatica a cada ${PHOTO_INSPECTION_INTERVAL_DAYS} dias).`,
            dueDate: firestore.Timestamp.fromDate(dueDate),
            status: 'pending', requiredPhotos: REQUIRED_PHOTO_ANGLES, photosByAngle: {},
            createdAt: firestore.FieldValue.serverTimestamp(), manualRequest: false,
            tenantId, landlordId,
          });
          if (tenantId) {
            await notificationService.createNotification(tenantId,
              'Revisao Fotografica',
              `Envie fotos atualizadas do veiculo ate ${formatDateBR(dueDate)}.`,
              { carId, taskId: photoDocRef.id, type: 'auto_task' }
            );
          }
          tasksGenerated++;
        }
      }

      // Troca de oleo a cada OIL_CHANGE_KM_INTERVAL km (Q9.8)
      const totalKm = carData.totalKm || 0;
      const lastOilChange = carData.lastOilChangeKm || 0;
      const kmSinceOilChange = totalKm - lastOilChange;
      if (kmSinceOilChange >= OIL_CHANGE_KM_INTERVAL) {
        const hasPending = await tasksService._hasPendingTask(carId, TASK_TYPES.OIL_CHANGE);
        if (!hasPending) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + OIL_CHANGE_DEADLINE_DAYS);
          const oilDocRef = await firestore().collection('tasks').add({
            carId, type: TASK_TYPES.OIL_CHANGE,
            title: 'Troca de Oleo',
            description: `Trocar oleo do motor (${kmSinceOilChange.toLocaleString()} km desde a ultima troca). Envie fotos do adesivo e recibo.`,
            dueDate: firestore.Timestamp.fromDate(dueDate),
            status: 'pending', createdAt: firestore.FieldValue.serverTimestamp(), manualRequest: false,
            tenantId, landlordId,
          });
          if (tenantId) {
            await notificationService.createNotification(tenantId,
              'Troca de Oleo',
              `Realize a troca de oleo (${kmSinceOilChange.toLocaleString()} km desde a ultima). Prazo: ${formatDateBR(dueDate)}.`,
              { carId, taskId: oilDocRef.id, type: 'auto_task' }
            );
          }
          tasksGenerated++;
        }
      }

      return { success: true, tasksGenerated };
    } catch (error) {
      console.error('Generate tasks error:', error);
      return { success: false, error: error.message };
    }
  },

  // ===== LEITURA =====

  getTaskById: async (taskId) => {
    try {
      const doc = await firestore().collection('tasks').doc(taskId).get();
      if (doc.exists) return { success: true, data: { id: doc.id, ...doc.data() } };
      return { success: false, error: 'Task not found' };
    } catch (error) {
      console.error('Get task error:', error);
      return { success: false, error: error.message };
    }
  },

  getCarTasks: async (carId, status = 'pending') => {
    try {
      const snapshot = await firestore()
        .collection('tasks')
        .where('carId', '==', carId)
        .where('status', '==', status)
        .get();
      const tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      tasks.sort((a, b) => {
        const da = a.dueDate?.toDate?.() || new Date(0);
        const db = b.dueDate?.toDate?.() || new Date(0);
        return da - db;
      });
      return { success: true, data: tasks };
    } catch (error) {
      console.error('Get tasks error:', error);
      return { success: false, error: error.message };
    }
  },

  // Busca tasks do usuario com suporte a paginacao para tasks concluidas (Q3.2).
  // Parametros opcionais: pageSize (padrao 20), startAfter (cursor Firestore para proxima pagina).
  // Retorna: { success, data, lastDoc, hasMore }
  // - lastDoc: ultimo DocumentSnapshot da query paginada (para proxima chamada)
  // - hasMore: true se ha mais paginas disponiveis
  //
  // COMPORTAMENTO DE PAGINACAO (locador, status=completed):
  //   startAfter=null (1a pagina): busca tasks legacy (todas, sem landlordId) + primeiras `pageSize` tasks novas
  //   startAfter!=null (paginas seguintes): apenas proximas `pageSize` tasks novas (legacy ja carregadas)
  getAllUserTasks: async (userId, userRole, status = 'pending', { pageSize = 20, startAfter = null } = {}) => {
    try {
      // Para locador: merge entre tasks novas (com landlordId) e tasks antigas (sem landlordId)
      if (userRole === 'locador') {
        const orderField = status === 'completed' ? 'completedAt' : 'dueDate';
        const orderDir = status === 'completed' ? 'desc' : 'asc';

        // Query 1: tasks novas indexadas por landlordId (paginada)
        let newQuery = firestore()
          .collection('tasks')
          .where('landlordId', '==', userId)
          .where('status', '==', status)
          .orderBy(orderField, orderDir)
          .limit(pageSize);
        if (startAfter) {
          newQuery = newQuery.startAfter(startAfter);
        }
        const newSnapshot = await newQuery.get();

        const taskMap = new Map(newSnapshot.docs.map(doc => [doc.id, { id: doc.id, ...doc.data() }]));
        const lastDoc = newSnapshot.docs[newSnapshot.docs.length - 1] || null;
        const hasMore = newSnapshot.docs.length === pageSize;

        // Query 2: tasks legacy por carId (sem landlordId) — apenas na primeira pagina.
        // Aplica limit(pageSize) por chunk para evitar download irrestrito em contas antigas.
        if (!startAfter) {
          const carsSnapshot = await firestore().collection('cars').where('landlordId', '==', userId).get();
          const carIds = carsSnapshot.docs.map(doc => doc.id);

          if (carIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < carIds.length; i += 10) {
              chunks.push(carIds.slice(i, i + 10));
            }
            for (const chunk of chunks) {
              const snapshot = await firestore()
                .collection('tasks')
                .where('carId', 'in', chunk)
                .where('status', '==', status)
                .limit(pageSize)
                .get();
              for (const doc of snapshot.docs) {
                if (!taskMap.has(doc.id)) {
                  taskMap.set(doc.id, { id: doc.id, ...doc.data() });
                }
              }
            }
          }
        }

        const allTasks = [...taskMap.values()];
        allTasks.sort((a, b) => {
          const dateA = a[orderField]?.toDate?.() || new Date(0);
          const dateB = b[orderField]?.toDate?.() || new Date(0);
          return status === 'completed' ? dateB - dateA : dateA - dateB;
        });

        return { success: true, data: allTasks, lastDoc, hasMore };
      }

      // Para locatario: query por carId (sem paginacao — max 1 carro, dataset pequeno)
      const carsSnapshot = await firestore().collection('cars').where('tenantId', '==', userId).get();
      const carIds = carsSnapshot.docs.map(doc => doc.id);
      if (carIds.length === 0) return { success: true, data: [], lastDoc: null, hasMore: false };

      const chunks = [];
      for (let i = 0; i < carIds.length; i += 10) {
        chunks.push(carIds.slice(i, i + 10));
      }

      let allTasks = [];
      for (const chunk of chunks) {
        const snapshot = await firestore()
          .collection('tasks')
          .where('carId', 'in', chunk)
          .where('status', '==', status)
          .get();
        allTasks = allTasks.concat(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }

      allTasks.sort((a, b) => {
        const field = status === 'completed' ? 'completedAt' : 'dueDate';
        const dateA = a[field]?.toDate?.() || new Date(0);
        const dateB = b[field]?.toDate?.() || new Date(0);
        return status === 'completed' ? dateB - dateA : dateA - dateB;
      });

      return { success: true, data: allTasks, lastDoc: null, hasMore: false };
    } catch (error) {
      console.error('Get all tasks error:', error);
      return { success: false, error: error.message };
    }
  },

  // ===== COMPLETAR TAREFAS =====

  completeKmTask: async (taskId, carId, newKm, dashboardPhotoUrl) => {
    try {
      const carDoc = await firestore().collection('cars').doc(carId).get();
      const carData = carDoc.exists ? carDoc.data() : {};

      if (carDoc.exists) {
        const currentKm = carData.totalKm || 0;
        if (newKm < currentKm) {
          return { success: false, error: `A quilometragem (${newKm}) nao pode ser menor que a atual (${currentKm} km).` };
        }
      }

      const updateData = {
        status: 'completed',
        completedAt: firestore.FieldValue.serverTimestamp(),
        newKm,
      };
      if (dashboardPhotoUrl) updateData.dashboardPhoto = dashboardPhotoUrl;

      await firestore().collection('tasks').doc(taskId).update(updateData);
      await firestore().collection('cars').doc(carId).update({
        totalKm: newKm,
        lastKmUpdate: firestore.FieldValue.serverTimestamp(),
      });

      // Notificar locador
      try {
        if (carData && carData.landlordId) {
          const carInfo = `${carData.brand} ${carData.model} (${carData.plate})`;
          await notificationService.createNotification(
            carData.landlordId,
            `Tarefa concluida — ${carInfo}`,
            `Locatario concluiu "Atualizacao de Quilometragem". Aguardando sua aprovacao.`,
            { type: 'task_completed', taskId, carId }
          );
        }
      } catch (e) { console.error('Notif landlord km error:', e); }

      // Verificar troca de oleo (Q2.1 + Q9.5: adicionar tenantId e landlordId)
      const lastOilKm = carData.lastOilChangeKm || 0;
      if (newKm - lastOilKm >= OIL_CHANGE_KM_INTERVAL) {
        const hasPending = await tasksService._hasPendingTask(carId, TASK_TYPES.OIL_CHANGE);
        if (!hasPending) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + OIL_CHANGE_DEADLINE_DAYS);
          await firestore().collection('tasks').add({
            carId, type: TASK_TYPES.OIL_CHANGE,
            title: 'Troca de Oleo',
            description: `Trocar oleo do motor (${(newKm - lastOilKm).toLocaleString()} km desde a ultima troca).`,
            dueDate: firestore.Timestamp.fromDate(dueDate),
            status: 'pending', createdAt: firestore.FieldValue.serverTimestamp(), manualRequest: false,
            tenantId: carData.tenantId || null,
            landlordId: carData.landlordId || null,
          });
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Complete KM task error:', error);
      return { success: false, error: error.message };
    }
  },

  completePhotoTask: async (taskId, carId, photosByAngle) => {
    try {
      const missingAngles = REQUIRED_PHOTO_ANGLES.filter(
        angle => !photosByAngle[angle] || photosByAngle[angle].length === 0
      );
      if (missingAngles.length > 0) {
        return { success: false, error: `Faltam fotos para: ${missingAngles.map(a => PHOTO_ANGLE_LABELS[a]).join(', ')}` };
      }

      await firestore().collection('tasks').doc(taskId).update({
        status: 'completed',
        completedAt: firestore.FieldValue.serverTimestamp(),
        photosByAngle,
      });

      const allPhotos = [];
      REQUIRED_PHOTO_ANGLES.forEach(angle => {
        if (photosByAngle[angle]) allPhotos.push(...photosByAngle[angle]);
      });

      await firestore().collection('cars').doc(carId).update({
        lastPhotoInspection: firestore.FieldValue.serverTimestamp(),
        lastInspectionPhotos: allPhotos,
      });

      // Notificar locador
      try {
        const carDoc = await firestore().collection('cars').doc(carId).get();
        if (carDoc.exists && carDoc.data().landlordId) {
          const carData = carDoc.data();
          const carInfo = `${carData.brand} ${carData.model} (${carData.plate})`;
          await notificationService.createNotification(
            carData.landlordId,
            `Tarefa concluida — ${carInfo}`,
            `Locatario concluiu "Revisao Fotografica". Aguardando sua aprovacao.`,
            { type: 'task_completed', taskId, carId }
          );
        }
      } catch (e) { console.error('Notif landlord photo error:', e); }

      return { success: true };
    } catch (error) {
      console.error('Complete photo task error:', error);
      return { success: false, error: error.message };
    }
  },

  completeOilTask: async (taskId, carId, currentKm, stickerPhoto, receiptPhoto) => {
    try {
      const carDoc = await firestore().collection('cars').doc(carId).get();
      const carData = carDoc.exists ? carDoc.data() : {};

      if (carDoc.exists) {
        const carKm = carData.totalKm || 0;
        if (currentKm < carKm) {
          return { success: false, error: `A quilometragem (${currentKm}) nao pode ser menor que a atual (${carKm} km).` };
        }
      }

      const updateData = {
        status: 'completed',
        completedAt: firestore.FieldValue.serverTimestamp(),
        oilChangeKm: currentKm,
      };
      if (stickerPhoto) updateData.oilStickerPhoto = stickerPhoto;
      if (receiptPhoto) updateData.oilReceiptPhoto = receiptPhoto;

      await firestore().collection('tasks').doc(taskId).update(updateData);
      await firestore().collection('cars').doc(carId).update({
        lastOilChangeKm: currentKm,
        totalKm: currentKm,
      });

      // Auto-gerar task de KM apos troca de oleo (Q2.1 + Q9.5: adicionar tenantId e landlordId)
      const hasPendingKm = await tasksService._hasPendingTask(carId, TASK_TYPES.KM_UPDATE);
      if (!hasPendingKm) {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + KM_UPDATE_DEADLINE_DAYS);
        await firestore().collection('tasks').add({
          carId, type: TASK_TYPES.KM_UPDATE,
          title: 'Atualizacao de Quilometragem',
          description: 'Atualize a quilometragem apos a troca de oleo.',
          dueDate: firestore.Timestamp.fromDate(dueDate),
          status: 'pending', createdAt: firestore.FieldValue.serverTimestamp(), manualRequest: false,
          tenantId: carData.tenantId || null,
          landlordId: carData.landlordId || null,
        });
      }

      // Notificar locador
      try {
        if (carData && carData.landlordId) {
          const carInfo = `${carData.brand} ${carData.model} (${carData.plate})`;
          await notificationService.createNotification(
            carData.landlordId,
            `Tarefa concluida — ${carInfo}`,
            `Locatario concluiu "Troca de Oleo". Aguardando sua aprovacao.`,
            { type: 'task_completed', taskId, carId }
          );
        }
      } catch (e) { console.error('Notif landlord oil error:', e); }

      return { success: true };
    } catch (error) {
      console.error('Complete oil task error:', error);
      return { success: false, error: error.message };
    }
  },

  completeMaintenanceTask: async (taskId, carId, data) => {
    try {
      await firestore().collection('tasks').doc(taskId).update({
        status: 'completed',
        completedAt: firestore.FieldValue.serverTimestamp(),
        maintenanceNotes: data.notes || '',
        maintenanceCost: data.cost || null,
        maintenancePhotos: data.photos || [],
        maintenanceReceiptPhoto: data.receiptPhoto || null,
      });

      // Notificar locador
      try {
        const carDoc = await firestore().collection('cars').doc(carId).get();
        if (carDoc.exists && carDoc.data().landlordId) {
          const carData = carDoc.data();
          const carInfo = `${carData.brand} ${carData.model} (${carData.plate})`;
          await notificationService.createNotification(
            carData.landlordId,
            `Tarefa concluida — ${carInfo}`,
            `Locatario concluiu "Manutencao". Aguardando sua aprovacao.`,
            { type: 'task_completed', taskId, carId }
          );
        }
      } catch (e) { console.error('Notif landlord maintenance error:', e); }

      return { success: true };
    } catch (error) {
      console.error('Complete maintenance task error:', error);
      return { success: false, error: error.message };
    }
  },

  // ===== SUBSCRIPTIONS =====
  subscribeToTasks: (carId, callback) => {
    return firestore()
      .collection('tasks')
      .where('carId', '==', carId)
      .where('status', '==', 'pending')
      .onSnapshot(
        snapshot => {
          const tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          tasks.sort((a, b) => {
            const da = a.dueDate?.toDate?.() || new Date(0);
            const db = b.dueDate?.toDate?.() || new Date(0);
            return da - db;
          });
          callback(tasks);
        },
        error => { console.error('Subscribe tasks error:', error); }
      );
  },

  // ===== DELECAO =====
  deleteTasksByCar: async (carId) => {
    try {
      const snapshot = await firestore()
        .collection('tasks')
        .where('carId', '==', carId)
        .where('status', '==', 'pending')
        .get();
      const batch = firestore().batch();
      snapshot.docs.forEach(doc => { batch.delete(doc.ref); });
      await batch.commit();
      return { success: true, deleted: snapshot.size };
    } catch (error) {
      console.error('Delete tasks by car error:', error);
      return { success: false, error: error.message };
    }
  },

  // ===== APROVACAO / REVISAO DE TAREFAS =====

  approveTask: async (taskId) => {
    try {
      await firestore().collection('tasks').doc(taskId).update({
        approved: true,
        approvedAt: firestore.FieldValue.serverTimestamp(),
      });

      // Notificar locatario (Q10.3: usar import do topo, nao require inline)
      const taskDoc = await firestore().collection('tasks').doc(taskId).get();
      if (taskDoc.exists) {
        const task = taskDoc.data();
        if (task.tenantId) {
          await notificationService.createNotification(
            task.tenantId,
            'Tarefa Aprovada',
            `Sua tarefa "${task.title}" foi aprovada pelo locador.`,
            { type: 'task_approved', taskId, carId: task.carId }
          );
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Approve task error:', error);
      return { success: false, error: error.message };
    }
  },

  requestRevision: async (taskId, reason) => {
    try {
      await firestore().collection('tasks').doc(taskId).update({
        status: 'pending',
        approved: false,
        revisionRequested: true,
        revisionReason: reason || '',
        revisionRequestedAt: firestore.FieldValue.serverTimestamp(),
        completedAt: null,
      });

      // Notificar locatario (Q10.3: usar import do topo, nao require inline)
      const taskDoc = await firestore().collection('tasks').doc(taskId).get();
      if (taskDoc.exists) {
        const task = taskDoc.data();
        if (task.tenantId) {
          await notificationService.createNotification(
            task.tenantId,
            'Correcao Solicitada',
            `O locador solicitou correcao na tarefa "${task.title}": ${reason}`,
            { type: 'task_revision', taskId, carId: task.carId }
          );
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Request revision error:', error);
      return { success: false, error: error.message };
    }
  },
};
