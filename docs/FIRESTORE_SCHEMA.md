# FIRESTORE — COLEÇÕES E ESQUEMA

> Parte da documentação modularizada do CLAUDE.md. Consultar ao adicionar/modificar campos no Firestore.

---

## `users/{userId}`

```javascript
{
  // === DOC PÚBLICO === (sem PII — Q1.2 Fase C)
  email: string,                    // email (lowercase)
  name: string,
  role: 'locador' | 'locatario',
  authProvider: 'email' | 'google',
  emailVerified: boolean,
  emailVerifiedAt: Timestamp | null,
  googlePhotoUrl: string | null,

  // FCM
  fcmToken: string | null,
  fcmTokenUpdatedAt: Timestamp | null,

  createdAt: Timestamp,
}
```

### `users/{uid}/private/data` (subcollection — PII)
Acesso apenas via admin SDK / Cloud Functions. Nunca acessar do app diretamente.

```javascript
{
  phone: string,                    // apenas dígitos (ex: "11999998888")
  cpf: string,                      // apenas dígitos (ex: "12345678900")
  cnpj: string,                     // apenas dígitos; preenchido se PJ ou MEI
  birthDate: string,                // "DD/MM/AAAA"
  personType: 'pf' | 'pj' | 'mei', // só locador seleciona; locatário é sempre 'pf'
  companyName: string,              // razão social; preenchido se PJ ou MEI

  // Endereço
  cep: string,
  street: string,
  number: string,
  complement: string,
  neighborhood: string,
  city: string,
  state: string,                    // UF (2 chars)
  address: string,                  // endereço completo formatado

  // CNH e documentos (APENAS locatário)
  cnhNumber: string,
  cnhCategory: string,              // "A", "B", "AB", "C", "D", "E", etc.
  cnhExpiry: string,                // "DD/MM/AAAA"
  cnhFrontPhoto: string,            // URL Cloudinary
  cnhBackPhoto: string,             // URL Cloudinary
  residenceProofPhoto: string,      // URL Cloudinary
}
```

---

## `cars/{carId}`

```javascript
{
  landlordId: string,               // userId do locador dono
  tenantId: string | null,          // userId do locatário atribuído (null = disponível)
  status: 'available' | 'rented',   // muda ao atribuir/remover locatário
  brand: string,                    // ex: "Toyota"
  model: string,                    // ex: "Corolla"
  year: number,
  plate: string,                    // ex: "ABC1D23" (uppercase)
  color: string,
  photo: string | null,             // URL Cloudinary da foto do carro
  initialKm: number,
  totalKm: number,                  // última quilometragem reportada
  lastOilChangeKm: number,          // km na última troca de óleo
  lastKmUpdate: Timestamp,          // quando foi a última atualização de KM
  lastPhotoInspection: Timestamp,   // quando foi a última inspeção fotográfica
  documents: {                      // objeto com documentos (PDFs no Cloudinary)
    crlve: { url, name, uploadedAt },
    ipva: { url, name, uploadedAt },
    licenciamento: { url, name, uploadedAt },
    seguro: { url, name, uploadedAt },
    crv: { url, name, uploadedAt },
  } | null,
  createdAt: Timestamp,
  updatedAt: Timestamp | null,
}
```

---

## `tasks/{taskId}`

```javascript
{
  carId: string,
  tenantId: string | null,
  landlordId: string | null,            // indexado para getAllUserTasks do locador (Q9.5)
  type: 'km_update' | 'photo_inspection' | 'oil_change' | 'maintenance',
  title: string,
  description: string,
  status: 'pending' | 'completed',
  dueDate: Timestamp,
  createdAt: Timestamp,
  completedAt: Timestamp | null,
  manualRequest: boolean,           // true = criada manualmente pelo locador

  // Aprovação (locador avalia tarefas concluídas)
  approved: boolean | undefined,
  approvedAt: Timestamp | null,
  revisionRequested: boolean | undefined,
  revisionReason: string | undefined,
  revisionRequestedAt: Timestamp | null,

  // Dados de conclusão — variam por tipo:

  // km_update:
  previousKm: number,
  newKm: number,
  dashboardPhotoUrl: string,        // foto do hodômetro

  // photo_inspection:
  // photosByAngle é um Map/Object onde cada chave é um ângulo
  // e o valor é um ARRAY de URLs (múltiplas fotos por ângulo são permitidas)
  photosByAngle: {
    frente: ['url1', 'url2', ...],       // array de URLs
    traseira: ['url1', ...],
    lado_esquerdo: ['url1', ...],
    lado_direito: ['url1', ...],
    painel: ['url1', ...],
    banco_dianteiro: ['url1', ...],
    banco_traseiro: ['url1', ...],
    porta_malas: ['url1', ...],
    motor: ['url1', ...],
  },

  // oil_change:
  previousOilKm: number,
  currentKm: number,
  stickerPhotoUrl: string,          // foto do adesivo
  receiptPhotoUrl: string,          // foto do recibo

  // maintenance:
  maintenanceDescription: string,
  maintenanceType: string,
  maintenancePhotos: [url, ...],
  maintenanceCost: string,
  maintenanceDate: string,
  workshopName: string,
}
```

---

## `tenantRequests/{requestId}`

```javascript
{
  landlordId: string,
  tenantId: string,
  carId: string,
  carInfo: string,                  // ex: "Toyota Corolla (ABC1D23)"
  landlordName: string,
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled',
  createdAt: Timestamp,
  respondedAt: Timestamp | null,
}
```

---

## `mural/{postId}`

```javascript
{
  landlordId: string,
  title: string,
  content: string,
  category: 'geral' | 'pagamento' | 'contato' | 'regras' | 'aviso' | 'urgente',
  targetType: 'all' | 'specific',
  targetTenantId: string | null,    // se específico para um locatário
  targetCarId: string | null,       // se específico para um carro
  pinned: boolean,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

---

## `notifications/{notifId}`

```javascript
{
  userId: string,                   // destinatário
  title: string,
  body: string,
  data: object,                     // metadados (carId, type, etc.)
  read: boolean,
  sent: boolean,
  createdAt: Timestamp,
}
```

---

## `asaasAccounts/{userId}`

```javascript
{
  asaasAccountId: string,           // ID da subconta no Asaas
  walletId: string,                 // Wallet ID da subconta
  apiKey: string,                   // API Key da subconta (NUNCA exposta ao cliente)
  status: string,                   // status da subconta no Asaas
  isCreating: boolean,              // true enquanto o onboarding está em andamento (lock TTL 10min)
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

> **CRITICO**: Nunca ler/escrever `asaasAccounts` do app. Firebase Security Rules bloqueia acesso do cliente. Apenas Cloud Functions via admin SDK.

---

## `rentalContracts/{contractId}`

```javascript
{
  carId: string,
  tenantId: string,
  landlordId: string,
  rentAmount: number,               // valor padrão recorrente do aluguel
  frequency: 'MONTHLY' | 'WEEKLY' | 'BIWEEKLY',
  billingType: 'PIX' | 'BOLETO',
  startDate: string,                // "YYYY-MM-DD"
  nextDueDate: string,              // "YYYY-MM-DD" — próxima data a ser cobrada pelo cron
  dayOfMonth: number | null,        // dia alvo para cobranças mensais
  carInfo: string,                  // ex: "Toyota Corolla (ABC1D23)"
  tenantName: string,
  landlordName: string,
  active: boolean,                  // false quando contrato encerrado
  pausedAt: Timestamp | null,
  cancelledAt: Timestamp | null,
  nextChargeOverride: {             // override pontual do valor da próxima cobrança (mensal)
    amount: number,
    setAt: Timestamp,
  } | null,
  lastRecurringError: string | undefined,   // última mensagem de erro do cron
  lastRecurringErrorAt: Timestamp | undefined,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

---

## `charges/{chargeId}`

```javascript
{
  contractId: string | null,        // null se cobrança avulsa
  carId: string,
  landlordId: string,
  tenantId: string,
  amount: number,                   // valor cobrado
  netAmount: number | null,         // valor líquido após taxa Asaas (preenchido pelo webhook)
  platformFee: number | null,       // taxa da plataforma (preenchida pelo webhook)
  billingType: 'PIX' | 'BOLETO',
  status: 'PENDING' | 'RECEIVED' | 'CONFIRMED' | 'OVERDUE' | 'CANCELLED',
  asaasPaymentId: string,           // ID da cobrança no Asaas
  invoiceUrl: string | null,        // URL da fatura Asaas
  bankSlipUrl: string | null,       // URL do boleto
  pixQrCodeUrl: string | null,      // URL do QR Code PIX (preenchida sob demanda)
  pixCopiaECola: string | null,     // código PIX copia-e-cola
  transactionReceiptUrl: string | null, // URL do comprovante Asaas (preenchida pelo webhook ao pagar)
  dueDate: string,                  // "YYYY-MM-DD"
  paymentDate: string | null,       // "YYYY-MM-DD" — preenchida pelo webhook quando pago
  description: string,
  carInfo: string | null,
  processedEvents: string[],        // IDs de eventos Asaas já processados (idempotência webhook)
  notificationFlags: {              // flags de idempotência para notificações do cron
    warning3Days: boolean,
  } | undefined,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```
