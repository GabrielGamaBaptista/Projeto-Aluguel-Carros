# AUDITORIA DE SEGURANCA CONSOLIDADA — BapCar

**Data:** 2026-03-28
**Auditor:** Claude Opus 4.6 (com 3 agentes de exploracao paralelos)
**Versao analisada:** master (99c7903)
**Metodologia:** Leitura integral de todos os arquivos: Firestore Rules, 18 Cloud Functions, 9 services, 21 screens, configs, infra. Validacao manual de cada achado contra codigo-fonte real.
**Relatorios consolidados:** seguranca_claude.md (v1, Sonnet 4.6), seguranca_gemini.md (Gemini)
**Falsos positivos eliminados:** 10 (detalhados na secao 2)

---

## 1. Resumo Executivo

| Severidade | Quantidade |
|---|---|
| CRITICA | 2 |
| ALTA | 6 |
| MEDIA | 9 |
| BAIXA | 6 |
| **Total confirmadas** | **23** |
| Falsos positivos eliminados | 10 |

**Areas de risco principal:**
- Notificacoes: qualquer usuario autenticado pode criar notificacao para qualquer outro (push spam/phishing)
- Cobrancas: `carId` opcional em `createCharge` permite gerar cobrancas financeiras reais contra usuarios arbitrarios
- Mural: posts com `targetType='all'` visiveis para QUALQUER usuario autenticado (vazamento cross-locador)
- FCM token no documento publico de `users/` (permite phishing via push)

**Postura geral:** Base solida — PII segregada em subcollection private, rate limiting em CFs, transacoes Firestore em operacoes criticas, campos imutaveis protegidos nas rules, webhook idempotente. As 2 vulnerabilidades criticas requerem correcao imediata antes de escalar em producao.

---

## 2. Falsos Positivos Eliminados

Achados dos relatorios anteriores que foram **descartados apos validacao contra o codigo real**:

| # | Alegacao | Por que e falso positivo | Evidencia |
|---|---|---|---|
| FP-01 | CPF/CNPJ sem validacao de digitos no servidor | `piiQueries.js` linhas 6-30 implementa `isValidCpf()` e `isValidCnpj()` com validacao mod11 completa | Onboarding le CPF do Firestore (ja validado no cadastro via `checkPiiUniqueCF`) |
| FP-02 | IDOR em `getTenantDetailsCF` | Valida ownership via query: `cars WHERE landlordId == callerId AND tenantId == target`. Se nao encontra, lanca `permission-denied` | `userProfile.js` linhas 45-49 |
| FP-03 | Injecao de `landlordId` em `addCar` | Firestore Rules linha 64-65: `request.resource.data.landlordId == request.auth.uid`. Rules impedem server-side | Regra de create em `/cars` |
| FP-04 | Leitura cross-user de `private/data` | Firestore Rules linha 39: `request.auth.uid == userId`. So o proprio usuario le sua subcollection | Testavel: query para outro uid retorna permission-denied |
| FP-05 | `getCarsByLandlord` expoe carros de outro usuario | Rules linha 60-62: read so se `landlordId == auth.uid OR tenantId == auth.uid`. Query para outro uid retorna vazio | Protecao server-side via rules |
| FP-06 | IAM `allUsers` e vulnerabilidade | Exigido pela arquitetura Firebase gen 2. Cada CF valida `request.auth` internamente. Equivale a API gateway publico | `invoker: 'public'` + check `request.auth` em cada handler |
| FP-07 | Webhook precisa de HMAC-SHA256 | Rebaixado para BAIXO. Usa `timingSafeEqual` com token compartilhado (Asaas webhook token armazenado como Firebase Secret). Metodo de autenticacao valido | `webhooks.js` linhas 23-34 |
| FP-08 | Google Sign-In sem validacao adicional de token | Firebase SDK valida aud, exp, iss automaticamente. Validacao redundante no client nao agrega seguranca | Comportamento documentado do Firebase Auth |
| FP-09 | Dados Firestore sem criptografia | Google Cloud criptografa Firestore at-rest por padrao (AES-256) | Feature built-in da plataforma |
| FP-10 | `landlordId` do client em `createContract` | Linha 183: `request.auth.uid !== landlordId` garante que so o proprio caller pode usar. Padrao accept-then-validate, nao exploravel | Comparacao estrita contra auth.uid |

---

## 3. Vulnerabilidades Confirmadas

### CRITICAS

---

#### SEC-01: Notificacoes — qualquer usuario autenticado pode criar para qualquer outro
**Severidade:** CRITICA
**Arquivo:** `firestore.rules` linhas 246-252
**Codigo vulneravel:**
```
allow create: if request.auth != null
  && request.resource.data.userId is string
  && request.resource.data.userId != request.auth.uid
  && request.resource.data.read == false
  && request.resource.data.sent == false
  && request.resource.data.createdAt == request.time;
```
**Descricao:** A regra permite que QUALQUER usuario autenticado crie um documento em `notifications/` para QUALQUER outro usuario. O trigger `sendPushNotification` (Cloud Function) envia push real ao celular do destinatario. Ha um TODO no proprio codigo (linha 236) reconhecendo o problema.
**Impacto:** Push notification spam em massa, phishing direcionado (links maliciosos no body), assedio. Atacante pode bombardear celulares de todos os usuarios com notificacoes falsas.
**Correcao recomendada:** Setar `allow create: if false` em `/notifications`. Toda criacao de notificacao ja ocorre via Cloud Functions (admin SDK) — a regra client-side e vestigio do desenvolvimento inicial.
**Esforco:** Pequeno (1 linha na rule + verificar que nenhum service cria notification pelo client SDK)

---

#### SEC-02: createCharge — carId opcional permite cobranca contra qualquer usuario
**Severidade:** CRITICA
**Arquivo:** `functions/src/handlers/charges.js` linhas 134-148
**Codigo vulneravel:**
```javascript
if (data.carId) {
  // TODA a validacao de ownership esta dentro deste if
  const carDoc = await admin.firestore().collection('cars').doc(data.carId).get();
  if (carData.landlordId !== data.landlordId) { throw ... }
  if (data.tenantId && carData.tenantId !== data.tenantId) { throw ... }
}
// Se carId nao fornecido, nenhuma validacao acontece
```
**Descricao:** O bloco de validacao de ownership (locador e dono do carro, locatario esta vinculado) esta DENTRO de `if (data.carId)`. Se o atacante omitir `carId`, toda a validacao e pulada. A funcao interna `_createChargeInternal` prossegue, cria um Customer na subconta Asaas do locador e gera uma cobranca financeira REAL (boleto/PIX) contra qualquer `tenantId` informado.
**Impacto:** Locador malicioso pode gerar cobrancas reais contra QUALQUER usuario da plataforma sem relacao de aluguel. Fraude financeira direta.
**Correcao recomendada:** Tornar `carId` obrigatorio. Adicionar antes do `if`: `if (!data.carId) throw new HttpsError('invalid-argument', 'carId e obrigatorio.')`. Se cobranças avulsas sem carro forem necessarias no futuro, validar que `tenantId` tem pelo menos 1 contrato ativo ou carro vinculado ao `landlordId`.
**Esforco:** Pequeno (3-5 linhas)

---

### ALTAS

---

#### SEC-03: Mural posts com targetType='all' legiveis por QUALQUER usuario autenticado
**Severidade:** ALTA
**Arquivo:** `firestore.rules` linhas 210-214
**Codigo vulneravel:**
```
allow read: if request.auth != null && (
  resource.data.landlordId == request.auth.uid
  || resource.data.targetType == 'all'      // <-- qualquer autenticado
  || resource.data.targetTenantId == request.auth.uid
);
```
**Descricao:** Posts com `targetType == 'all'` sao legiveis por QUALQUER usuario autenticado — incluindo locatarios de OUTROS locadores e ate outros locadores. Quebra o isolamento de dados entre locadores.
**Impacto:** Locatario A pode ler avisos do Locador B (que nao e seu locador). Exposicao de regras internas, valores de pagamento, comunicacoes privadas de locadores concorrentes.
**Correcao recomendada:** Substituir `resource.data.targetType == 'all'` por uma condicao que valide que o leitor esta vinculado a um carro do `landlordId` do post. Exemplo: criar funcao helper `isLinkedToLandlord(landlordId)` que consulta a colecao `cars`.
**Esforco:** Medio (regra + possivel indice composto)

---

#### SEC-04: FCM token armazenado no documento publico de users
**Severidade:** ALTA
**Arquivo:** `src/services/notificationService.js` linhas 179-189, `firestore.rules` linha 23
**Descricao:** O `fcmToken` e salvo diretamente em `users/{uid}` (documento publico). Como a regra `allow read: if request.auth != null` permite que qualquer autenticado leia qualquer documento de `users/`, o token FCM de todos os usuarios esta exposto.
**Impacto:** Com o FCM token, um atacante pode (em combinacao com SEC-01 ou via Firebase Admin SDK comprometido) enviar notificacoes push direcionadas. Mesmo apos correcao de SEC-01, o token continua exposto desnecessariamente.
**Correcao recomendada:** Mover `fcmToken` e `fcmTokenUpdatedAt` para `users/{uid}/private/data` (subcollection com acesso restrito ao proprio usuario). Atualizar `sendPushNotification` (Cloud Function) para ler de la (ja usa admin SDK, sem impacto nas rules).
**Esforco:** Medio (alterar notificationService.js + CF notifications.js)

---

#### SEC-05: Race condition na pre-check de assignTenant
**Severidade:** ALTA
**Arquivo:** `functions/src/handlers/tenantAssignment.js` linhas 26-38
**Codigo vulneravel:**
```javascript
// PRE-CHECK (fora da transacao):
const existingCars = await db.collection('cars')
  .where('tenantId', '==', uid).limit(1).get();
if (!existingCars.empty) throw ...;

// TRANSACAO (valida que o carro nao tem tenant, mas NAO re-valida que o tenant nao tem outro carro):
await db.runTransaction(async (tx) => {
  const carDoc = await tx.get(carRef);
  if (carData.tenantId) throw ...; // so valida o carro, nao o tenant
});
```
**Descricao:** A pre-check "tenant ja tem carro" e feita FORA da transacao. Dois requests simultaneos do mesmo tenant aceitando duas solicitacoes diferentes podem ambos passar pela pre-check e ambos executar a transacao com sucesso (cada um atribuindo o tenant a um carro diferente).
**Impacto:** Locatario vinculado a 2+ carros simultaneamente, violando regra de negocio (1 carro por locatario).
**Correcao recomendada:** Usar um documento de lock: `tenantCarLocks/{tenantId}` criado dentro da transacao. Se o doc ja existir, a transacao falha. OU: adicionar uma segunda query dentro da transacao (Firestore suporta queries em transacoes na v2).
**Esforco:** Medio

---

#### SEC-06: createCharge — contractId nao validado contra carId
**Severidade:** ALTA
**Arquivo:** `functions/src/handlers/charges.js` linhas 150-162
**Descricao:** Se `contractId` e fornecido no request, o codigo verifica idempotencia (`contractId + dueDate`) e apos criar a cobranca, avanca `nextDueDate` do contrato. Porem, nao valida que o `contractId` realmente pertence ao `carId` informado.
**Impacto:** Locador pode vincular cobranca a contrato de outro carro, corrompendo dados financeiros. O `nextDueDate` de um contrato alheio pode ser avancado indevidamente.
**Correcao recomendada:** Apos o check de idempotencia, ler o contrato e validar: `contractDoc.data().carId === data.carId && contractDoc.data().landlordId === request.auth.uid`.
**Esforco:** Pequeno (5-8 linhas)

---

#### SEC-07: Sem limites de tamanho em notificacoes nas Firestore Rules
**Severidade:** ALTA
**Arquivo:** `firestore.rules` linhas 246-252
**Descricao:** A regra de create para `/notifications` nao valida tamanho de `title`, `body` ou do objeto `data`. Um usuario pode criar notificacoes com payloads de megabytes.
**Impacto:** DoS via documentos gigantes no Firestore, custo de armazenamento/leitura elevado, possivel crash do app do destinatario ao renderizar notificacao gigante.
**Correcao recomendada:** Adicionar validacoes de tamanho: `request.resource.data.title.size() <= 200 && request.resource.data.body.size() <= 500`. Nota: este achado se torna irrelevante se SEC-01 for corrigido (allow create: if false), mas vale como defesa em profundidade.
**Esforco:** Pequeno (2 linhas na rule)

---

#### SEC-08: Mural targetTenantId nao validado contra locatarios do locador
**Severidade:** ALTA
**Arquivo:** `firestore.rules` linhas 216-219
**Descricao:** A regra de create para `mural_posts` valida que o `landlordId` e o caller e que o `role` e locador. Porem, nao valida que `targetTenantId` e realmente um locatario vinculado a um carro do locador. Um locador pode descobrir o UID de locatarios de outro locador (via SEC-09) e enviar posts do mural direcionados a eles.
**Impacto:** Spam/phishing cross-locador via mural + notificacao push. Locatario recebe mensagem de locador com quem nao tem relacao.
**Correcao recomendada:** Mover criacao de posts do mural para Cloud Function que valida o vinculo landlord-tenant via colecao `cars` (WHERE landlordId == caller AND tenantId == targetTenantId).
**Esforco:** Medio (nova CF ou validacao na rule com get())

---

### MEDIAS

---

#### SEC-09: Colecao users publicamente legivel por qualquer autenticado
**Severidade:** MEDIA
**Arquivo:** `firestore.rules` linha 23
**Codigo:** `allow read: if request.auth != null;`
**Descricao:** Qualquer usuario autenticado pode ler o documento publico de QUALQUER outro usuario. Campos expostos: `name`, `email`, `googlePhotoUrl`, `role`, `fcmToken`.
**Impacto:** Enumeracao de emails/nomes de todos os usuarios, harvesting para spam externo, mapeamento de UIDs.
**Correcao recomendada:** Restringir leitura ao proprio usuario (`request.auth.uid == userId`) ou a pares vinculados via `cars`. Acessos cross-user legitimoss (ex: nome do locatario no contrato) devem usar Cloud Functions.
**Esforco:** Grande (impacta multiplas telas que fazem queries de users)

---

#### SEC-10: Rate limit de checkPiiUniqueCF por IP (spoofavel)
**Severidade:** MEDIA
**Arquivo:** `functions/src/handlers/piiQueries.js` linhas 43-46
**Codigo:**
```javascript
const ip = request.rawRequest?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
  || request.rawRequest?.ip || 'unknown';
await checkRateLimit(`ip_${ip}`, 'checkPiiUnique', 10, 60000);
```
**Descricao:** Endpoints sem autenticacao (`checkPiiUniqueCF`, `findEmailByIdentifierCF`) usam rate limit por IP. O header `x-forwarded-for` pode ser manipulado por proxy.
**Impacto:** Enumeracao de CPFs cadastrados na plataforma (verificar se pessoa especifica usa o app).
**Correcao recomendada:** Implementar Firebase App Check para endpoints sem auth. Como medida imediata, usar `request.rawRequest?.ip` (IP real do Cloud Run, nao o header) como fonte primaria.
**Esforco:** Medio (App Check requer configuracao no app + console Firebase)

---

#### SEC-11: Upload Cloudinary sem validacao de tamanho/tipo de arquivo
**Severidade:** MEDIA
**Arquivo:** `src/config/cloudinary.js` linhas 18-48
**Descricao:** `uploadImageToCloudinary()` nao valida tamanho do arquivo antes do envio. MIME type e hardcoded como `image/jpeg` sem verificar conteudo real. `uploadFileToCloudinary()` idem para PDFs.
**Impacto:** Upload de arquivos arbitrariamente grandes (custo Cloudinary), possivel upload de conteudo nao-imagem.
**Correcao recomendada:** Validar tamanho maximo (10MB para fotos, 20MB para PDFs) via `react-native-image-picker` options (`maxWidth`, `maxHeight`) e verificacao de `fileSize` antes do upload. Server-side: adicionar parametro `max_file_size` na assinatura Cloudinary.
**Esforco:** Pequeno

---

#### SEC-12: Cloudinary — pasta compartilhada para todos os usuarios
**Severidade:** MEDIA
**Arquivo:** `functions/src/handlers/cloudinarySign.js`
**Codigo:** `const folder = 'aluguel-carros';`
**Descricao:** Todos os uploads vao para a mesma pasta no Cloudinary. Nao ha isolamento por usuario.
**Impacto:** Colisao de nomes de arquivos (improvavel com UUIDs, mas possivel), dificuldade de auditoria por usuario, impossibilidade de aplicar quotas por usuario no Cloudinary.
**Correcao recomendada:** Usar pasta com escopo do usuario: `aluguel-carros/{uid}/`. Passar `uid` do `request.auth.uid` no momento de gerar a assinatura.
**Esforco:** Pequeno

---

#### SEC-13: Sem validacao de enum em Cloud Functions
**Severidade:** MEDIA
**Arquivos:** `contracts.js` linha 187, `charges.js` linha 124
**Descricao:** Campos como `frequency`, `billingType`, `category` sao aceitos sem validacao de whitelist. Valores invalidos passam para o Asaas ou sao gravados no Firestore.
**Impacto:** Erros no Asaas, dados inconsistentes no banco, comportamento inesperado no cron de cobrancas recorrentes.
**Correcao recomendada:** Adicionar whitelists: `if (!['MONTHLY','WEEKLY','BIWEEKLY'].includes(frequency)) throw ...`, `if (!['PIX','BOLETO'].includes(billingType)) throw ...`.
**Esforco:** Pequeno (5-10 linhas por CF)

---

#### SEC-14: Sem validacao de tamanho de strings em Cloud Functions
**Severidade:** MEDIA
**Arquivos:** Multiplos handlers (`charges.js`, `contracts.js`, `carManagement.js`)
**Descricao:** Campos como `description`, `carInfo`, `tenantName`, `landlordName` sao aceitos sem limite de comprimento. Um payload com strings de 1MB passaria.
**Impacto:** Bloat de banco de dados, DoS parcial, custos elevados de Firestore.
**Correcao recomendada:** Criar helper `validateStringLength(field, value, maxLen)` e aplicar em todas as CFs callable. Limites sugeridos: `description` 500, `carInfo` 100, nomes 200.
**Esforco:** Pequeno (helper + chamadas)

---

#### SEC-15: Webhook aceita eventos desconhecidos silenciosamente
**Severidade:** MEDIA
**Arquivo:** `functions/src/handlers/webhooks.js` linhas 158-161
**Codigo:**
```javascript
default:
  logger.info('webhook.unknownEvent', { event, chargeId });
  break;
```
**Descricao:** Eventos desconhecidos sao logados mas a transacao prossegue e faz commit (adicionando o evento a `processedEvents` sem alterar status). Se o Asaas adicionar novos tipos de evento no futuro, eles serao silenciosamente ignorados.
**Impacto:** Baixo — comportamento atual e aceitavel (nao altera status). Mas vale documentar.
**Correcao recomendada:** Retornar `null` no `default` case para evitar commit desnecessario da transacao. Adicionar alerta (logger.warn) para visibilidade.
**Esforco:** Pequeno

---

#### SEC-16: Deep link handler confia em parametros de navegacao sem validacao de auth
**Severidade:** MEDIA
**Arquivo:** `src/services/notificationService.js` linhas 28-101
**Descricao:** Ao receber notificacao push, o handler extrai `taskId`, `carId`, `chargeId` do payload e navega diretamente para a tela correspondente sem validar se o usuario tem acesso ao recurso.
**Impacto:** Limitado — as Firestore Rules bloqueiam leitura nao autorizada, entao a tela mostraria erro. Porem, a tentativa de navegacao revela existencia do recurso.
**Correcao recomendada:** Cada tela destino deve validar ownership antes de renderizar dados. Fallback para HomeScreen se recurso nao pertencer ao usuario.
**Esforco:** Medio

---

#### SEC-17: Sem timeout de sessao / logout por inatividade
**Severidade:** MEDIA
**Arquivo:** `App.tsx`
**Descricao:** A sessao Firebase Auth persiste indefinidamente enquanto o token for valido. Nao ha logout automatico por inatividade.
**Impacto:** Dispositivo roubado/emprestado mantem acesso total ao app, incluindo operacoes financeiras (criar cobrancas, cancelar contratos).
**Correcao recomendada:** Implementar listener de `AppState` que marca timestamp da ultima interacao. Ao retornar do background apos 30 minutos, exigir re-autenticacao (PIN, biometria ou login).
**Esforco:** Medio

---

### BAIXAS

---

#### SEC-18: Mensagens de erro expoe detalhes internos em algumas CFs
**Severidade:** BAIXA
**Arquivos:** `tenantSearch.js` linha 72, `carManagement.js`, outros
**Exemplo:** `throw new HttpsError('internal', 'Erro ao buscar locatarios: ' + err.message);`
**Descricao:** Algumas CFs concatenam `err.message` (que pode conter nomes de colecoes, UIDs, detalhes do Firestore) na resposta ao client.
**Impacto:** Information disclosure — facilita reconnaissance da estrutura interna.
**Correcao recomendada:** Usar mensagens genericas: `throw new HttpsError('internal', 'Erro interno. Tente novamente.')`. Manter `err.message` apenas nos logs server-side.
**Esforco:** Pequeno (buscar e substituir em ~5 handlers)

---

#### SEC-19: Sem audit logging para acesso a PII
**Severidade:** BAIXA
**Arquivos:** `piiQueries.js`, `tenantSearch.js`, `userProfile.js`
**Descricao:** Queries via admin SDK em `collectionGroup('private')` nao geram log estruturado de auditoria. Nao ha registro de quem consultou qual CPF/CNPJ e quando.
**Impacto:** Gap de compliance LGPD — impossivel rastrear acesso nao autorizado a dados pessoais.
**Correcao recomendada:** Adicionar `logger.info('pii.access', { callerId, targetField, maskedValue, timestamp })` em cada CF que consulta PII.
**Esforco:** Pequeno

---

#### SEC-20: Lista de senhas bloqueadas muito pequena
**Severidade:** BAIXA
**Arquivo:** `src/utils/validation.js` linha 111
**Codigo:** `const common = ['123456', '654321', 'password', 'senha', 'abcdef', '111111', '000000', 'qwerty'];`
**Descricao:** Apenas 8 senhas na blocklist. Nao verifica sequencias, repeticoes ou similaridade com email/nome.
**Impacto:** Senhas fracas sao aceitas (ex: `aaa111`, `abc123`).
**Correcao recomendada:** Expandir blocklist para top 100 senhas brasileiras. Ou implementar validacao por entropia (min 3 de 4 tipos: maiuscula, minuscula, numero, simbolo).
**Esforco:** Pequeno

---

#### SEC-21: Cloudinary cloud name hardcoded como fallback
**Severidade:** BAIXA
**Arquivos:** `src/config/cloudinary.js` linha 4, `functions/src/handlers/cloudinarySign.js` linha 12
**Codigo:** `const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dzjqdjdcz';`
**Descricao:** Se a env var nao estiver configurada, usa fallback silencioso em vez de falhar explicitamente.
**Impacto:** Em caso de misconfiguracao, app funciona silenciosamente com conta errada.
**Correcao recomendada:** Remover fallback. Na CF, lancar erro se env var ausente. No client, usar apenas a constante sem fallback (ja definida em `cloudinary.js`).
**Esforco:** Pequeno

---

#### SEC-22: functions/.env NAO esta no .gitignore
**Severidade:** BAIXA
**Arquivo:** `.gitignore` (raiz)
**Descricao:** O arquivo `functions/.env` existe localmente (479 bytes, contem `ASAAS_BASE_URL`, `ASAAS_PLATFORM_FEE_PERCENT`, `ASAAS_WEBHOOK_URL`, `CLOUDINARY_CLOUD_NAME`). Atualmente NAO esta tracked no git, mas tambem NAO esta no `.gitignore` da raiz. O `functions/.gitignore` protege `*.local` e `.env.local`, mas NAO protege `.env`.
**Impacto:** Risco de commit acidental do `.env` (que contem URLs e configs nao-sensiveis mas que revelam infra).
**Correcao recomendada:** Adicionar `functions/.env` ao `.gitignore` da raiz. O `functions/.gitignore` tambem deveria ter `.env` (nao apenas `.env.local`).
**Esforco:** Pequeno (1-2 linhas)

---

#### SEC-23: cancelContract re-le cobranças fora de transacao antes do batch
**Severidade:** BAIXA
**Arquivo:** `functions/src/handlers/contracts.js` linhas 128-138
**Descricao:** O loop faz `freshDoc.get()` fora de transacao para cada cobranca, depois usa batch para atualizar. Ha uma janela pequena onde o webhook pode atualizar o status entre o get e o batch.commit.
**Impacto:** Baixo — o check `CANCELLABLE_STATUSES.includes(freshDoc.data().status)` protege parcialmente. Pior caso: cobranca RECEIVED nao e cancelada (comportamento correto). Caso raro: cobranca passa de PENDING para RECEIVED entre o get e o batch, e o batch tenta marcar como CANCELLED (falha silenciosa ou sobrescrita indevida).
**Correcao recomendada:** Aceitavel para MVP. Para robustez futura, usar transacao individual por cobranca em vez de batch.
**Esforco:** Grande (refatoracao significativa, risco baixo nao justifica agora)

---

## 4. Tabela Resumo

| ID | Sev. | Titulo | Arquivo Principal | Esforco |
|---|---|---|---|---|
| SEC-01 | CRITICA | Notificacoes: criacao por qualquer usuario | `firestore.rules:246` | Pequeno |
| SEC-02 | CRITICA | createCharge: carId opcional bypassa validacao | `charges.js:134` | Pequeno |
| SEC-03 | ALTA | Mural targetType=all legivel por todos | `firestore.rules:212` | Medio |
| SEC-04 | ALTA | FCM token em documento publico | `notificationService.js:179` | Medio |
| SEC-05 | ALTA | Race condition em assignTenant | `tenantAssignment.js:26` | Medio |
| SEC-06 | ALTA | contractId nao validado contra carId | `charges.js:150` | Pequeno |
| SEC-07 | ALTA | Sem limite de tamanho em notifications rules | `firestore.rules:246` | Pequeno |
| SEC-08 | ALTA | Mural targetTenantId sem validacao de vinculo | `firestore.rules:216` | Medio |
| SEC-09 | MEDIA | Users collection legivel por qualquer autenticado | `firestore.rules:23` | Grande |
| SEC-10 | MEDIA | Rate limit por IP spoofavel | `piiQueries.js:43` | Medio |
| SEC-11 | MEDIA | Upload sem validacao de tamanho/tipo | `cloudinary.js:18` | Pequeno |
| SEC-12 | MEDIA | Cloudinary pasta compartilhada | `cloudinarySign.js` | Pequeno |
| SEC-13 | MEDIA | Sem validacao de enum nas CFs | `contracts.js:187` | Pequeno |
| SEC-14 | MEDIA | Sem limite de tamanho de strings nas CFs | Multiplos | Pequeno |
| SEC-15 | MEDIA | Webhook aceita eventos desconhecidos | `webhooks.js:158` | Pequeno |
| SEC-16 | MEDIA | Deep link handler sem validacao de auth | `notificationService.js:28` | Medio |
| SEC-17 | MEDIA | Sem session timeout | `App.tsx` | Medio |
| SEC-18 | BAIXA | Mensagens de erro expoe detalhes internos | Multiplos | Pequeno |
| SEC-19 | BAIXA | Sem audit log de acesso a PII | Multiplos | Pequeno |
| SEC-20 | BAIXA | Blocklist de senhas pequena | `validation.js:111` | Pequeno |
| SEC-21 | BAIXA | Cloud name hardcoded como fallback | `cloudinary.js:4` | Pequeno |
| SEC-22 | BAIXA | functions/.env fora do .gitignore | `.gitignore` | Pequeno |
| SEC-23 | BAIXA | cancelContract re-le fora de transacao | `contracts.js:128` | Grande |

---

## 5. Pontos Fortes (manter)

- **PII segregada** em `users/{uid}/private/data` com rules restritivas (uid-scoped, delete bloqueado client-side)
- **Campos imutaveis protegidos** nas Rules: `role`, `email`, `authProvider`, `createdAt` em users; `landlordId` em cars
- **Whitelist de campos** em updates de tasks e tenantRequests (`hasOnly`)
- **Rate limiting** via `checkRateLimit()` em todas as CFs callable (10-30/min conforme operacao)
- **Transacoes Firestore** em operacoes criticas (createContract, assignTenant, webhook)
- **Webhook idempotente** via `processedEvents[]` com `arrayUnion` dentro da transacao
- **Protecao contra regressao de status** no webhook (RECEIVED/CONFIRMED nao retrocede para OVERDUE/PENDING)
- **Colecoes financeiras write-locked** no client: `asaasAccounts`, `charges`, `rentalContracts` com `allow write: if false`
- **Validacao server-side de CPF/CNPJ** com digitos verificadores (mod11) em `piiQueries.js`
- **timingSafeEqual** no webhook (previne timing attacks na comparacao de tokens)
- **Secrets via Firebase Secret Manager** (5 secrets: ASAAS_API_KEY, ASAAS_PLATFORM_WALLET_ID, ASAAS_WEBHOOK_TOKEN, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)
- **Mensagens de erro anti-enumeracao** no login por CPF ("CPF ou senha incorretos" para CPF invalido e nao encontrado)
- **Cascata de delecao** robusta em `deleteAccountCF` (LGPD) e `deleteCarCF`

---

## 6. Plano de Remediacao Priorizado

### Fase 1 — Imediata (bloqueia producao, ~1-2 dias)
| # | ID | Acao | Esforco |
|---|---|---|---|
| 1 | SEC-01 | `allow create: if false` em notifications + verificar que nenhum service cria pelo client | Pequeno |
| 2 | SEC-02 | Tornar `carId` obrigatorio em `createCharge` | Pequeno |
| 3 | SEC-22 | Adicionar `functions/.env` ao `.gitignore` | Pequeno |

### Fase 2 — Alta prioridade (antes de escalar, ~3-5 dias)
| # | ID | Acao | Esforco |
|---|---|---|---|
| 4 | SEC-04 | Mover fcmToken para `private/data` + atualizar CF de push | Medio |
| 5 | SEC-03 + SEC-08 | Mover criacao de mural para CF com validacao de vinculo + restringir leitura | Medio |
| 6 | SEC-05 | Adicionar lock document `tenantCarLocks/{uid}` dentro da transacao | Medio |
| 7 | SEC-06 | Validar contractId pertence ao carId em createCharge | Pequeno |
| 8 | SEC-07 | Adicionar size() constraints em notifications rules (defesa em profundidade) | Pequeno |

### Fase 3 — Media prioridade (~5-7 dias)
| # | ID | Acao | Esforco |
|---|---|---|---|
| 9 | SEC-13 + SEC-14 | Enum whitelists + string length validation em todas as CFs | Pequeno |
| 10 | SEC-11 + SEC-12 | File size validation + pasta por usuario no Cloudinary | Pequeno |
| 11 | SEC-10 | Firebase App Check em endpoints sem auth | Medio |
| 12 | SEC-17 | Session timeout 30min com AppState listener | Medio |
| 13 | SEC-18 | Sanitizar mensagens de erro em ~5 handlers | Pequeno |

### Fase 4 — Hardening (backlog)
| # | ID | Acao | Esforco |
|---|---|---|---|
| 14 | SEC-09 | Restringir leitura de users a self + CF | Grande |
| 15 | SEC-19 | Audit logging estruturado para PII access | Pequeno |
| 16 | SEC-16 | Validacao de ownership em telas destino de deep link | Medio |
| 17 | SEC-15 | Retornar null no default do webhook | Pequeno |
| 18 | SEC-20 | Expandir blocklist de senhas | Pequeno |
| 19 | SEC-21 | Remover fallback hardcoded do cloud name | Pequeno |
| 20 | SEC-23 | Documentar limitacao da race condition em cancelContract | Pequeno |
