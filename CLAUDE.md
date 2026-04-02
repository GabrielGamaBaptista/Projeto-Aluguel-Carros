# CLAUDE.md — BapCar

App **React Native CLI** (sem Expo) para gestão de aluguel de carros. Backend **Firebase** (Firestore + Auth + FCM + Cloud Functions). Pagamentos via **Asaas**. Upload de mídia via **Cloudinary**. Roda em **Android** (iOS em andamento).

---

## DOCUMENTAÇÃO DETALHADA — LEIA ANTES DE QUALQUER IMPLEMENTAÇÃO

> **INSTRUÇÃO CRÍTICA**: Seu **primeiro passo** em qualquer tarefa é identificar o domínio na tabela abaixo e **ler o arquivo correspondente** antes de explorar o código. Os resumos neste CLAUDE.md são intencionalmente incompletos — os detalhes, regras e edge cases que previnem bugs estão nos arquivos `docs/`.

| Domínio | Arquivo | Quando consultar |
|---------|---------|-----------------|
| Esquemas do Firestore (campos, tipos) | `docs/FIRESTORE_SCHEMA.md` | Ao adicionar/modificar campos em qualquer coleção |
| Índices compostos + regras de segurança | `docs/FIRESTORE_INDEXES.md` | Ao criar novas queries ou índices |
| Fluxos de autenticação e negócio | `docs/FLOWS.md` | Ao modificar login, cadastro, tarefas, mural, vínculo locador↔locatário |
| Sistema de pagamentos (Asaas) | `docs/PAYMENTS.md` | Ao trabalhar em contratos, cobranças, webhook, QR PIX |
| Cloud Functions | `docs/CLOUD_FUNCTIONS.md` | Ao adicionar/modificar qualquer Cloud Function |
| Navegação e componentes reutilizáveis | `docs/NAVIGATION_COMPONENTS.md` | Ao adicionar telas ou usar componentes compartilhados |
| Design system e identidade visual | `docs/VISUAL.md` | Ao criar ou modificar UI/estilos |
| Decisões de arquitetura (Q-codes) | `docs/QUESTIONS.md` | Ao entender o "porquê" de uma decisão técnica |
| Pipeline iOS | `docs/PLANO-IOS.md` | Ao trabalhar em suporte iOS |
| Diretrizes de segurança | `docs/seguranca_claude.md` | Ao implementar features sensíveis (auth, PII, pagamentos) |

---

## STACK TÉCNICA

**Plataforma**: React Native CLI | Android | TypeScript (telas .tsx) / JavaScript (services .js)

**Pacotes principais**
```
# Firebase
@react-native-firebase/app, /auth, /firestore, /messaging, /functions
@react-native-google-signin/google-signin

# Navegação
@react-navigation/native, /native-stack, /bottom-tabs, /material-top-tabs
react-native-pager-view, react-native-screens, react-native-safe-area-context

# UI / Mídia
lucide-react-native            (ícones)
react-native-image-picker      (câmera/galeria)
react-native-gifted-charts     (gráficos)
react-native-svg               (dep. do gifted-charts)
react-native-linear-gradient
react-native-flash-message     (toasts)

# Storage / Docs
@react-native-async-storage/async-storage
@react-native-clipboard/clipboard
@react-native-documents/picker

# Utils
date-fns                       (só differenceInDays em tasksService.js)
```

**Serviços externos**
- **Firebase**: Firestore (banco), Auth, FCM (push), Cloud Functions gen 2 (Node 20, us-central1)
- **Cloudinary**: upload de fotos/docs — cloud name `dzjqdjdcz`
- **ViaCEP**: autocomplete de CEP — `https://viacep.com.br/ws/{cep}/json/`
- **Asaas**: gateway de pagamento (PIX, boleto) — cada locador tem subconta própria

---

## ESTRUTURA DE PASTAS

```
/
├── App.tsx                    # entry point: navegação, tabs, auth flow
├── functions/                 # Cloud Functions (Node 20, gen 2) — 24 funções
│   ├── index.js               # exports de todas as CFs
│   └── src/
│       ├── asaas/             # cliente HTTP e helpers da API Asaas
│       ├── handlers/          # um arquivo por domínio de CF (charges, contracts, webhooks, etc.)
│       ├── scripts/           # apply-iam.js (pós-deploy), scripts de migração
│       ├── tests/             # testes de CFs e mocks
│       └── utils/             # validators.js, rateLimiter.js
├── src/
│   ├── config/                # firebase.js, cloudinary.js — inicialização de SDKs
│   ├── services/              # toda comunicação com Firebase/APIs; um arquivo por domínio
│   ├── screens/               # telas do app (.tsx); uma por funcionalidade
│   ├── components/            # componentes reutilizáveis; financial/ para o dashboard
│   └── utils/                 # validation.js, retry.js, cache.js
└── android/                   # config nativa Android
```

> Para a lista completa de arquivos por pasta, use as ferramentas de leitura de diretório. A estrutura acima descreve o propósito de cada camada.

---

## FIRESTORE

O banco é **Firestore** (NoSQL). PII de usuários (CPF, CNPJ, telefone) fica em subcollection separada `users/{uid}/private/data` — inacessível pelo app, apenas via Cloud Functions com admin SDK. As demais coleções são acessadas diretamente pelo app com as regras definidas em `firestore.rules`.

| Coleção | Propósito |
|---------|-----------|
| `users/{uid}` | Perfil público (sem PII). PII em `users/{uid}/private/data` |
| `cars/{carId}` | Veículos — pertence ao locador, opcionalmente atribuído a locatário |
| `tasks/{taskId}` | Tarefas (km, foto, óleo, manutenção) — pendentes e concluídas |
| `tenantRequests/{id}` | Solicitações de vínculo locador→locatário |
| `mural/{postId}` | Avisos do mural criados pelo locador |
| `notifications/{id}` | Notificações in-app — trigger Firestore dispara push FCM real |
| `asaasAccounts/{uid}` | Subcontas Asaas — **bloqueado para o app**, apenas CFs via admin SDK |
| `rentalContracts/{id}` | Contratos de aluguel (max 1 ativo por carro) |
| `charges/{id}` | Cobranças individuais (avulsas ou vinculadas a contrato) |

**Ao modificar campos, criar queries ou índices → leia `docs/FIRESTORE_SCHEMA.md` e `docs/FIRESTORE_INDEXES.md`.**

---

## FLUXOS DE AUTENTICAÇÃO E NEGÓCIO

O app tem dois papéis: **locador** (dono dos carros) e **locatário** (motorista). O cadastro coleta dados em steps progressivos (4 steps para locador, 6 para locatário incluindo CNH). Login aceita email ou CPF (via `findEmailByIdentifierCF`). Locadores atribuem locatários via sistema de solicitação — o locatário aceita ou recusa. Tarefas são geradas automaticamente (km a cada 7 dias, foto a cada 10, óleo a cada 10.000 km) e também manualmente pelo locador.

**Ao modificar login, cadastro, vínculo locador↔locatário ou fluxo de tarefas → leia `docs/FLOWS.md`.**

---

## SISTEMA DE PAGAMENTOS

Cada locador tem uma **subconta Asaas** (gateway de pagamento) criada via onboarding. Contratos geram cobranças recorrentes via cron diário. O webhook Asaas atualiza status em tempo real. A `apiKey` da subconta nunca sai do Firestore — toda interação com Asaas é via Cloud Functions. Há regras de idempotência, tratamento de race conditions e ordem de operações críticas que **não estão documentadas aqui**.

**Ao trabalhar em qualquer feature de pagamento → leia `docs/PAYMENTS.md`.**

---

## CLOUD FUNCTIONS

São **24 funções** no total, deployadas como gen 2 (Cloud Run) em `us-central1`, Node 20. Divididas em: callables (chamadas pelo app), scheduled (cron) e triggers (Firestore). Todas as callables têm rate limiting via `rateLimiter.js`. **Atenção pós-deploy**: a org policy do GCP bloqueia `invoker: 'public'` automático — é obrigatório rodar `apply-iam.js` após cada deploy para liberar invocação pública.

**Ao adicionar ou modificar qualquer Cloud Function → leia `docs/CLOUD_FUNCTIONS.md`.**

---

## NAVEGAÇÃO E TELAS

O app usa React Navigation com **bottom tabs** (Carros, Tarefas, Pagamentos¹, Mural², Financeiro², Perfil) e um **stack navigator** para telas de detalhe. ¹Visível só para locatário. ²Visível só para locador. Componentes reutilizáveis principais: `ImageViewer`, `PhotoPicker`, `DocumentPicker`, e os componentes da pasta `financial/`.

**Ao adicionar telas, modificar navegação ou usar componentes compartilhados → leia `docs/NAVIGATION_COMPONENTS.md`.**

---

## PADRÕES DE CÓDIGO

### Services
- Retornam `{ success: boolean, data?: any, error?: string }` — **exceto `paymentService`**
- `paymentService` usa `fn().httpsCallable(...)` e retorna `result.data` diretamente; erros retornam `{ success: false, error: error.message }`
- Usar `firestore()` de `../config/firebase`; timestamps com `firestore.FieldValue.serverTimestamp()`

### Screens
- Arquivos `.tsx`, StyleSheet inline no final do arquivo
- Texto no código **sem acentos** (ex: "Atualizacao") para evitar problemas de encoding
- **Não usar `Alert.prompt`** — só existe no iOS; usar `Alert.alert`

### Paleta de cores
- Primária: `#4F46E5` | Sucesso: `#059669` / bg `#D1FAE5` | Erro: `#DC2626` / bg `#FEE2E2`
- Warning: `#F59E0B` / bg `#FEF3C7` | Background: `#F3F4F6` | Cards: `#fff` borderRadius 12

**Ao trabalhar em UI/estilização → leia `docs/VISUAL.md`.**

### Validação
Funções client-side em `src/utils/validation.js`: `validateCpf`, `validateEmail`, `validateDate`, `validatePhone`, `validatePassword`, `sanitizeText`, `sanitizeNumeric`, `fetchAddressByCep`, `formatCep`

### Índices Firestore
- Ao criar índice: documentar em `docs/FIRESTORE_INDEXES.md` e atualizar `firestore.indexes.json`

---

## OBSERVAÇÕES IMPORTANTES PARA DESENVOLVIMENTO

1. **Firebase config**: `src/config/firebase.js` exporta `{ auth, firestore, messaging }` via `@react-native-firebase`. Não usar `firebase/app` do SDK web.

2. **Google Sign-In**: Configurado em `App.tsx` com `authService.configureGoogleSignIn(GOOGLE_WEB_CLIENT_ID)`. Web Client ID vem do Firebase Console → Auth → Sign-in method → Google.

3. **CEP Autocomplete**: Usar `fetchAddressByCep` de `validation.js`. Handler de CEP é idêntico em RegisterScreen e GoogleCompleteProfileScreen — manter assim para consistência.

4. **Locatário só pode ter 1 carro**: Verificado por `carsService.checkTenantHasCar()` antes de atribuir. (fluxo completo em `docs/FLOWS.md`)

5. **Tarefas não são deletadas ao remover locatário**: As tarefas pendentes permanecem no Firestore. (detalhes em `docs/FLOWS.md`)

6. **Documentos do carro**: PDFs no Cloudinary. Tipos: `crlve`, `ipva`, `licenciamento`, `seguro`, `crv`. Cada um como `{ url, name, uploadedAt }` em `car.documents`. (schema completo em `docs/FIRESTORE_SCHEMA.md`)

7. **9 ângulos de foto obrigatórios** (inspeção fotográfica): frente, traseira, lado_esquerdo, lado_direito, painel, banco_dianteiro, banco_traseiro, porta_malas, motor. (fluxo de conclusão de tarefa em `docs/FLOWS.md`)

8. **Formatação de dados**: CPF sem máscara (11 dígitos), CNPJ (14), telefone (10-11), CEP (8). Formatação só na UI.

9. **Texto sem acentos no código**: "Atualizacao" em vez de "Atualização" — evita problemas de encoding.

10. **Não usar `Alert.prompt`** em Android — só existe no iOS. Usar `Alert.alert` como fallback.

11. **date-fns**: Usar apenas `differenceInDays` de `tasksService.js`. Não importar outras funções.

12. **Estilo consistente**: Cor primária `#4F46E5`, background `#F3F4F6`, cards brancos borderRadius 12. Manter em novas telas.

13. **Cloud Functions — deploy e IAM**: Após `firebase deploy --only functions`, rodar `functions/src/scripts/apply-iam.js` para liberar invocação pública. A org policy do GCP bloqueia `invoker: 'public'` automático do gen 2.

14. **paymentService — padrão diferente**: Usa `httpsCallable`, retorna `result.data`. Erros: `{ success: false, error: error.message }`.

15. **asaasAccounts**: Nunca ler/escrever do app — Firebase Security Rules bloqueia. Apenas Cloud Functions via admin SDK.

16. **Contrato único por carro**: Max 1 contrato ativo. Criação usa transação Firestore (previne race condition). (detalhes de contratos em `docs/PAYMENTS.md`)

17. **PermissionsScreen**: Exibida após verificação de email (primeira vez). Solicita permissões de notificação.

18. **PII em subcollection private** (Q1.2 Fase C): CPF, CNPJ, phone ficam em `users/{uid}/private/data`. Login por CPF usa `findEmailByIdentifierCF`. Queries precisam de fieldOverrides com `queryScope: COLLECTION_GROUP`.

19. **Secrets via defineSecret**: `ASAAS_API_KEY`, `ASAAS_PLATFORM_WALLET_ID`, `ASAAS_WEBHOOK_TOKEN`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — gerenciados via Firebase Secret Manager. Configurar com `firebase functions:secrets:set <NAME>` antes de novo deploy.

---

## FERRAMENTAS DE DESENVOLVIMENTO — GEMINI MCP

### Invocação
```
mcp__gemini-cli__ask-gemini
  prompt: "..."
  model: "gemini-3.1-pro-preview"   ← padrão para todas as chamadas
  changeMode: false                  ← Gemini só gera relatório, não aplica patches
```

| Modelo | ID | Quando usar |
|---|---|---|
| Gemini 3.1 Pro | `gemini-3.1-pro-preview` | **Padrão** — auditorias, análises complexas |
| Gemini 2.5 Flash | `gemini-2.5-flash` | Só se usuário pedir velocidade |

> `gemini-3-pro-preview` descontinuado em 26/03/2026. `mcp__gemini-cli__ping` falha com `spawn echo ENOENT` — ignorar.

### Workspace do Gemini — CRÍTICO
- **Nunca usar sintaxe `@arquivo`** no prompt — restringe o workspace ao `functions/`
- Passar conteúdo de arquivos **colado diretamente no texto** do prompt

### Divisão de responsabilidades
- **Claude faz direto**: edições cirúrgicas, bugs, mudanças em 1-3 arquivos
- **Gemini**: criação de arquivos novos grandes e auditorias / "segunda opinião"
