const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

/**
 * Firestore trigger: envia push notification quando um documento e criado em notifications/{notifId}.
 * Apos envio bem-sucedido (ou falha), deleta o documento (Q5.5).
 */
exports.sendPushNotification = onDocumentCreated(
  { document: 'notifications/{notifId}', region: 'us-central1' },
  async (event) => {
    const data = event.data.data();
    const { userId, title, body } = data;

    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      try { await event.data.ref.delete(); } catch (e) {}
      return null;
    }
    const { fcmToken } = userDoc.data();
    if (!fcmToken) {
      console.warn(`sendPushNotification: usuario ${userId} sem fcmToken. Notificacao "${title}" nao enviada.`);
      // Deletar notificacao sem token — nao sera entregue (Q5.5)
      try { await event.data.ref.delete(); } catch (e) {}
      return null;
    }

    try {
      await admin.messaging().send({
        token: fcmToken,
        notification: { title, body },
        data: data.data
          ? Object.fromEntries(Object.entries(data.data).map(([k, v]) => [k, String(v)]))
          : {},
        android: {
          priority: 'high',
          notification: { channelId: 'tarefas' },
        },
      });
      // Deletar apos entrega bem-sucedida (Q5.5 — nao ha tela de historico no app)
      await event.data.ref.delete();
    } catch (err) {
      if (
        err.code === 'messaging/registration-token-not-registered' ||
        err.code === 'messaging/invalid-registration-token'
      ) {
        try {
          await admin.firestore().collection('users').doc(userId).update({ fcmToken: null });
        } catch (cleanupErr) {
          console.error('Erro ao limpar fcmToken invalido:', cleanupErr.message);
        }
      }
      console.error('Erro ao enviar push:', err.message);
      // Deletar mesmo em caso de erro (Q5.5)
      try { await event.data.ref.delete(); } catch (e) {}
    }
    return null;
  }
);
