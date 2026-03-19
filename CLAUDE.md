# CLAUDE.md — Contexto do Projeto AluguelCarrosApp

## VISÃO GERAL

Este é um aplicativo **React Native** (CLI, sem Expo) para **gestão de aluguel de carros** entre locadores e locatários. O backend é **Firebase** (Firestore + Auth + Cloud Messaging). Upload de fotos e documentos usa **Cloudinary**. O app roda apenas em **Android** no momento.

O app facilita o relacionamento locador ↔ locatário, onde:
- O **locador** cadastra veículos, atribui locatários via solicitação, cria tarefas (KM, fotos, óleo, manutenção), aprova tarefas concluídas e publica avisos no mural.
- O **locatário** recebe solicitações de vínculo, visualiza seus carros atribuídos, completa tarefas enviando dados/fotos, solicita manutenção e vê avisos do mural.

---

## STACK TÉCNICA

### Plataforma
- React Native CLI (sem Expo)
- Android (iOS em andamento)
- Linguagem: JavaScript/TypeScript (telas em .tsx, serviços em .js)

### Pacotes principais (manter estas versões)
```
@react-native-firebase/app
@react-native-firebase/auth
@react-native-firebase/firestore
@react-native-firebase/messaging
@react-native-firebase/functions    (para chamadas às Cloud Functions)
@react-native-google-signin/google-signin
@react-navigation/native
@react-navigation/native-stack
@react-navigation/bottom-tabs
@react-navigation/material-top-tabs (para top tabs no FinancialDashboard)
react-native-pager-view             (dependência do material-top-tabs)
react-native-image-picker           (para PhotoPicker)
react-native-pdf                    (para PdfViewer)
react-native-blob-util              (download de PDFs)
react-native-gifted-charts          (gráfico de barras no ResumoTab)
react-native-svg                    (dependência do gifted-charts)
date-fns                            (para differenceInDays em tasksService)
```

### Serviços externos
- **Firebase**: Firestore (banco), Auth (autenticação), Cloud Messaging (notificações push), Cloud Functions (lógica de pagamentos)
- **Cloudinary**: Upload de fotos/documentos (cloud name: `dzjqdjdcz`)
- **ViaCEP API**: Autocomplete de endereço por CEP (`https://viacep.com.br/ws/{cep}/json/`)
- **Asaas**: Gateway de pagamento (PIX, boleto). Cada locador tem uma subconta Asaas.

---

## ESTRUTURA DE PASTAS

```
/
├── App.tsx                          # Entry point, navegação, tabs, auth flow
├── functions/                       # Firebase Cloud Functions (Node 20, gen 2)
│   ├── index.js                     # Exports de todas as Cloud Functions
│   └── src/
│       ├── asaas/
│       │   ├── client.js            # Axios config + createSubaccountClient(apiKey)
│       │   ├── accounts.js          # createSubaccount (onboarding Asaas)
│       │   ├── customers.js         # createOrGetCustomer
│       │   └── payments.js          # createPayment, getPixQrCode
│       ├── handlers/
│       │   ├── onboarding.js        # createAsaasSubaccount (callable)
│       │   ├── charges.js           # createCharge, generateRecurringCharges (cron)
│       │   ├── contracts.js         # createContract (callable)
│       │   ├── webhooks.js          # asaasWebhook (onRequest — recebe eventos Asaas)
│       │   └── cloudinarySign.js    # getCloudinarySignature (callable)
│       └── utils/
│           └── validators.js
├── src/
│   ├── config/
│   │   ├── firebase.js              # export { auth, firestore, messaging }
│   │   └── cloudinary.js            # getPdfPreviewUrl, getPdfFullUrl, CLOUD_NAME
│   ├── services/
│   │   ├── authService.js           # Login, registro, Google Sign-In, verificação email
│   │   ├── carsService.js           # CRUD carros, assign/remove tenant
│   │   ├── tasksService.js          # CRUD tarefas, geração automática, aprovação
│   │   ├── tenantRequestService.js  # Solicitações de vínculo locador→locatário
│   │   ├── usersService.js          # getUserById, getAvailableTenants, searchByEmail
│   │   ├── muralService.js          # CRUD posts do mural
│   │   ├── notificationService.js   # FCM tokens, createNotification
│   │   └── paymentService.js        # Contratos, cobranças, dashboard financeiro
│   ├── screens/
│   │   ├── LoginScreen.tsx
│   │   ├── RegisterScreen.tsx
│   │   ├── EmailVerificationScreen.tsx
│   │   ├── PermissionsScreen.tsx    # Solicita permissões (notificações, etc.)
│   │   ├── GoogleCompleteProfileScreen.tsx
│   │   ├── HomeScreen.tsx
│   │   ├── TasksScreen.tsx
│   │   ├── TaskDetailsScreen.tsx
│   │   ├── ProfileScreen.tsx
│   │   ├── CarDetailsScreen.tsx
│   │   ├── AddCarScreen.tsx
│   │   ├── EditCarScreen.tsx
│   │   ├── AssignTenantScreen.tsx
│   │   ├── TenantDetailsScreen.tsx
│   │   ├── MuralManagerScreen.tsx
│   │   ├── FinancialDashboardScreen.tsx  # Tab Financeiro do locador (top tabs)
│   │   ├── ContractDetailsScreen.tsx     # Detalhes + edição de contrato
│   │   ├── PaymentContractScreen.tsx     # Criar novo contrato de aluguel
│   │   ├── ChargesScreen.tsx             # Criar cobrança avulsa
│   │   ├── PaymentDetailsScreen.tsx      # Detalhes de uma cobrança (QR PIX, status)
│   │   └── TenantPaymentsScreen.tsx      # Aba Pagamentos do locatário
│   ├── components/
│   │   ├── ImageViewer.tsx          # Modal fullscreen zoom/share/download
│   │   ├── PhotoPicker.tsx          # Câmera ou galeria → upload Cloudinary
│   │   ├── PdfViewer.tsx            # Visualizador PDF inline
│   │   ├── DocumentPicker.tsx       # Seleção de documentos PDF
│   │   └── financial/
│   │       ├── FinancialDataContext.tsx  # Contexto compartilhado (contratos + cobranças)
│   │       ├── ResumoTab.tsx            # Cards de totais + BarChart últimos 6 meses
│   │       ├── ContratosTab.tsx         # Lista contratos → navega para ContractDetails
│   │       └── CobrancasTab.tsx         # Lista cobranças com filtros por carro e status
│   └── utils/
│       └── validation.js            # validateCpf, validateEmail, validateDate,
│                                    # validatePhone, validatePassword, sanitizeText,
│                                    # sanitizeNumeric, fetchAddressByCep, formatCep
└── android/                         # Configurações Android nativas
```

---

## FIRESTORE — COLEÇÕES E ESQUEMA

### `users/{userId}`
```javascript
{
  email: string,                    // email (lowercase)
  name: string,
  role: 'locador' | 'locatario',
  phone: string,                    // apenas dígitos (ex: "11999998888")
  authProvider: 'email' | 'google',
  emailVerified: boolean,
  emailVerifiedAt: Timestamp | null,
  googlePhotoUrl: string | null,

  // Dados pessoais (AMBOS os roles)
  cpf: string,                      // apenas dígitos (ex: "12345678900")
  birthDate: string,                // "DD/MM/AAAA"
  personType: 'pf' | 'pj' | 'mei', // só locador seleciona; locatário é sempre 'pf'
  cnpj: string,                     // apenas dígitos; preenchido se PJ ou MEI
  companyName: string,              // razão social; preenchido se PJ ou MEI

  // Endereço (AMBOS os roles)
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

  // FCM
  fcmToken: string | null,
  fcmTokenUpdatedAt: Timestamp | null,

  createdAt: Timestamp,
}
```

### `cars/{carId}`
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

### `tasks/{taskId}`
```javascript
{
  carId: string,
  tenantId: string | null,
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
  photosByAngle: {
    frente: [url, ...],
    traseira: [url, ...],
    lado_esquerdo: [url, ...],
    lado_direito: [url, ...],
    painel: [url, ...],
    banco_dianteiro: [url, ...],
    banco_traseiro: [url, ...],
    porta_malas: [url, ...],
    motor: [url, ...],
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

### `tenantRequests/{requestId}`
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

### `mural/{postId}`
```javascript
{
  landlordId: string,
  title: string,
  content: string,
  category: 'geral' | 'aviso' | 'urgente',
  targetType: 'all' | 'specific',
  targetTenantId: string | null,    // se específico para um locatário
  targetCarId: string | null,       // se específico para um carro
  pinned: boolean,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

### `notifications/{notifId}`
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

### `asaasAccounts/{userId}`
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

### `rentalContracts/{contractId}`
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

### `charges/{chargeId}`
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

---

## FIRESTORE — REGRAS DE SEGURANÇA

As regras estão em `firestore.rules` e seguem:
- `users`: escrita restrita ao próprio `userId`; leitura autenticada
- `charges`: leitura restrita a `landlordId` ou `tenantId` da cobrança; escrita apenas por autenticado
- `rentalContracts`: escrita restrita ao `landlordId`; leitura autenticada
- Demais coleções: leitura e escrita para qualquer usuário autenticado
- `asaasAccounts`: leitura/escrita bloqueada para o cliente — acessada apenas via Cloud Functions (admin SDK)

---

## FIRESTORE — QUERIES E ÍNDICES

### Estratégia de Índices

Composite indexes são bem-vindos e recomendados quando melhoram a performance das queries. **Não evitar** — usar sempre que a query precisar. A única regra é: **documentar todo índice composto** neste arquivo e manter o `firestore.indexes.json` atualizado para que o deploy funcione em qualquer ambiente.

**Workflow para novos índices:**
1. Criar a query no código normalmente (com `where`, `orderBy`, etc.)
2. Se o Firestore pedir índice, o erro inclui link direto para criação
3. Após criar, exportar: `firebase firestore:indexes > firestore.indexes.json`
4. Commitar o `firestore.indexes.json` atualizado
5. Documentar o índice na tabela abaixo

**Deploy de índices** (em qualquer ambiente novo):
```bash
firebase deploy --only firestore:indexes
```

### Registro de Índices Compostos (13 ativos)

| Coleção | Campos | Usado em |
|---------|--------|----------|
| `cars` | landlordId ↑ + createdAt ↓ | `getCarsByLandlord`, `subscribeToCars` |
| `mural_posts` | landlordId ↑ + createdAt ↓ | `getPostsByLandlord` |
| `mural_posts` | landlordId ↑ + targetType ↑ + createdAt ↓ | `getPostsForTenant` (posts gerais) |
| `mural_posts` | targetTenantId ↑ + createdAt ↓ | `getPostsForTenant` (posts específicos) |
| `tasks` | carId ↑ + status ↑ + completedAt ↑ | `getCarTasks` (completed, asc) |
| `tasks` | carId ↑ + status ↑ + completedAt ↓ | `getCarTasks` (completed, desc) |
| `tasks` | carId ↑ + status ↑ + createdAt ↓ | `getCarTasks` (por criação) |
| `tasks` | carId ↑ + status ↑ + dueDate ↑ | `getCarTasks` (pending, por prazo) |
| `tasks` | carId ↑ + type ↑ + status ↑ | `_hasPendingTask` |
| `tasks` | status ↑ + dueDate ↑ | `notifyOverdueTasks` (cron) |
| `tenantRequests` | carId ↑ + status ↑ | `getSentRequests` |
| `tenantRequests` | carId ↑ + tenantId ↑ + status ↑ | `createContract` (validação) |
| `tenantRequests` | tenantId ↑ + status ↑ + createdAt ↓ | `getPendingRequests` |

> **Manter esta tabela e o `firestore.indexes.json` atualizados** ao criar novos índices.
> Exportar: `firebase firestore:indexes > firestore.indexes.json`

---

## FLUXOS DE AUTENTICAÇÃO

### Cadastro Email (RegisterScreen)
1. **Step 1**: Escolher role (locador / locatário)
2. **Step 2**: Nome, email, telefone, senha, confirmar senha
3. **Step 3**: CPF, data nascimento + (locador: tipo pessoa PF/PJ/MEI, CNPJ se aplicável)
4. **Step 4**: Endereço completo (CEP com autocomplete ViaCEP)
5. **(Locatário) Step 5**: CNH (número, categoria, validade, foto frente, foto verso)
6. **(Locatário) Step 6**: Comprovante de residência (foto)
7. → Conta criada → Login → EmailVerificationScreen

**Locador**: 4 steps (até endereço) | **Locatário**: 6 steps (inclui CNH + comprovante)

### Cadastro Google (GoogleCompleteProfileScreen)
1. **Step 1**: Escolher role + nome + telefone (email vem do Google)
2. **Step 2**: CPF, data nascimento + (locador: tipo pessoa, CNPJ)
3. **Step 3**: Endereço completo (CEP com autocomplete)
4. **(Locatário) Step 4**: CNH + fotos
5. **(Locatário) Step 5**: Comprovante de residência
6. → App direto (email já verificado pelo Google)

**Locador Google**: 3 steps | **Locatário Google**: 5 steps

### Login
- Email + senha OU CPF + senha (detecta automaticamente)
- Google Sign-In
- "Esqueci minha senha" → envia link de reset

### Verificação de Email
- Tela dedicada com verificação automática a cada 5 segundos
- Botão "Já Verifiquei" para check manual
- Reenviar com cooldown de 60 segundos
- Usuários Google pulam esta tela

---

## FLUXOS DE NEGÓCIO

### Atribuição de Locatário (Sistema de Solicitação)
1. Locador vai em CarDetails → "Atribuir Locatário" (AssignTenantScreen)
2. Busca por **email** (prefix match) ou **CPF** (match exato)
3. Clica "Enviar" → cria `tenantRequest` com status `pending`
4. Locatário vê card na HomeScreen seção "Solicitações Pendentes"
5. **Aceitar**: `tenantRequest` → `accepted`, carro recebe `tenantId`, outras solicitações pendentes para o mesmo carro são canceladas automaticamente
6. **Recusar**: `tenantRequest` → `rejected`, locador é notificado
7. Locador pode **cancelar** solicitações enviadas

**Regra**: Cada locatário só pode ter **1 carro** atribuído por vez (verificação em `carsService.checkTenantHasCar`).

### Remoção de Locatário
- Locador pode remover via CarDetailsScreen → "Remover Locatário"
- Antes de desatribuir: `paymentService.cancelActiveContractByCar(carId)` cancela o contrato ativo + todas as cobranças PENDING/OVERDUE
- Volta carro para `status: 'available'`, `tenantId: null`
- Tarefas pendentes do carro permanecem no Firestore (não são deletadas)

### Tarefas — Geração Automática
O sistema gera tarefas automaticamente baseado em intervalos:

| Tipo | Intervalo | Prazo |
|------|-----------|-------|
| `km_update` | A cada **10 dias** sem atualização | 3 dias |
| `photo_inspection` | A cada **15 dias** sem inspeção | 5 dias |
| `oil_change` | A cada **10.000 km** rodados | 10 dias |

A geração ocorre quando `generateAutomaticTasks(carId, carData)` é chamada (tipicamente ao abrir detalhes do carro). Só gera se não houver tarefa pendente do mesmo tipo para aquele carro.

### Tarefas — Criação Manual
O locador pode criar tarefas manuais na CarDetailsScreen para qualquer tipo (`km_update`, `photo_inspection`, `oil_change`, `maintenance`). Tarefas manuais têm `manualRequest: true`.

### Tarefas — Solicitação de Manutenção pelo Locatário
O locatário pode solicitar manutenção via CarDetailsScreen (botão "Solicitar Manutenção"). Cria tarefa `maintenance` com tipo e descrição.

### Tarefas — Conclusão
Cada tipo tem formulário específico no TaskDetailsScreen:

- **km_update**: Locatário informa nova KM + foto do hodômetro
- **photo_inspection**: Locatário tira fotos em 9 ângulos obrigatórios (frente, traseira, lados, painel, bancos, porta-malas, motor)
- **oil_change**: Locatário informa KM atual + foto do adesivo + foto do recibo
- **maintenance**: Locatário descreve serviço feito + fotos + custo + data + oficina

### Tarefas — Aprovação / Revisão (Locador)
1. Locador abre tarefa concluída → vê botões "Aprovar" e "Solicitar Correção"
2. **Aprovar**: `approved: true`, badge verde "Aprovada"
3. **Solicitar Correção**: tarefa volta para `status: 'pending'`, `revisionRequested: true`, `revisionReason: "..."`, locatário é notificado
4. Locatário vê banner amarelo "Correção Solicitada" com motivo
5. Locatário refaz e completa novamente

### Mural
- Locador cria avisos com categorias: `geral`, `aviso`, `urgente`
- Pode direcionar: todos locatários, locatário específico, ou carro específico
- Posts podem ser fixados (`pinned`)
- Locatário vê posts do seu locador na HomeScreen

---

## SISTEMA DE PAGAMENTOS (ASAAS)

### Onboarding do Locador
1. Antes de criar contratos/cobranças, o locador precisa ter uma **subconta Asaas**
2. `checkOnboarding` (Cloud Function) verifica se a subconta existe no Firestore (`asaasAccounts/{uid}`)
3. Se não existe, locador chama `createAsaasSubaccount` → cria subconta via API Asaas e salva `apiKey` + `walletId` no Firestore
4. **Lock com TTL de 10 minutos** (`isCreating: true`) previne criação duplicada de subcontas
5. O webhook da Asaas é **cadastrado automaticamente** na subconta durante o onboarding
6. A `apiKey` da subconta **nunca é exposta ao app** — fica somente no Firestore, acessada apenas via Cloud Functions

### Contratos de Aluguel
1. Locador abre `CarDetailsScreen` → "Configurar Pagamento" (só disponível se carro tem locatário) → `PaymentContractScreen`
2. Preenche: valor do aluguel, frequência (mensal/semanal/quinzenal), tipo de cobrança (PIX/boleto), data inicial
3. Cloud Function `createContractCF` valida:
   - Carro pertence ao locador
   - Locatário está vinculado ao carro
   - Existe `tenantRequest` aceita entre locatário e carro
   - Não existe contrato ativo para o carro (transação Firestore para prevenir race condition)
4. Após criar contrato, cobranças iniciais são geradas automaticamente:
   - **Mensal**: 1ª cobrança criada imediatamente se `startDate == hoje`
   - **Semanal**: lote de cobranças para todo o mês atual
   - **Quinzenal**: 1ª cobrança criada imediatamente

**Regra**: Cada carro pode ter no máximo **1 contrato ativo** por vez.

### Cobranças Recorrentes (Cron)
- Cloud Function `generateRecurringCharges` executa **diariamente às 08h (America/Sao_Paulo)**
- **Mensal**: processa se `nextDueDate <= hoje + 5 dias`
- **Semanal**: processa se `nextDueDate <= último dia do mês atual` — gera lote do mês
- **Quinzenal**: processa se `nextDueDate <= hoje + 16 dias` — garante 1 cobrança futura pending
- Idempotência: ignora cobranças já existentes com mesmo `contractId + dueDate` (exceto CANCELLED)
- Em caso de falha, `nextDueDate` não avança — cron retenta no dia seguinte
- `nextChargeOverride`: se definido no contrato, a próxima cobrança mensal usa esse valor e o campo é limpo após uso

### Cobranças Avulsas
- Locador pode criar cobrança avulsa via `ChargesScreen` (sem vínculo a contrato)
- Validação: carro pertence ao locador + locatário está vinculado ao carro

### Edição de Cobrança
- Locador pode editar valor de uma cobrança PENDING/OVERDUE
- Cloud Function `editCharge`:
  1. Cria nova cobrança no Asaas com novo valor
  2. Atualiza Firestore com novo `asaasPaymentId` ANTES de deletar a antiga
  3. Deleta cobrança antiga no Asaas
  (ordem garante consistência se o webhook chegar durante a operação)

### Edição de Contrato
- Locador pode editar `rentAmount` permanente do contrato via `ContractDetailsScreen`
- Também pode definir `nextChargeOverride` para alterar o valor pontual da próxima cobrança mensal
- Cloud Function `editContract` valida ownership e que o contrato está ativo

### Cancelamento de Cobrança
- Locador pode cancelar cobranças PENDING/OVERDUE (não pode cancelar RECEIVED/CONFIRMED)
- Cloud Function `cancelCharge`:
  - Se Asaas retornar 404: prossegue (já deletado)
  - Se Asaas retornar erro não-404: faz GET para verificar status real (webhook pode ter falhado) e sincroniza Firestore

### Webhook Asaas
- URL: `https://asaaswebhook-3sd2w2j7mq-uc.a.run.app`
- Cadastrado automaticamente em cada subconta durante o onboarding
- Atualiza `status`, `paymentDate`, `netAmount`, `platformFee` no Firestore via transação atômica
- `processedEvents[]` garante idempotência (mesmo evento não processado duas vezes)
- Suporta eventos: `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED`, `PAYMENT_UPDATED`

### QR Code PIX
- Gerado sob demanda via Cloud Function `getPixQrCode`
- Somente `tenantId` ou `landlordId` da cobrança podem solicitar
- No `PaymentDetailsScreen`, QR Code recarrega automaticamente ao mudar de status PENDING → OVERDUE

### Aba Financeiro (Locador)
- Substitui a aba "Adicionar Carro" no bottom tab
- `FinancialDashboardScreen` com **top tabs**:
  - **Resumo**: cards de totais (recebido, pendente, vencido) + BarChart dos últimos 6 meses
  - **Contratos**: lista todos os contratos (ativos primeiro) → navega para `ContractDetailsScreen`
  - **Cobranças**: lista com filtros por carro e por status
- `AddCarScreen` foi movido para stack screen; card "Adicionar Carro" está na HomeScreen

### Aba Pagamentos (Locatário)
- Bottom tab 💳 "Pagamentos" visível apenas para locatários
- `TenantPaymentsScreen`: lista cobranças onde `tenantId == uid` do locatário
- Navega para `PaymentDetailsScreen` para ver detalhes e pagar via PIX

### Notificações de Pagamento
Eventos que geram notificações (salvas em `notifications/`):
- Novo contrato criado → locatário
- Contrato encerrado → locatário
- Contrato editado (valor alterado) → locatário
- Nova cobrança criada → locatário
- Cobrança cancelada → locatário
- Cobrança editada (valor alterado) → locatário
- Cobrança vencendo em 3 dias → locatário (via cron, com flag de idempotência `notificationFlags.warning3Days`)

---

## CLOUD FUNCTIONS (INFRA)

### Runtime
- Firebase Cloud Functions **gen 2** (Cloud Run), Node 20
- Todas deployadas em `us-central1`
- IAM policy `roles/run.invoker` para `allUsers` aplicada manualmente após deploy (org policy bloqueia `invoker: 'public'` automático)

### Funções deployadas
| Nome | Tipo | Descrição |
|------|------|-----------|
| `createAsaasSubaccount` | Callable | Onboarding do locador no Asaas |
| `checkOnboarding` | Callable | Verifica se locador tem subconta Asaas |
| `createContractCF` | Callable | Cria contrato de aluguel |
| `editContract` | Callable | Edita `rentAmount` do contrato |
| `createCharge` | Callable | Cria cobrança (avulsa ou de contrato) |
| `cancelCharge` | Callable | Cancela cobrança PENDING/OVERDUE |
| `editCharge` | Callable | Edita valor de cobrança PENDING |
| `getPixQrCode` | Callable | Obtém QR Code PIX de uma cobrança |
| `getCloudinarySignature` | Callable | Gera assinatura para upload seguro ao Cloudinary |
| `generateRecurringCharges` | Scheduled (cron diário 08h SP) | Gera cobranças recorrentes |
| `asaasWebhook` | onRequest (HTTPS) | Recebe eventos de pagamento do Asaas |
| `sendPushNotification` | onDocumentCreated (trigger) | Envia push via FCM ao criar em `notifications/` |

### Push Notifications via Cloud Function
- Trigger `sendPushNotification`: dispara ao criar qualquer documento em `notifications/{notifId}`
- Busca `fcmToken` do `userId` destinatário e envia via `admin.messaging().send()`
- Se token inválido (`registration-token-not-registered`), limpa `fcmToken` do usuário no Firestore
- As notificações agora chegam como **push real** (não apenas salvas no Firestore)

---

## NAVEGAÇÃO

### Bottom Tabs
| Tab | Tela | Visível para |
|-----|------|-------------|
| 🚗 Carros | HomeScreen | Ambos |
| 📋 Tarefas | TasksScreen | Ambos |
| 💳 Pagamentos | TenantPaymentsScreen | Só locatário |
| 📢 Mural | MuralManagerScreen | Só locador |
| 💰 Financeiro | FinancialDashboardScreen | Só locador |
| 👤 Perfil | ProfileScreen | Ambos |

**Nota**: `AddCarScreen` foi removido das tabs — está acessível via card na HomeScreen (locador) como stack screen.

### Stack Screens (dentro do app autenticado)
- CarDetailsScreen (detalhes + ações do carro)
- EditCarScreen (editar dados do carro)
- AddCarScreen (adicionar novo carro)
- AssignTenantScreen (buscar + enviar solicitação)
- TaskDetailsScreen (ver + completar + aprovar tarefa)
- TenantDetailsScreen (dados completos do locatário)
- ContractDetailsScreen (detalhes + edição de contrato)
- PaymentContractScreen (criar novo contrato de aluguel)
- ChargesScreen (criar cobrança avulsa)
- PaymentDetailsScreen (detalhes de uma cobrança, QR PIX)

---

## COMPONENTES REUTILIZÁVEIS

### `ImageViewer`
Modal fullscreen com zoom (pinch-to-zoom), compartilhamento e download.
```tsx
<ImageViewer visible={bool} imageUrl={string} title={string} onClose={() => void} />
```

### `PhotoPicker`
Componente que abre câmera ou galeria, faz upload para Cloudinary, retorna URL.
```tsx
<PhotoPicker label={string} onPhotoSelected={(url: string) => void} currentPhotoUrl={string|null} />
```

### `PdfViewer`
Visualizador de PDF inline usando `react-native-pdf`.

### `DocumentPicker`
Seleção de documentos PDF para upload.

---

## PADRÕES DE CÓDIGO

### Services
- Todos os services retornam `{ success: boolean, data?: any, error?: string }`
- Usam `firestore()` (importado de `../config/firebase`)
- Mutations usam `firestore.FieldValue.serverTimestamp()` para timestamps
- Erros são capturados com try/catch e logados com `console.error`

### Screens
- Arquivos .tsx com StyleSheet inline no final
- Cor primária: `#4F46E5` (indigo)
- Cor de sucesso: `#059669` / `#D1FAE5`
- Cor de erro: `#DC2626` / `#FEE2E2`
- Cor de warning: `#F59E0B` / `#FEF3C7`
- Background: `#F3F4F6`
- Cards: `#fff` com borderRadius 12 e elevation 2

### Validação
Todas as validações client-side ficam em `src/utils/validation.js`:
- `validateCpf(cpf)` — valida dígitos verificadores
- `validateEmail(email)` — regex
- `validateDate(dateStr)` — formato DD/MM/AAAA
- `validatePhone(phone)` — formato brasileiro 10-11 dígitos
- `validatePassword(password)` — retorna `{ valid, errors[] }`
- `sanitizeText(text)` — remove caracteres perigosos
- `sanitizeNumeric(text)` — extrai só números
- `fetchAddressByCep(cep)` — busca ViaCEP, retorna `{ success, data: { street, neighborhood, city, state, complement } }` ou `{ success: false, error }`
- `formatCep(text)` — formata "00000-000"

### Queries Firestore — Índices
- Usar composite indexes livremente quando a query precisar — são gratuitos e melhoram performance
- Ao criar um novo índice: documentar na tabela em "FIRESTORE — QUERIES E ÍNDICES" e atualizar `firestore.indexes.json`
- Deploy de índices: `firebase deploy --only firestore:indexes`
- Ordenação com `orderBy` no Firestore é preferível a `.sort()` client-side quando possível (mais eficiente, menos dados transferidos)

---

## CLOUDINARY

- **Cloud name**: `dzjqdjdcz`
- Upload feito pelo `PhotoPicker` usando unsigned upload preset
- Fotos são armazenadas como URLs completas Cloudinary nos documentos Firestore
- O `cloudinary.js` exporta helpers para gerar URLs de preview/full de PDFs

---

## NOTIFICAÇÕES

- Usa Firebase Cloud Messaging (FCM)
- Token FCM salvo no documento do usuário (`fcmToken`)
- `notificationService.createNotification()` cria um documento em `notifications/`
- As notificações são criadas em momentos como:
  - Tarefa automática gerada
  - Tarefa manual criada pelo locador
  - Solicitação de vínculo enviada
  - Solicitação aceita/recusada
  - Tarefa aprovada/devolvida para revisão
- Push notifications reais são enviadas pela Cloud Function `sendPushNotification` (trigger Firestore) — implementada e em produção

---

## MELHORIAS PENDENTES

- [ ] Splash screen customizada
- [ ] Suporte iOS (pipeline em andamento — ver PLANO-IOS.md)

---

## OBSERVAÇÕES IMPORTANTES PARA DESENVOLVIMENTO

1. **Firebase config**: O arquivo `src/config/firebase.js` exporta `{ auth, firestore, messaging }` usando `@react-native-firebase`. Não usar `firebase/app` do SDK web.

2. **Google Sign-In**: Configurado em `App.tsx` com `authService.configureGoogleSignIn(GOOGLE_WEB_CLIENT_ID)`. O Web Client ID vem do Firebase Console → Authentication → Sign-in method → Google.

3. **CEP Autocomplete**: Usa `fetchAddressByCep` de `validation.js`. Retorna `{ success: true, data: { street, neighborhood, city, state } }`. O handler de CEP é idêntico em RegisterScreen e GoogleCompleteProfileScreen — deve permanecer assim para consistência.

4. **Locatário só pode ter 1 carro**: Verificado por `carsService.checkTenantHasCar()` antes de atribuir.

5. **Tarefas não são deletadas ao remover locatário**: As tarefas pendentes permanecem no Firestore. Isso pode ser melhorado no futuro.

6. **Documentos do carro**: São PDFs uploadados ao Cloudinary. Tipos: `crlve`, `ipva`, `licenciamento`, `seguro`, `crv`. Cada um armazenado como `{ url, name, uploadedAt }` dentro de `car.documents`.

7. **9 ângulos de foto obrigatórios** (inspeção fotográfica): frente, traseira, lado_esquerdo, lado_direito, painel, banco_dianteiro, banco_traseiro, porta_malas, motor.

8. **Formatação de dados**: CPF armazenado sem máscara (11 dígitos), CNPJ sem máscara (14 dígitos), telefone sem máscara (10-11 dígitos), CEP sem máscara (8 dígitos). Formatação é feita na UI.

9. **Todas as telas usam texto sem acentos** no código (ex: "Atualizacao" em vez de "Atualização") para evitar problemas de encoding.

10. **Não usar `Alert.prompt`** em Android — só existe no iOS. O TaskDetailsScreen usa fallback com `Alert.alert` para solicitar motivo de revisão.

11. **date-fns**: Usamos apenas `differenceInDays` no `tasksService.js`. Não importar outras funções sem necessidade.

12. **Estilo consistente**: Todas as telas seguem o padrão visual com `#4F46E5` como cor primária, `#F3F4F6` como background, cards brancos com borderRadius 12. Manter essa consistência em novas telas.

13. **Cloud Functions — deploy e IAM**: Após qualquer `firebase deploy --only functions`, aplicar IAM policy manualmente via script (ver MEMORY.md) para liberar invocação pública. A org policy do GCP bloqueia o `invoker: 'public'` automático do gen 2.

14. **paymentService — padrão de retorno**: Diferente dos outros services, `paymentService` usa `fn().httpsCallable(...)` e retorna o `result.data` diretamente da Cloud Function. Em caso de erro, retorna `{ success: false, error: error.message }`.

15. **asaasAccounts**: Nunca tentar ler/escrever essa coleção direto do app — o Firebase Security Rules bloqueia acesso do cliente. Toda interação é via Cloud Functions (admin SDK bypassa as rules).

16. **Contrato único por carro**: Cada carro pode ter no máximo 1 contrato ativo (`active: true`). A criação usa transação Firestore para prevenir race condition.

17. **PermissionsScreen**: Tela adicionada no fluxo de onboarding, exibida após verificação de email (primeira vez). Solicita permissões de notificação antes de entrar no app.
