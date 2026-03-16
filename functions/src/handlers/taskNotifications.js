'use strict';

const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');

/**
 * Scheduled function: notifica o locador sobre tarefas vencidas.
 * Executa diariamente as 09:00 (America/Sao_Paulo).
 * Idempotente: usa notificationFlags.overdueNotified para nao duplicar.
 */
exports.notifyOverdueTasks = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'America/Sao_Paulo',
    region: 'us-central1',
  },
  async () => {
    const db = admin.firestore();
    const now = new Date();

    console.log(`[notifyOverdueTasks] Iniciando verificacao em ${now.toISOString()}`);

    // Buscar todas as tarefas pendentes — filtragem de data feita client-side para evitar indice composto
    const snapshot = await db.collection('tasks')
      .where('status', '==', 'pending')
      .get();

    if (snapshot.empty) {
      console.log('[notifyOverdueTasks] Nenhuma tarefa pendente encontrada.');
      return null;
    }

    // Filtrar: vencidas (dueDate < agora) e ainda nao notificadas
    const overdueTasks = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(task => {
        if (!task.dueDate) return false;
        const dueDate = task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate);
        if (dueDate >= now) return false;
        if (task.notificationFlags?.overdueNotified === true) return false;
        return true;
      });

    console.log(`[notifyOverdueTasks] ${overdueTasks.length} tarefas vencidas para notificar.`);

    let notified = 0;
    let errors = 0;

    // Cache de carros para evitar N+1 queries (mesmo carro buscado multiplas vezes)
    const carCache = new Map();
    const getCarData = async (carId) => {
      if (carCache.has(carId)) return carCache.get(carId);
      const carDoc = await db.collection('cars').doc(carId).get();
      const data = carDoc.exists ? carDoc.data() : null;
      carCache.set(carId, data);
      return data;
    };

    // Processar em lotes de 5 para evitar sobrecarga
    const CONCURRENCY = 5;
    for (let i = 0; i < overdueTasks.length; i += CONCURRENCY) {
      const chunk = overdueTasks.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(async (task) => {
        try {
          const carData = await getCarData(task.carId);
          if (!carData) return;

          const { landlordId, brand, model, plate } = carData;
          if (!landlordId) return;

          const carInfo = `${brand} ${model} (${plate})`;
          const dueDate = task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate);
          // Especificar timezone explicitamente — Cloud Run roda em UTC
          const dueDateBR = dueDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

          // Criar notificacao para o locador
          await db.collection('notifications').add({
            userId: landlordId,
            title: `Tarefa vencida — ${carInfo}`,
            body: `A tarefa "${task.title}" venceu em ${dueDateBR} e ainda nao foi concluida.`,
            data: { type: 'task_overdue', taskId: task.id, carId: task.carId },
            read: false,
            sent: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          // Marcar como notificado (idempotencia)
          await db.collection('tasks').doc(task.id).update({
            'notificationFlags.overdueNotified': true,
          });

          notified++;
        } catch (err) {
          console.error(`[notifyOverdueTasks] Erro ao processar tarefa ${task.id}:`, err.message);
          errors++;
        }
      }));
    }

    console.log(`[notifyOverdueTasks] Concluido: ${notified} notificacoes, ${errors} erros.`);
    return null;
  }
);
