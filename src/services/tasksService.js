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

// Helper: buscar tenantId a partir do carId
const getTenantIdFromCar = async (carId) => {
  try {
    const carDoc = await firestore().collection('cars').doc(carId).get();
    return carDoc.exists ? carDoc.data().tenantId || null : null;
  } catch { return null; }
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
      // Buscar tenantId para notificacao
      const tenantId = await getTenantIdFromCar(carId);

      // Due date: usar a fornecida pelo locador ou default 7 dias
      let dueDate;
      if (extraData.dueDate) {
        dueDate = firestore.Timestamp.fromDate(extraData.dueDate);
      } else {
        const defaultDue = new Date();
        defaultDue.setDate(defaultDue.getDate() + 7);
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
      const docRef = await firestore().collection('tasks').add({
        carId,
        type: TASK_TYPES.MAINTENANCE,
        title: 'Solicitacao de Manutencao',
        description: description || 'O locatario solicita manutencao para este veiculo.',
        status: 'pending',
        createdAt: firestore.FieldValue.serverTimestamp(),
        dueDate: firestore.Timestamp.fromDate(new Date()),
        requestedBy,
        requestedByRole: 'locatario',
        maintenanceType: maintenanceType || 'geral',
        manualRequest: true,
      });

      // Notificar o locador sobre pedido de manutencao
      // Buscar landlordId a partir do carro
      try {
        const carDoc = await firestore().collection('cars').doc(carId).get();
        if (carDoc.exists && carDoc.data().landlordId) {
          await notificationService.createNotification(
            carDoc.data().landlordId,
            'Solicitacao de Manutencao',
            `O locatario solicitou manutencao: ${maintenanceType || 'geral'}. ${description}`,
            { taskId: docRef.id, carId, type: 'maintenance_request' }
          );
        }
      } catch (e) { console.error('Notif landlord error:', e); }

      return { success: true, id: docRef.id };
    } catch (error) {
      console.error('Create maintenance request error:', error);
      return { success: false, error: error.message };
    }
  },

  // ===== GERACAO AUTOMATICA =====

  generateAutomaticTasks: async (carId, carData) => {
    try {
      const now = new Date();
      let tasksGenerated = 0;
      const tenantId = carData.tenantId || null;

      // KM update a cada 10 dias
      const lastKmUpdate = carData.lastKmUpdate?.toDate?.() || now;
      const daysSinceKmUpdate = differenceInDays(now, lastKmUpdate);
      if (daysSinceKmUpdate >= 10) {
        const hasPending = await tasksService._hasPendingTask(carId, TASK_TYPES.KM_UPDATE);
        if (!hasPending) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 3); // 3 dias para completar
          await firestore().collection('tasks').add({
            carId, type: TASK_TYPES.KM_UPDATE,
            title: 'Atualizacao de Quilometragem',
            description: 'Atualize a quilometragem do veiculo e envie foto do painel (tarefa automatica a cada 10 dias).',
            dueDate: firestore.Timestamp.fromDate(dueDate),
            status: 'pending', createdAt: firestore.FieldValue.serverTimestamp(), manualRequest: false,
            tenantId,
          });
          // Notificar locatario
          if (tenantId) {
            await notificationService.createNotification(tenantId,
              'Atualizacao de Quilometragem',
              `Atualize a quilometragem do veiculo ate ${formatDateBR(dueDate)}.`,
              { carId, type: 'auto_task' }
            );
          }
          tasksGenerated++;
        }
      }

      // Fotos a cada 15 dias
      const lastPhotoInspection = carData.lastPhotoInspection?.toDate?.() || now;
      const daysSincePhotos = differenceInDays(now, lastPhotoInspection);
      if (daysSincePhotos >= 15) {
        const hasPending = await tasksService._hasPendingTask(carId, TASK_TYPES.PHOTO_INSPECTION);
        if (!hasPending) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 5); // 5 dias para completar
          await firestore().collection('tasks').add({
            carId, type: TASK_TYPES.PHOTO_INSPECTION,
            title: 'Revisao Fotografica',
            description: 'Envie fotos atualizadas do veiculo (tarefa automatica a cada 15 dias).',
            dueDate: firestore.Timestamp.fromDate(dueDate),
            status: 'pending', requiredPhotos: REQUIRED_PHOTO_ANGLES, photosByAngle: {},
            createdAt: firestore.FieldValue.serverTimestamp(), manualRequest: false,
            tenantId,
          });
          if (tenantId) {
            await notificationService.createNotification(tenantId,
              'Revisao Fotografica',
              `Envie fotos atualizadas do veiculo ate ${formatDateBR(dueDate)}.`,
              { carId, type: 'auto_task' }
            );
          }
          tasksGenerated++;
        }
      }

      // Troca de oleo a cada 10000km
      const totalKm = carData.totalKm || 0;
      const lastOilChange = carData.lastOilChangeKm || 0;
      const kmSinceOilChange = totalKm - lastOilChange;
      if (kmSinceOilChange >= 10000) {
        const hasPending = await tasksService._hasPendingTask(carId, TASK_TYPES.OIL_CHANGE);
        if (!hasPending) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 7);
          await firestore().collection('tasks').add({
            carId, type: TASK_TYPES.OIL_CHANGE,
            title: 'Troca de Oleo',
            description: `Trocar oleo do motor (${kmSinceOilChange.toLocaleString()} km desde a ultima troca). Envie fotos do adesivo e recibo.`,
            dueDate: firestore.Timestamp.fromDate(dueDate),
            status: 'pending', createdAt: firestore.FieldValue.serverTimestamp(), manualRequest: false,
            tenantId,
          });
          if (tenantId) {
            await notificationService.createNotification(tenantId,
              'Troca de Oleo',
              `Realize a troca de oleo (${kmSinceOilChange.toLocaleString()} km desde a ultima). Prazo: ${formatDateBR(dueDate)}.`,
              { carId, type: 'auto_task' }
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

  getAllUserTasks: async (userId, userRole, status = 'pending') => {
    try {
      let carsQuery;
      if (userRole === 'locador') {
        carsQuery = firestore().collection('cars').where('landlordId', '==', userId);
      } else {
        carsQuery = firestore().collection('cars').where('tenantId', '==', userId);
      }

      const carsSnapshot = await carsQuery.get();
      const carIds = carsSnapshot.docs.map(doc => doc.id);
      if (carIds.length === 0) return { success: true, data: [] };

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

      // Ordenar client-side para evitar composite index
      allTasks.sort((a, b) => {
          const field = status === 'completed' ? 'completedAt' : 'dueDate';
          const dateA = a[field]?.toDate?.() || new Date(0);
          const dateB = b[field]?.toDate?.() || new Date(0);
          return status === 'completed' ? dateB - dateA : dateA - dateB;
      });

      return { success: true, data: allTasks };
    } catch (error) {
      console.error('Get all tasks error:', error);
      return { success: false, error: error.message };
    }
  },

  // ===== COMPLETAR TAREFAS =====

  completeKmTask: async (taskId, carId, newKm, dashboardPhotoUrl) => {
    try {
      const carDoc = await firestore().collection('cars').doc(carId).get();
      if (carDoc.exists) {
        const currentKm = carDoc.data().totalKm || 0;
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
        const carData = carDoc.data();
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

      // Verificar troca de oleo
      const carData = carDoc.data();
      const lastOilKm = carData.lastOilChangeKm || 0;
      if (newKm - lastOilKm >= 10000) {
        const hasPending = await tasksService._hasPendingTask(carId, TASK_TYPES.OIL_CHANGE);
        if (!hasPending) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 7);
          await firestore().collection('tasks').add({
            carId, type: TASK_TYPES.OIL_CHANGE,
            title: 'Troca de Oleo',
            description: `Trocar oleo do motor (${(newKm - lastOilKm).toLocaleString()} km desde a ultima troca).`,
            dueDate: firestore.Timestamp.fromDate(dueDate),
            status: 'pending', createdAt: firestore.FieldValue.serverTimestamp(), manualRequest: false,
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
      if (carDoc.exists) {
        const carKm = carDoc.data().totalKm || 0;
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

      const hasPendingKm = await tasksService._hasPendingTask(carId, TASK_TYPES.KM_UPDATE);
      if (!hasPendingKm) {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 3);
        await firestore().collection('tasks').add({
          carId, type: TASK_TYPES.KM_UPDATE,
          title: 'Atualizacao de Quilometragem',
          description: 'Atualize a quilometragem apos a troca de oleo.',
          dueDate: firestore.Timestamp.fromDate(dueDate),
          status: 'pending', createdAt: firestore.FieldValue.serverTimestamp(), manualRequest: false,
        });
      }

      // Notificar locador
      try {
        const carData = carDoc.data();
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

      // Notificar locatario
      const taskDoc = await firestore().collection('tasks').doc(taskId).get();
      if (taskDoc.exists) {
        const task = taskDoc.data();
        if (task.tenantId) {
          const { notificationService } = require('./notificationService');
          await notificationService.createNotification(
            task.tenantId,
            'Tarefa Aprovada',
            `Sua tarefa "${task.title}" foi aprovada pelo locador.`,
            { type: 'task_approved', taskId }
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

      // Notificar locatario
      const taskDoc = await firestore().collection('tasks').doc(taskId).get();
      if (taskDoc.exists) {
        const task = taskDoc.data();
        if (task.tenantId) {
          const { notificationService } = require('./notificationService');
          await notificationService.createNotification(
            task.tenantId,
            'Correcao Solicitada',
            `O locador solicitou correcao na tarefa "${task.title}": ${reason}`,
            { type: 'task_revision', taskId }
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
