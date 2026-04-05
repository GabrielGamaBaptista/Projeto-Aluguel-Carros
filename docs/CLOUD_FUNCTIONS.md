# CLOUD FUNCTIONS — INFRA E REFERÊNCIA

> Parte da documentação modularizada do CLAUDE.md. Consultar ao adicionar ou modificar Cloud Functions.

---

## Runtime

- Firebase Cloud Functions **gen 2** (Cloud Run), Node 20
- Todas deployadas em `us-central1`
- IAM policy `roles/run.invoker` para `allUsers` aplicada manualmente após deploy via `functions/src/scripts/apply-iam.js` (org policy bloqueia `invoker: 'public'` automático)

**IMPORTANTE**: Após qualquer `firebase deploy --only functions`, rodar o script `apply-iam.js` para liberar invocação pública.

---

## Funções deployadas (24 no total)

| Nome | Tipo | Descrição |
|------|------|-----------|
| `createAsaasSubaccount` | Callable | Onboarding do locador no Asaas |
| `checkOnboarding` | Callable | Verifica se locador tem subconta Asaas |
| `createContractCF` | Callable | Cria contrato de aluguel |
| `cancelContract` | Callable | Cancela contrato + cobranças atomicamente |
| `editContract` | Callable | Edita `rentAmount` do contrato |
| `pauseContract` | Callable | Pausa contrato (suspende cron de cobranças) |
| `createCharge` | Callable | Cria cobrança (avulsa ou de contrato) |
| `cancelCharge` | Callable | Cancela cobrança PENDING/OVERDUE |
| `editCharge` | Callable | Edita valor de cobrança PENDING |
| `getPixQrCode` | Callable | Obtém QR Code PIX de uma cobrança |
| `getCloudinarySignature` | Callable | Gera assinatura para upload seguro ao Cloudinary |
| `assignTenantCF` | Callable | Atribui locatário ao carro atomicamente (Q1.4) |
| `deleteCarCF` | Callable | Exclui carro com cascade completo (Q2.3) |
| `getTenantDetailsCF` | Callable | Retorna PII do locatário via admin SDK (Q1.2) |
| `deleteAccountCF` | Callable | Exclui conta com cascade LGPD (Q5.4) |
| `checkPiiUniqueCF` | Callable (sem auth) | Verifica unicidade de CPF/CNPJ/phone via admin SDK (Q1.2 Fase C) |
| `findEmailByIdentifierCF` | Callable (sem auth) | Busca email por CPF/CNPJ para login (Q1.2 Fase C) |
| `searchTenantsCF` | Callable | Busca locatários por email ou CPF — restrito ao locador (Q1.6) |
| `createNotificationCF` | Callable | Cria notificação com validação server-side |
| `createMuralPostCF` | Callable | Cria post no mural com validação server-side |
| `sendVerificationEmailCF` | Callable | Envia email de verificação via Resend (`@bapcar.tech`) |
| `generateRecurringCharges` | Scheduled (cron diário 08h SP) | Gera cobranças recorrentes |
| `notifyOverdueTasks` | Scheduled (cron diário) | Notifica tarefas vencidas |
| `asaasWebhook` | onRequest (HTTPS) | Recebe eventos de pagamento do Asaas |
| `sendPushNotification` | onDocumentCreated (trigger) | Envia push via FCM ao criar em `notifications/` |

---

## Push Notifications

- Trigger `sendPushNotification`: dispara ao criar qualquer documento em `notifications/{notifId}`
- Busca `fcmToken` do `userId` destinatário e envia via `admin.messaging().send()`
- Se token inválido (`registration-token-not-registered`), limpa `fcmToken` do usuário no Firestore
- As notificações chegam como **push real** (não apenas salvas no Firestore)

---

## Rate Limiting

- Todas as CFs callable têm rate limiting via `functions/src/utils/rateLimiter.js`
- Usa transação Firestore em `rateLimits/{uid}_{action}` — janela fixa de 60s
- Campo `ttlAt` nos documentos para configurar TTL policy no console (evita acúmulo)
- `HttpsError('resource-exhausted')` quando excedido (HTTP 429)

| CF | Limite por minuto |
|----|-------------------|
| `createCharge`, `getPixQrCode`, `createNotificationCF`, `createMuralPostCF`, `getTenantDetailsCF` | 30 |
| `cancelCharge`, `editCharge`, `searchTenantsCF` | 20 |
| `createContractCF`, `cancelContract`, `editContract`, `pauseContract`, `assignTenantCF`, `checkPiiUniqueCF`*, `findEmailByIdentifierCF`* | 10 |
| `sendVerificationEmailCF` | 5 |
| `deleteCarCF` | 5 |
| `deleteAccountCF` | 2 |

*`checkPiiUniqueCF` e `findEmailByIdentifierCF` limitam por IP (sem auth)

---

## Estrutura de handlers em `functions/src/handlers/`

| Arquivo | Funções |
|---------|---------|
| `onboarding.js` | `createAsaasSubaccount`, `checkOnboarding` |
| `charges.js` | `createCharge`, `cancelCharge`, `editCharge`, `getPixQrCode`, `generateRecurringCharges` |
| `contracts.js` | `createContractCF`, `cancelContract`, `editContract`, `pauseContract` |
| `webhooks.js` | `asaasWebhook` |
| `cloudinarySign.js` | `getCloudinarySignature` |
| `notifications.js` | `sendPushNotification` |
| `taskNotifications.js` | `notifyOverdueTasks` |
| `tenantAssignment.js` | `assignTenantCF` |
| `carManagement.js` | `deleteCarCF` |
| `userProfile.js` | `getTenantDetailsCF` |
| `accountDeletion.js` | `deleteAccountCF` |
| `piiQueries.js` | `checkPiiUniqueCF`, `findEmailByIdentifierCF` |
| `tenantSearch.js` | `searchTenantsCF` |
| `createNotification.js` | `createNotificationCF` |
| `muralHandler.js` | `createMuralPostCF` |
| `email.js` | `sendVerificationEmailCF` |
