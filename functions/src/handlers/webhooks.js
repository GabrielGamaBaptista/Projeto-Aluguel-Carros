const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { config } = require('../asaas/client');

/**
 * Cloud Function HTTPS (gen 2) para processar webhooks do Asaas.
 * Recebe notificações de alteração de status de pagamento.
 */
exports.asaasWebhook = onRequest({ invoker: 'public', cors: false }, async (req, res) => {
  // 1. Validar método — GET é aceito para validação da URL pelo Asaas
  if (req.method === 'GET') {
    return res.status(200).send('OK');
  }
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // 2. Validar assinatura do Asaas via header access_token.
  // ASAAS_WEBHOOK_TOKEN e OBRIGATORIO. Se nao configurado, recusa todas as requisicoes
  // para evitar que eventos falsos sejam processados em caso de misconfiguracao.
  const webhookToken = config.webhook_token;
  if (!webhookToken) {
    console.error('ASAAS_WEBHOOK_TOKEN nao configurado. Rejeitando requisicao de webhook por seguranca.');
    return res.status(500).send('Webhook token not configured');
  }
  const receivedToken = req.headers['asaas-access-token'];
  const tokenBuffer = Buffer.from(webhookToken, 'utf8');
  const receivedBuffer = Buffer.from(receivedToken || '', 'utf8');
  if (!receivedToken || tokenBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(tokenBuffer, receivedBuffer)) {
    console.warn('Webhook rejeitado: token invalido ou ausente.');
    return res.status(401).send('Unauthorized');
  }

  const { event, payment } = req.body;

  // 2. O externalReference é o chargeId do Firestore
  const chargeId = payment ? payment.externalReference : null;

  if (!chargeId) {
    console.warn('Webhook recebido sem externalReference/chargeId:', req.body);
    return res.status(200).send('OK (Ignored)');
  }

  try {
    const db = admin.firestore();
    let chargeRef = db.collection('charges').doc(chargeId);

    // Fallback: se o doc nao existir pelo externalReference, tentar pelo asaasPaymentId.
    // Cobre o caso de zombie charge — cobranca criada no Asaas mas falhou ao salvar no Firestore.
    // A query e feita fora da transacao (queries nao sao suportadas dentro de transacoes Firestore).
    const preCheck = await chargeRef.get();
    if (!preCheck.exists) {
      const asaasPaymentId = payment?.id;
      if (asaasPaymentId) {
        const fallbackSnap = await db.collection('charges')
          .where('asaasPaymentId', '==', asaasPaymentId)
          .limit(1)
          .get();
        if (!fallbackSnap.empty) {
          chargeRef = fallbackSnap.docs[0].ref;
          console.log(`[webhook] Fallback: cobranca encontrada por asaasPaymentId (${asaasPaymentId}) apos miss por externalReference (${chargeId}).`);
        } else {
          console.warn(`[webhook] Cobranca nao encontrada por externalReference (${chargeId}) nem asaasPaymentId (${asaasPaymentId}). Evento ${event} ignorado.`);
          return res.status(200).send('OK (Not found)');
        }
      } else {
        console.warn(`[webhook] Cobranca ${chargeId} nao encontrada no Firestore e sem asaasPaymentId no payload. Evento ${event} ignorado.`);
        return res.status(200).send('OK (Not found)');
      }
    }

    // notificationPayload e o RETORNO da transacao (nao closure) — garante que so existe se commit ok.
    const NOTIFY_EVENTS = ['PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH', 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE'];

    const notificationPayload = await db.runTransaction(async (tx) => {
      const chargeDoc = await tx.get(chargeRef);

      if (!chargeDoc.exists) {
        // Raro — pode ocorrer se o documento foi deletado entre o preCheck e a transacao
        console.warn(`Cobranca nao encontrada na transacao. Evento ${event} ignorado.`);
        return null; // sai da transacao sem throw — o bloco externo retorna 200
      }

      const chargeData = chargeDoc.data();

      // Verificar idempotencia dentro da transacao (verdadeira atomicidade)
      const processedEvents = chargeData.processedEvents || [];
      if (processedEvents.includes(event)) {
        console.log(`Evento ${event} ja processado para a cobranca ${chargeId}.`);
        return null;
      }

      // Bloquear regressao de status — eventos Asaas podem chegar fora de ordem
      const currentStatus = chargeData.status;
      const statusFromEvent = {
        'PAYMENT_RECEIVED': 'RECEIVED',
        'PAYMENT_RECEIVED_IN_CASH': 'RECEIVED',
        'PAYMENT_CONFIRMED': 'CONFIRMED',
        'PAYMENT_OVERDUE': 'OVERDUE',
        'PAYMENT_DELETED': 'CANCELLED',
        'PAYMENT_REFUNDED': 'REFUNDED',
      }[event];
      if (statusFromEvent) {
        // Se ja foi pago (RECEIVED/CONFIRMED), nao retrocede para OVERDUE, PENDING ou CANCELLED
        const ALREADY_PAID = ['RECEIVED', 'CONFIRMED'];
        const REGRESS_STATUSES = ['OVERDUE', 'PENDING', 'CANCELLED'];
        if (ALREADY_PAID.includes(currentStatus) && REGRESS_STATUSES.includes(statusFromEvent)) {
          console.warn(`[webhook] Bloqueando regressao ${currentStatus} → ${statusFromEvent} para cobranca ${chargeId}. Evento ${event} ignorado.`);
          return null;
        }
        // REFUNDED e status completamente final
        if (currentStatus === 'REFUNDED') {
          console.warn(`[webhook] Cobranca ${chargeId} ja esta em REFUNDED (final). Evento ${event} ignorado.`);
          return null;
        }
      }

      let updateData = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedEvents: admin.firestore.FieldValue.arrayUnion(event)
      };

      switch (event) {
        case 'PAYMENT_RECEIVED':
        case 'PAYMENT_RECEIVED_IN_CASH':
          updateData.status = 'RECEIVED';
          updateData.paymentDate = payment.paymentDate;
          updateData.netAmount = payment.netValue;
          updateData.platformFee = parseFloat(((chargeData.amount || 0) * (config.platform_fee_percent / 100)).toFixed(2));
          updateData.transactionReceiptUrl = payment.transactionReceiptUrl || null;
          break;
        case 'PAYMENT_CONFIRMED':
          updateData.status = 'CONFIRMED';
          updateData.paymentDate = payment.paymentDate;
          updateData.netAmount = payment.netValue;
          updateData.platformFee = parseFloat(((chargeData.amount || 0) * (config.platform_fee_percent / 100)).toFixed(2));
          updateData.transactionReceiptUrl = payment.transactionReceiptUrl || null;
          break;
        case 'PAYMENT_OVERDUE':
          updateData.status = 'OVERDUE';
          break;
        case 'PAYMENT_DELETED':
          // Evita que o webhook da cobranca ANTIGA (deletada durante editCharge) marque a cobranca
          // como CANCELLED. Se payment.id != asaasPaymentId atual no Firestore, a cobranca ja foi
          // substituida por uma nova — ignorar sem fazer update e sem registrar em processedEvents.
          if (payment.id && chargeData.asaasPaymentId && payment.id !== chargeData.asaasPaymentId) {
            console.log(`PAYMENT_DELETED ignorado para ${chargeId}: payment.id (${payment.id}) != asaasPaymentId atual (${chargeData.asaasPaymentId}). Webhook da cobranca antiga de editCharge.`);
            return null;
          }
          updateData.status = 'CANCELLED';
          break;
        case 'PAYMENT_REFUNDED':
          updateData.status = 'REFUNDED';
          break;
        default:
          console.log(`Evento ${event} recebido para ${chargeId}, mas nao mapeado para alteracao de status.`);
          break;
      }

      // Capturar payload para notificacoes — somente para eventos que geram notificacao
      // e somente se nao for transicao entre dois status "pago" (evita notificacao dupla).
      // Retornar como resultado da transacao garante que so existe apos commit bem-sucedido.
      const ALREADY_PAID_STATUSES = ['RECEIVED', 'CONFIRMED'];
      const isTransitionBetweenPaidStatuses =
        ALREADY_PAID_STATUSES.includes(currentStatus) && ALREADY_PAID_STATUSES.includes(statusFromEvent);

      let payload = null;
      if (NOTIFY_EVENTS.includes(event) && !isTransitionBetweenPaidStatuses) {
        // Ler nome do locatario dentro da transacao — so para eventos que realmente notificam.
        // Guard: tenantId invalido usa fallback sem lancar exception.
        const tId = chargeData.tenantId;
        let tenantName = 'Locatario';
        if (tId && typeof tId === 'string') {
          const tenantUserDoc = await tx.get(db.collection('users').doc(tId));
          tenantName = tenantUserDoc.exists ? (tenantUserDoc.data().name || 'Locatario') : 'Locatario';
        }
        payload = {
          resolvedChargeId: chargeRef.id,
          landlordId: chargeData.landlordId,
          tenantId: tId,
          tenantName,
          amount: chargeData.amount,
          dueDate: chargeData.dueDate,
          carInfo: chargeData.carInfo,
        };
      }

      tx.update(chargeRef, updateData);
      return payload; // retorno da transacao — so disponivel se commit ok
    });

    // Notificacoes pos-transacao — notificationPayload so existe se o commit foi bem-sucedido
    // e o evento esta na lista de eventos que geram notificacao (filtro feito dentro da transacao).
    if (notificationPayload) {
      try {
        const { resolvedChargeId, landlordId, tenantId, tenantName, amount, dueDate, carInfo } = notificationPayload;
        const formattedAmount = (amount || 0).toFixed(2).replace('.', ',');
        const [year, month, day] = (dueDate || '').split('-');
        const dueDateBR = dueDate ? `${day}/${month}/${year}` : '';

        if (event === 'PAYMENT_OVERDUE') {
          // Notificar locatario que cobranca venceu
          await db.collection('notifications').add({
            userId: tenantId,
            title: `Cobranca vencida — ${carInfo || ''}`,
            body: `Sua cobranca de R$ ${formattedAmount} venceu em ${dueDateBR}. Regularize o pagamento.`,
            data: { type: 'charge_overdue', chargeId: resolvedChargeId },
            read: false,
            sent: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          // Notificar locador que locatario nao pagou (nome ja disponivel da transacao)
          await db.collection('notifications').add({
            userId: landlordId,
            title: `Pagamento em atraso — ${carInfo || ''}`,
            body: `${tenantName} nao pagou a cobranca de R$ ${formattedAmount} que venceu em ${dueDateBR}.`,
            data: { type: 'charge_overdue_landlord', chargeId: resolvedChargeId },
            read: false,
            sent: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } else {
          // Notificar locador que cobranca foi paga/confirmada (nome ja disponivel da transacao)
          const eventLabel = event === 'PAYMENT_CONFIRMED' ? 'Pagamento confirmado' : 'Pagamento recebido';
          await db.collection('notifications').add({
            userId: landlordId,
            title: `${eventLabel} — ${carInfo || ''}`,
            body: `${tenantName} pagou a cobranca de R$ ${formattedAmount} (venc. ${dueDateBR}).`,
            data: { type: 'payment_received', chargeId: resolvedChargeId },
            read: false,
            sent: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          // Notificar locatario com confirmacao de recebimento
          const eventLabelTenant = event === 'PAYMENT_CONFIRMED' ? 'confirmado' : 'recebido';
          await db.collection('notifications').add({
            userId: tenantId,
            title: `Pagamento ${eventLabelTenant} — ${carInfo || ''}`,
            body: `Seu pagamento de R$ ${formattedAmount} (venc. ${dueDateBR}) foi ${eventLabelTenant} com sucesso.`,
            data: { type: 'payment_confirmed_tenant', chargeId: resolvedChargeId },
            read: false,
            sent: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      } catch (notifErr) {
        console.error('Erro ao criar notificacao de pagamento:', notifErr.message);
      }
    }

    return res.status(200).send('OK');

  } catch (error) {
    if (error.message && error.message.startsWith('CHARGE_NOT_FOUND:')) {
      return res.status(404).send('Charge not found');
    }
    console.error(`Erro ao processar webhook para a cobranca ${chargeId}:`, error);
    return res.status(500).send('Internal Server Error');
  }
});
