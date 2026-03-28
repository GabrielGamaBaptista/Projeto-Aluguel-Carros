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

    // SEC-04 Fase B: ler fcmToken de private/data primeiro; fallback para doc publico
    const [userDoc, privateDoc] = await Promise.all([
      admin.firestore().collection('users').doc(userId).get(),
      admin.firestore().collection('users').doc(userId).collection('private').doc('data').get(),
    ]);
    if (!userDoc.exists) {
      try { await event.data.ref.delete(); } catch (e) {}
      return null;
    }
    const fcmToken = (privateDoc.exists && privateDoc.data().fcmToken) || userDoc.data().fcmToken;
    if (!fcmToken) {
      console.warn(`sendPushNotification: usuario ${userId} sem fcmToken. Notificacao "${title}" nao enviada.`);
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
          const nullPayload = { fcmToken: null };
          await Promise.all([
            admin.firestore().collection('users').doc(userId).update(nullPayload),
            admin.firestore().collection('users').doc(userId).collection('private').doc('data').set(nullPayload, { merge: true }),
          ]);
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
