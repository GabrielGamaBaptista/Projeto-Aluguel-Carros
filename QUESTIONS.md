# QUESTIONS.md — Code Review & Architecture Assessment

> Revisao completa do codebase por Claude (tech lead review).
> Responda cada pergunta com: **BUG** (corrigir), **MELHORIA** (implementar), **INTENCIONAL** (manter como esta), ou **ADIADO** (reconhece mas nao agora).
> Inclua uma breve explicacao para cada resposta. Perguntas marcadas com [CRITICO] devem ser priorizadas.

---

## 1. SEGURANCA

### Q1.1 [CRITICO] — Race condition no registro: CPF/phone/CNPJ nao sao atomicos
Em `authService.register()` (linhas 47-103), as verificacoes de unicidade de CPF, telefone e CNPJ sao feitas ANTES de `createUserWithEmailAndPassword`. Entre o check e o write, outro usuario pode registrar o mesmo CPF. O email e protegido pelo Firebase Auth, mas CPF/phone/CNPJ nao tem garantia atomica. Duas requisicoes simultaneas podem criar dois usuarios com o mesmo CPF.

**Sugestao**: Mover o registro para uma Cloud Function que use uma transacao Firestore para garantir unicidade, ou criar um documento "lock" atomico com o CPF como key antes de prosseguir.

**Resposta**: **ADIADO**, entendo a necessidade mas não vou lidar com esse alto volume no momento, mas fique registrado para o futuro.

---

### Q1.2 [CRITICO] — PII exposta a qualquer usuario autenticado
As Firestore rules de `users` permitem `allow read: if request.auth != null`. Isso significa que QUALQUER usuario autenticado (locador ou locatario) pode ler o documento de QUALQUER outro usuario, incluindo CPF, CNH (numero, fotos), comprovante de residencia, telefone e endereco completo. O proprio comentario nas rules reconhece isso.

**Sugestao**: Mover dados sensiveis (CPF, CNH, comprovante) para uma sub-colecao `users/{uid}/private` com regras restritas (somente o proprio usuario e Cloud Functions).

**Resposta**:**MELHORIA**, implemente, mas tenha cuidado para não quebrar o funcionamento atual do app. tenho tido péssimas experiencias ao tentar alterar as firestole rules pois o app sempre tem quebrado.

> **IMPLEMENTADO** (batch 3, v1.20.0): PII movido para `users/{uid}/private/data`. Fase A (escrita dupla): campos sensiveis escritos em ambos os docs, leitores migrados. CF `getTenantDetailsCF` criada para leitura cross-user do locador. Script `functions/scripts/migrate-pii.js` para usuarios existentes. Fase C (batch 4): remover PII do doc publico.
> **FIX pos-teste**: `getTenantDetailsCF` nao incluia `profilePhoto` na whitelist — corrigido e redeploy feito. `handleSaveAddress` no ProfileScreen agora deleta campos de endereco legados do doc publico via `FieldValue.delete()` ao salvar (migracao automatica para usuarios pre-Q1.2). `completeGoogleProfile` agora salva `profilePhoto` no doc publico.

---

### Q1.3 [CRITICO] — Qualquer usuario autenticado pode criar notificacoes para qualquer outro usuario
As Firestore rules de `notifications` permitem `allow create` para qualquer autenticado, com a unica restricao de que `userId != request.auth.uid`. Um usuario malicioso pode spammar notificacoes falsas para qualquer outro usuario do sistema.

**Sugestao**: Migrar TODA a criacao de notificacoes para Cloud Functions (o comentario nas rules ja menciona esse TODO). Setar `allow create: if false` no client.

**Resposta**: **MELHORIA**,Tente encontrar alguma outra forma de melhoras a segurança das notificações sem mudar radicalmente o funcionamento. essa parte foi muito trabalhosa, e nao gostaria de ter esse trabalho denovo.

---

### Q1.4 — `assignTenant` e feito client-side sem validacao server-side completa
O Firestore rule "Caso 3" permite que qualquer locatario se auto-atribua a qualquer carro disponivel (`resource.data.tenantId == null && resource.data.status == 'available'`), sem verificar se existe uma `tenantRequest` aceita. O comentario nas rules reconhece essa limitacao. Um locatario malicioso poderia se atribuir a qualquer carro disponivel sem convite do locador.

**Sugestao**: Mover `carsService.assignTenant()` para uma Cloud Function que valide a existencia da tenantRequest aceita.

**Resposta**:**BUG**, corrija. mas novamente se atente para não quebrar o funcionamento da aplicação

> ✅ **IMPLEMENTADO — v1.18.0** — `assignTenantCF` criada; self-assignment eliminado; Caso 3 das rules removido.

---

### Q1.5 — Webhook token comparado com `!==` (vulneravel a timing attack)
Em `webhooks.js` linha 27, o token e comparado com `!==`. Isso e vulneravel a timing attacks. Deveria usar `crypto.timingSafeEqual()` para comparacao de strings sensiveis.

**Resposta**:**MELHORIA** use crypto.timingSafeEqual.

> ✅ **IMPLEMENTADO — v1.17.0** — `crypto.timingSafeEqual()` aplicado em `webhooks.js`.

---

### Q1.6 — `searchUsersByEmail` permite enumeracao de emails
Em `usersService.searchUsersByEmail()`, a busca por prefixo de email (`>=` e `<=`) combinada com o `allow read` aberto na colecao `users` permite que qualquer usuario autenticado enumere todos os emails do sistema. Basta digitar letra por letra.

**Sugestao**: Limitar a busca de locatarios apenas ao proprio locador (ou mover para Cloud Function com rate limiting).

**Resposta**:**MELHORIA**  limite a busca apenas ao proprio locador.

---

### Q1.7 — onboarding.js loga CPF/CNPJ em plaintext
Linha 109 de `onboarding.js` loga `cpfCnpj` em plaintext nos logs do Cloud Functions. Isso e PII sensivel que pode aparecer em Cloud Logging / console.

**Sugestao**: Mascarar o CPF/CNPJ antes de logar (ex: `***.***.***-09`).

**Resposta**:**MELHORIA**

> ✅ **IMPLEMENTADO — v1.17.0** — CPF/CNPJ mascarado nos logs do `onboarding.js`.

---

### Q1.8 — `completeGoogleProfile` nao verifica unicidade de CPF/telefone
Diferente de `register()`, o metodo `completeGoogleProfile()` (linha 141) nao checa se o CPF ou telefone ja estao em uso antes de criar o documento. Um usuario Google pode registrar um CPF duplicado.

**Resposta**:**BUG** corrija. é indispensável a unicidade do cpf.

> ✅ **IMPLEMENTADO — v1.17.0** — `completeGoogleProfile` verifica unicidade de CPF e telefone antes de criar documento.

---

### Q1.9 — Mural posts com `targetType == 'all'` sao legiveis por qualquer usuario autenticado
A regra Firestore para `mural_posts` permite leitura se `resource.data.targetType == 'all'`. Isso significa que QUALQUER usuario autenticado (inclusive locatarios de OUTROS locadores) pode ler posts publicos de qualquer locador. A query no client filtra por `landlordId`, mas a regra nao impoe isso.

**Sugestao**: Adicionar verificacao de que o leitor e um locatario de um carro do landlordId, ou mover a colecao para sub-colecao de landlord.

**Resposta**:**adiado**, entendo mas temos coisas mais prioritarias.

---

### Q1.10 — Nenhum rate limiting nas Cloud Functions callable
As Cloud Functions callable (createCharge, editCharge, cancelCharge, etc.) nao tem rate limiting alem do default do Firebase. Um usuario malicioso pode fazer milhares de chamadas por minuto, gerando custos.

**Resposta**:**BUG** defina um rate limiting, mas lembre-se de fazer condizente com nossas regras de negócio, quando geramos uma cobrança recorrente por semana, por exemplo, 5 cobranças podem ser geradas de uma vez.

> ✅ **IMPLEMENTADO — v1.18.0** — `rateLimiter.js` via Firestore; janela fixa 60s; 9 CFs protegidas (30/20/10/5 req/min conforme risco).

---

### Q1.11 — Cloudinary cloud name hardcoded, sem folder organization
Todas as fotos/documentos vao para o mesmo cloud name (`dzjqdjdcz`) sem separacao por locador ou carro. Se precisar apagar fotos de um carro especifico, nao ha como filtrar facilmente. Alem disso, se o cloud name mudar, o fallback hardcoded no `cloudinary.js` ficara desatualizado.

**Resposta**:**adiado**

---

## 2. BUGS & CORRECOES

### Q2.1 [CRITICO] — Tasks auto-geradas por `completeOilTask` e `completeKmTask` faltam `tenantId`
Em `tasksService.completeOilTask()` (linhas 502-508), a task de KM gerada automaticamente apos troca de oleo NAO inclui `tenantId`. O mesmo ocorre em `completeKmTask()` (linhas 410-417) para a task de troca de oleo. Essas tasks nao apareceriam para o locatario no `getAllUserTasks`, pois a query filtra `where('carId', 'in', chunk)` — o que funciona. Mas o `tenantId` fica `undefined`, o que quebra a regra de seguranca Firestore para leitura por tenantId direto.

**Resposta**:**bug**

> ✅ **IMPLEMENTADO — v1.17.0** — tasks geradas automaticamente por `completeOilTask`/`completeKmTask` agora incluem `tenantId` e `landlordId`.

---

### Q2.2 — `createMaintenanceRequest` define `dueDate` como hoje (imediatamente vencida)
Em `tasksService.createMaintenanceRequest()` (linha 160), o `dueDate` e `new Date()` (agora). Isso significa que a task de manutencao e "vencida" no momento da criacao, o que pode triggar notificacoes de atraso e exibir badges de overdue incorretamente.

**Sugestao**: Nao definir dueDate para solicitacoes de manutencao, ou usar um prazo padrao (ex: 7 dias).

**Resposta**:**bug**, use um prazo padrão de 7 dias.

> ✅ **IMPLEMENTADO — v1.17.0** — `dueDate` de tarefas de manutenção definido como hoje + 7 dias (`MAINTENANCE_DEADLINE_DAYS = 7`).

---

### Q2.3 — `deleteCar` nao verifica contratos ou cobrancas ativas
`carsService.deleteCar()` deleta o carro e suas tasks, mas nao verifica se existe um contrato ativo ou cobrancas pendentes. Isso pode deixar `rentalContracts` e `charges` orfaos no Firestore, alem de causar falhas no cron de cobrancas recorrentes.

**Sugestao**: Chamar `cancelActiveContractByCar` antes de deletar, ou bloquear a delecao se houver contrato ativo.

**Resposta**:**bug** deletar o carro dele deletar tudo antes, contrato, cobrança avulsa, task, tudo.

> ✅ **IMPLEMENTADO — v1.18.0** — `deleteCarCF` com cascade completo: cancela contrato+cobranças no Asaas, deleta tasks, tenantRequests, mural posts, despesas e contratos.

---

### Q2.4 — `_hasPendingTask` usa 3 campos `where` (pode precisar de indice composto)
Em `tasksService._hasPendingTask()` (linhas 57-64), a query usa `carId`, `type`, E `status` — 3 campos de igualdade. O CLAUDE.md diz "evitar 3+ campos where". Isso pode requerer um composite index que nao foi documentado. Funciona hoje pois o Firestore pode auto-criar esse indice, mas pode falhar em ambientes novos.

**Resposta**:**intencional** vamos alterar um pouco essa ideia de evitar ao máximo indices compostos, são bem performáticos e menos complexos de fazer deploy agora que temos o plano blaze do firestore.

---

### Q2.5 — Webhook re-le o documento apos a transacao para notificacoes
Em `webhooks.js` (linha 162), apos a transacao, o webhook faz um `db.collection('charges').doc(chargeId).get()` separado para obter dados para notificacao. Os dados ja estavam disponiveis dentro da transacao. Isso e uma leitura desnecessaria e um potencial ponto de inconsistencia (os dados podem ter mudado entre a transacao e o re-read).

**Resposta**:**bug**

---

### Q2.6 — `cancelContract` usa batch sem transacao para status de cobrancas
Em `contracts.js` (linhas 126-138), o `cancelContract` re-le cada cobranca individualmente (`freshDoc`) e depois usa batch para atualizar. Entre o re-read e o `batch.commit()`, um webhook pode mudar o status. Uma transacao Firestore seria mais segura.

**Resposta**:**adiado**

---

### Q2.7 — `generateRecurringCharges` processa todos os contratos em paralelo sem throttle
O cron (charges.js linhas 376-462) processa TODOS os contratos ativos com `Promise.all`. Se houver 100+ contratos, isso gera centenas de chamadas simultaneas ao Asaas e Firestore, podendo causar rate limiting (429) e falhas em cascata.

**Sugestao**: Processar em batches de 5-10 contratos com `Promise.allSettled` e um pequeno delay entre batches.

**Resposta**:**melhoria**

> ✅ **IMPLEMENTADO — v1.18.0** — Batches de 5 contratos com `Promise.allSettled` e delay de 1.5s entre batches.

---

### Q2.8 — Nenhum idempotency key para pagamentos no Asaas
`createPayment()` em `payments.js` nao envia um idempotency key para o Asaas. Se a requisicao falhar apos o Asaas processar (mas antes da resposta), o retry do interceptor criara uma cobranca duplicada no Asaas.

**Resposta**:**bug**

> ✅ **IMPLEMENTADO — v1.17.0** — `X-Idempotency-Key` adicionado em `createPayment()` usando `contractId_dueDate` ou UUID aleatório.

---

### Q2.9 — MURAL_CATEGORIES diverge do schema documentado
O `muralService.js` exporta categorias: `geral, pagamento, contato, regras, aviso`. Mas o CLAUDE.md documenta: `geral | aviso | urgente`. A categoria `urgente` (que deveria existir e provavelmente ter destaque visual diferenciado) esta ausente. As categorias `pagamento`, `contato`, `regras` nao estao no schema.

**Resposta**:**bug** adicione a categoria urgente no sistema, e adicione as outras categorias a documentação (lembre-se de não utilizar emojis se for utilizar algum icone para urgência)

> ✅ **IMPLEMENTADO — v1.17.0** — Categoria `urgente` adicionada; badge colorido por categoria no `MuralManagerScreen`.

---

### Q2.10 — `generateAutomaticTasks` usa `now` como fallback para timestamps ausentes
Se `lastKmUpdate` ou `lastPhotoInspection` for null/undefined (possivel em carros criados antes desses campos existirem), o fallback e `now`. Isso faz `differenceInDays(now, now) = 0`, que nunca atende ao threshold (10 ou 15 dias). Tasks automaticas nunca seriam geradas para esses carros antigos.

**Resposta**:**intencional** apaguei todos esses carros de testes mais antigos do app.

---

### Q2.11 — Erros silenciados como "nao encontrado"
Varios metodos retornam `{ exists: false }` ou `{ hasCar: false }` no catch de erros (ex: `checkCpfExists`, `checkTenantHasCar`). Erros de rede, permissao negada, ou indice ausente sao tratados como "nao encontrado", mascarando problemas reais.

**Resposta**:**adiado** contanto que tenhamos outras formas de fazer o debug/ver as logs de erro, não vejo problema

---

### Q2.12 — `deleteTasksByCar` nao respeita o limite de 500 operacoes do batch
Firestore batches tem limite de 500 operacoes. Se um carro tiver mais de 500 tasks pendentes (improvavel mas possivel), o batch falhara. Deveria iterar em chunks de 500.

**Resposta**: **adiado**

---

## 3. PERFORMANCE

### Q3.1 [CRITICO] — `getChargesByCar` le TODAS as cobrancas do locador e filtra client-side
`paymentService.getChargesByCar()` (linhas 78-98) le TODOS os documentos de `charges` do locador e filtra por `carId` em JavaScript. Para um locador com 20 carros e 12 meses de cobrancas mensais, sao 240+ documentos lidos quando so precisa de ~12. Isso cresce linearmente e e caro (custo por leitura no Firestore).

**Sugestao**: Criar uma query com `where('carId', '==', carId).where('landlordId', '==', uid)` (2 equality fields, sem indice composto).

**Resposta**:**melhoria** faça, mas faça utilizando indices compostos, se julgar mais performático. não se atenha a regra de evita-los

> ✅ **IMPLEMENTADO — v1.17.0** — índice composto `landlordId + carId + dueDate` criado; `getChargesByCar` usa `orderBy` no Firestore.

---

### Q3.2 [CRITICO] — Nenhuma paginacao em nenhuma tela de listagem
Nenhuma lista (tasks, charges, contracts, mural, notifications) implementa paginacao. Todas carregam TODOS os documentos de uma vez. Isso vai degradar conforme o app escala:
- Um locador com 50 carros, 1 ano de cobrancas = 600+ charges carregadas na tab Financeiro
- Um locatario com 1 ano de tasks = 50+ tasks (ok) mas 200+ notificacoes

**Sugestao**: Implementar paginacao com `limit()` + `startAfter()` em todas as queries de listagem.

**Resposta**:**melhoria**

> **IMPLEMENTADO** (batch 3, v1.20.0): Paginacao (limit 20 + startAfter) nas listas de maior crescimento: `getAllUserTasks` (completed, locador), `getTenantChargesPaginated`. TasksScreen e TenantPaymentsScreen com `onEndReached`. Indice `charges.tenantId + dueDate DESC` criado. Listas de baixo risco (carros, mural, contratos) nao paginadas.
> **FIX pos-teste**: Ordenacao de pagamentos do locatario ajustada: pendentes/vencidas primeiro (dueDate ASC), depois pagas recorrentes (contractId != null, dueDate DESC), depois pagas avulsas (dueDate DESC).

---

### Q3.3 — `getAllUserTasks` faz N+1 queries (1 para cars + N/10 para tasks)
O metodo busca todos os carros do usuario e depois busca tasks em chunks de 10 carIds (limitacao do `in` operator). Para um locador com 30 carros, sao 4 queries. Isso e inerente ao Firestore, mas poderia ser otimizado com denormalizacao (ex: campo `landlordId` nas tasks).

**Sugestao**: Adicionar `landlordId` aos documentos de tasks para queries diretas sem N+1.

**Resposta**:**melhoria** ok, se não houver perda de performance pode implementar.

---

### Q3.4 — `generateAutomaticTasks` e chamada toda vez que CarDetailsScreen abre
Cada abertura de detalhes de um carro triggera `generateAutomaticTasks`, que faz 3 `_hasPendingTask` queries (uma por tipo). Para um locador que navega frequentemente entre carros, sao muitas leituras desnecessarias.

**Sugestao**: Fazer rate-limit local (ex: nao executar se ja rodou nos ultimos 5 minutos para aquele carro), ou mover a geracao automatica para um cron server-side.

**Resposta**:**melhoria** nao executar se ja rodou nos ultimos 5 minutos

> ✅ **IMPLEMENTADO — v1.17.0** — cooldown de 5 min por carro em `generateAutomaticTasks` (`_autoTaskLastRun` + `AUTO_TASK_COOLDOWN_MS`).

---

### Q3.5 — FinancialDataContext recarrega TUDO a cada refresh
`FinancialDataContext.refresh()` busca charges, contracts, expenses e customCategories em paralelo, mesmo se o usuario so esta olhando uma tab. Nao ha invalidacao seletiva.

**Sugestao**: Lazy-load por tab, ou usar cache com TTL.

**Resposta**:**intencional** na aba financeiro quero todos os dados o mais atualizado possível.

---

### Q3.6 — Nenhum cache local para dados frequentemente lidos
Os dados de usuario (profile), carros e tasks sao buscados do Firestore a cada navegacao. Nao ha cache local (nem Firestore persistence, que e habilitado por default no React Native Firebase, mas sem controle manual de TTL).

**Resposta**:**melhoria** use cache, ou firestore persistance se for mais performático para dados do usuário, carros e para tasks se for possível deixar no cache apenas as que já estão aprovadas(dentro de concluidas) se isso representar ganho de performance, senão mantenha a consulta das tasks

---

### Q3.7 — Fotos nao sao comprimidas antes do upload
O `PhotoPicker` nao parece comprimir imagens antes de enviar para o Cloudinary. Fotos de cameras modernas podem ter 5-10 MB cada. Uma inspecao fotografica com 9 angulos pode consumir 45-90 MB de upload, alem de custo de armazenamento no Cloudinary.

**Sugestao**: Usar a opcao `maxWidth`/`maxHeight`/`quality` do `react-native-image-picker` para redimensionar antes do upload.

**Resposta**:**melhoria**

> ✅ **IMPLEMENTADO — v1.18.0** — `maxWidth: 1920, maxHeight: 1920` adicionados em ambas as opções do `PhotoPicker` (câmera + galeria).

---

## 4. ARQUITETURA & DESIGN

### Q4.1 — Services em .js, telas em .tsx — sem tipos compartilhados
Todos os services sao JavaScript puro sem tipos. As telas sao TypeScript mas usam `any` para dados vindos dos services. Nao existem interfaces/types para os documentos do Firestore (User, Car, Task, Charge, Contract).

**Sugestao**: Criar um arquivo `src/types/firestore.ts` com interfaces para todos os documentos, e migrar os services para .ts gradualmente.

**Resposta**:**melhoria**, lembre-se de documentar tudo isso após feito.

---

### Q4.2 — `functions/index.js` como "god file" (508 linhas com implementacao inline)
O `index.js` das Cloud Functions contem implementacoes completas de `cancelCharge` (100 linhas), `editCharge` (160 linhas), `checkOnboarding`, `getPixQrCode`, `editContract` e `sendPushNotification`, alem dos imports e exports. Isso viola separacao de responsabilidades — as funcoes de charges, contracts, etc. deveriam estar nos respectivos handler files.

**Sugestao**: Mover `cancelCharge` e `editCharge` para `handlers/charges.js`, `editContract` para `handlers/contracts.js`, `sendPushNotification` para um novo `handlers/notifications.js`, etc.

**Resposta**:**melhoria**, lembre-se de documentar tudo isso após feito.

> ✅ **IMPLEMENTADO — v1.18.0** — `index.js` refatorado de 514 linhas para ~45; 6 funções inline movidas para handlers correspondentes.

---

### Q4.3 — Codigo duplicado entre RegisterScreen e GoogleCompleteProfileScreen
Os dois formularios de registro tem logica quase identica para: steps, validacao de CEP com ViaCEP, validacao de CPF/CNPJ, upload de CNH, estados do formulario. Qualquer correcao precisa ser aplicada nos dois arquivos.

**Sugestao**: Extrair os steps comuns para componentes reutilizaveis (ex: `AddressStep`, `PersonalDataStep`, `CnhStep`).

**Resposta**:**intencional**, é mexer onde não tem problema. uma tela a mais nao vai pesar o app a ponto de precisar trocar.

---

### Q4.4 — Sem gerenciamento de estado global
Cada tela gerencia seu proprio estado com `useState` e passa dados via navigation params. Nao ha Redux, Zustand, ou Context API (exceto `FinancialDataContext`). Isso leva a:
- Re-fetches desnecessarios ao navegar entre telas
- Dados desatualizados (ex: atualizar um carro e voltar para Home que ainda mostra dados antigos)
- Prop drilling complexo via navigation params

**Resposta**:**bug** gostaria de ter um useState global, se possível, e se atualizasse dentro de uma SubTela por exemplo, toda a aplicação atualizasse. justamente visando evitar casos como esse de atualizar algo e voltar a uma tela onde ainda está desatualizado. se não um useState global, pelo menos um por coleção

---

### Q4.5 — Sem Error Boundaries no React
Se qualquer tela crashar (ex: dado inesperado do Firestore), o app inteiro fecha. Nao ha `ErrorBoundary` component para capturar erros e mostrar uma tela de fallback.

**Resposta**:**intencional** contanto que consigamos debugar isso por logs ou outras formas não vejo problema.

---

### Q4.6 — Retornos inconsistentes nos services
A maioria dos services retorna `{ success: boolean, data?, error? }`. Mas:
- `paymentService.getChargesByCar()` retorna um array vazio em caso de erro (sem `success`)
- `paymentService.getTenantCharges()` retorna array (sem wrapper)
- `paymentService.getAllContractsForLandlord()` retorna array
- `paymentService.getDashboardSummary()` e sincrono e recebe charges como parametro
- `carsService.checkTenantHasCar()` retorna `{ hasCar: boolean }`

Isso torna dificil tratar erros de forma consistente no client.

**Sugestao**: Padronizar todos os retornos para `{ success, data, error }` ou adotar pattern de throw + try/catch nos screens.

**Resposta**:padronize os retornos, mas pode utilizar patterns de try/catch onde julgar necessário, em um cenário de pagamento por exemplo.

---

### Q4.7 — Navigation params carregam objetos completos em vez de IDs
Varias telas recebem objetos completos via navigation params (car data, task data, charge data). Isso e um anti-pattern do React Navigation que pode causar: dados stale, serializacao problematica com Timestamps do Firestore, e deep linking dificil.

**Sugestao**: Passar apenas IDs e carregar dados na tela de destino com useEffect.

**Resposta**:**melhoria** acho que se conseguirmos ganhar performance vale testar, mas gostaria de evitar useEffect's

---

### Q4.8 — Nao ha nenhum teste automatizado
O projeto tem `jest.config.js` mas zero arquivos de teste. Nao ha unit tests para services, integration tests para Cloud Functions, nem E2E tests. Isso torna refatoracoes e novas features muito arriscadas.

**Resposta**:**adiado**, guarde este mas guarde como prioridade, assim que terminarmos essas correções todas será um dos primeiros pontos a serem trabalhados

---

### Q4.9 — Sem offline support / tratamento de conectividade
O app nao tem tratamento de perda de conexao. Se o usuario perder internet durante uma operacao (completar task, criar cobranca), a operacao falha silenciosamente ou com erro generico. Nao ha fila de operacoes offline.

**Resposta**:**adiado** se a operação apenas falhar, e ficar explicito que falhou, não vejo um problema.

---

### Q4.10 — Sem crash reporting / analytics
Nao ha integracao com Firebase Crashlytics, Sentry, ou qualquer servico de crash reporting. Erros em producao sao invisiveis. Tambem nao ha analytics de uso (ex: Firebase Analytics) para entender comportamento dos usuarios.

**Resposta**:**melhoria** podemos implementar algum tipo de crash reporting ou de analytics, mas isso tem que ser muito bem calculado pois não quero ter gastos com o firebase.

---

## 5. LOGICA DE NEGOCIO

### Q5.1 — Locatario so pode ter 1 carro: e se precisar de 2?
A regra de "1 carro por locatario" e verificada em `carsService.checkTenantHasCar()`. Essa e uma restricao de negocio fixa. Existem cenarios reais onde um locatario precisaria de mais de um carro? Se sim, essa restricao deveria ser configuravel por locador.

**Resposta**:**adiado** entendo que isso é um ponto mas no momento o principal publico alvo que tenho como locatários são pessoas que alugam para rodar como uber/99, então nesse nicho específico um carro basta. mas entendo que faça sentido a expansão quando começar a atingir outro público alvo.

---

### Q5.2 — Tasks pendentes nao sao deletadas ao deletar o carro
`carsService.deleteCar()` deleta tasks via `deleteTasksByCar()`, que so deleta tasks PENDING. Tasks completed permanecem no Firestore como dados orfaos — referenciando um carId que nao existe mais. Alem disso, fotos/documentos no Cloudinary ficam orfaos.

**Resposta**:**BUG** já disse isso em outra questão mais acima. ao deletar um carro tudo sobre ele deve ser apagado, contrato, cobranças, tasks, registros, tudo.

> ✅ **IMPLEMENTADO — v1.18.0** — coberto pela `deleteCarCF` (Q2.3): deleta tasks, contratos, cobranças, mural posts e despesas.

---

### Q5.3 — Nao ha fluxo para editar dados sensiveis (CPF, CNH, endereco)
O ProfileScreen mostra dados do usuario mas nao permite editar CPF, CNH ou endereco. Se um locatario errar o CPF no cadastro ou a CNH vencer, nao ha como corrigir no app.

**Resposta**:**melhoria** adicione edição para os dados que ainda não possuem no profile.

> **IMPLEMENTADO** (batch 3, v1.20.0): ProfileScreen expandido com 5 secoes editaveis independentes — Dados da Conta (ja existia), Dados Pessoais (CPF/data/personType/CNPJ), Endereco (CEP autocomplete ViaCEP), CNH (locatario), Comprovante de residencia (locatario). CPF bloqueado para locador com subconta Asaas ativa. Batch write atomico: campos publicos (CPF/CNPJ) em users/{uid}; PII (endereco, CNH, fotos) apenas em private/data.
> **FIX pos-teste**: Upload de fotos no cadastro (RegisterScreen) estava quebrado pois Firebase Auth so e criado no ultimo step — corrigido com upload diferido: `PhotoPicker deferred` armazena URI local; apos `authService.register()` criar a conta, uploads sao feitos autenticados e URLs salvas via batch. Corrigido para foto de perfil (doc publico) e CNH/comprovante (private/data). Camera no Android exigia permissao em runtime — adicionado `PermissionsAndroid.request(CAMERA)` antes de `launchCamera`.

---

### Q5.4 — Nao ha fluxo de delecao de conta (LGPD)
Usuarios nao podem deletar suas contas. A LGPD (Lei Geral de Protecao de Dados) exige que o titular dos dados possa solicitar a exclusao. Isso pode ser um problema legal.

**Sugestao**: Implementar um fluxo de delecao que: cancele contratos ativos, desatribua carros, anonimize dados ou delete documentos.

**Resposta**:**melhoria** adicione esta função. quero que o usuário possa deletar sua conta e todas as informações, fotos, tasks, carros, tudo relacionado a ele seja deletado junto.

> **IMPLEMENTADO** (batch 3, v1.20.0): CF `deleteAccountCF` com cascade completo por role. LOCADOR: cancela contratos/cobranças no Asaas, notifica locatarios, deleta carros/tasks/mural/charges/contratos/notifications, deleta asaasAccounts/{uid}. LOCATARIO: cancela contratos/cobranças, libera carros, notifica locadores, anonimiza charges (tenantId='deleted_user') e rentalContracts (tenantName='Usuario Excluido'). ProfileScreen: botao "Excluir Conta" na secao Seguranca com confirmacao dupla (Alert + modal) e re-autenticacao (email: senha / Google: re-sign-in) antes da exclusao.

---

### Q5.5 — Notificacoes nunca sao limpas/expiradas
A colecao `notifications` cresce indefinidamente. Nao ha mecanismo para limpar notificacoes antigas, o que aumenta custos de armazenamento e pode degradar queries.

**Sugestao**: Adicionar um cron que deleta notificacoes com mais de X dias, ou implementar TTL via Firestore TTL policies.

**Resposta**:**bug** me corrija se eu estiver errado, mas eu não preciso guardar registro de notificações que já foram enviadas, e recebidas pelo destinatário designado, por mim faria sentido as notificações durarem o tempo que necessitarem para serem enviadas, e assim que recebidas já podem ser apagadas.

> ✅ **IMPLEMENTADO — v1.17.0** — `sendPushNotification` deleta o documento de `notifications/` após o envio push bem-sucedido (ou falha).

---

### Q5.6 — Nao ha notificacao deep-link (tap na notificacao nao navega)
Quando o usuario toca em uma notificacao push, o app abre mas NAO navega para a tela relevante (ex: detalhes da cobranca, detalhes da tarefa). O `onNotificationOpenedApp` handler apenas faz console.log.

**Sugestao**: Usar os `data` da notificacao (type, carId, taskId, chargeId) para navegar para a tela correta.

**Resposta**:**SUPER_MELHORIA**, isto é algo que já estava pensando, e sinto muita falta no aplicativo. faz total diferença o usuário clicar numa notificação de cobrança prestes a expirar e ser levado direto para a tela com o qrcode, por exemplo.

> ✅ **IMPLEMENTADO — v1.16.0** — deep-link implementado; tap na notificação navega para a tela relevante (cobrança, tarefa, etc.).

---

### Q5.7 — Locatario nao pode ver detalhes do contrato
O locatario pode ver cobrancas na aba Pagamentos, mas nao tem acesso ao `ContractDetailsScreen`. Nao pode ver o valor do aluguel, frequencia, ou historico do contrato. Deve ter visibilidade?

**Resposta**:**melhoria** só tome muito cuidado nessa implementação pois o locatário em nenhuma hipótese pode ser capaz de alterar um contrato.

---

### Q5.8 — Sem recibo/comprovante para cobrancas pagas
Apos o pagamento de uma cobranca, nao ha opcao de gerar ou baixar um recibo/comprovante. O Asaas pode fornecer isso via `invoiceUrl`, mas nao esta sendo apresentado de forma clara apos o pagamento.

**Resposta**:**melhoria**, gostaria sim que após paga a cobrança o locatário pudesse acessar a cobrança e caso já paga, pudesse verificar/baixar o comprobante de pagamento. gostaria inclusive que esse comprovante ficasse disponível também para o locador, nas cobranças já pagas.

> **IMPLEMENTADO** (batch 3, v1.20.0): `PaymentDetailsScreen` exibe secao "Comprovante de Pagamento" para charges RECEIVED/CONFIRMED. Se `transactionReceiptUrl` existe, botao "Ver Comprovante" abre URL via `Linking.openURL`. Disponivel para locatario e locador (ambos acessam PaymentDetailsScreen). Webhook ja preenchia `transactionReceiptUrl` desde batch anterior.

---

### Q5.9 — `nextChargeOverride` nao se aplica a contratos semanais/quinzenais
O `nextChargeOverride` (override pontual de valor) so e consumido no path MONTHLY do cron (charges.js linha 419). Contratos semanais e quinzenais usam sempre `rentAmount`. Isso e intencional?

**Resposta**:**bug**, não entendi muito bem o questionamento, mas vou detalhar a regra de qualquer forma. o contrato de recorrencia pode gerar cobranças mensais, quinzenais ou semanais. e a função para alterar a próxima cobrança(que na prática apaga a anterior e gera uma nova) sempre irá substituir a próxima cobrança com status pendente(ordenando por dueDate em ordem crescente) seja essa cobrança semanal, quinzenal ou mensal.

> ✅ **IMPLEMENTADO — v1.18.0** — `nextChargeOverride` agora consumido pelo cron em WEEKLY (primeira do lote) e BIWEEKLY. O `editCharge` (substituição direta de pendente) já funcionava para todas as frequências e permanece intacto.

---

### Q5.10 — Sem validacao de formato/dados do carro no AddCarScreen
Os campos brand, model, year, plate, color, initialKm aparentemente nao tem validacao rigorosa. O usuario pode inserir year=0, plate="abc", km=-500, etc. Nao ha validacao de placa no formato Mercosul brasileiro.

**Resposta**:**melhoria_complexa** vamos fazer diferente então. quero que procure uma grande lista com Marcas, e seus respectivos Carros. quero que no lugar da inserção Manual e escrita. apareça uma lista para o locador escolher na hora de cadastrar o carro. com diversas marcas, e ao escolher a FIAT por exemplo, o campo de carros deve aparecer somente carros da FIAT. o esquema ficará Marca*, Carro*(só pode ser preenchido após marca ser preenchido), Modelo(opcional), Ano*(deve ser positivo), cor*, Placa*(com validação da placa no formato Mercosul Brasileiro),Quilometragem atual* e documentação(opcional)

---

### Q5.11 — `incomeValue: 5000` hardcoded no onboarding Asaas
O valor de renda mensal enviado ao Asaas e sempre R$ 5.000 (onboarding.js linha 105). Isso pode causar problemas se o Asaas usar esse valor para limites de transacao. Deveria ser um campo preenchido pelo locador?

**Resposta**:**melhoria**, deixe 10000 como padrão. o locatário pode alterar depois se precisar.

> ✅ **IMPLEMENTADO — v1.17.0** — `incomeValue` alterado para 10000 em `onboarding.js`.

---

### Q5.12 — Sem fluxo de "pausar" contrato
O schema do Firestore tem `pausedAt` no contrato, mas nao ha funcionalidade de pausar/despausar no app. So ha "cancelar" (irreversivel). Pausar seria util para ferias do locatario ou manutencao prolongada.

**Resposta**:**melhoria**, ok, implemente a funcionalidade de pausar o contrato. e não se esqueça de adicionar este botão na tela do locador (tela de detalhamento do contrato)

---

## 6. INFRAESTRUTURA & DEVOPS

### Q6.1 — IAM policy manual apos cada deploy
O MEMORY.md documenta que `roles/run.invoker` precisa ser aplicado manualmente apos cada deploy de Cloud Functions. Isso e propenso a esquecimento e pode causar downtime (funcoes retornam UNAUTHENTICATED se o IAM nao for aplicado).

**Sugestao**: Automatizar via script post-deploy no `codemagic.yaml` ou `firebase.json` postdeploy hook.

**Resposta**:**melhoria** automatize com firebase.json se possível, não com codemagic.

> ✅ **IMPLEMENTADO — v1.18.0** — `functions/scripts/apply-iam.js` + hook `"postdeploy"` no `firebase.json`; IAM aplicado automaticamente após cada deploy.

---

### Q6.2 — Credenciais Asaas em variaveis de ambiente (nao Secret Manager)
O `functions/.env` contem API keys do Asaas. Variaveis de ambiente ficam visiveis no Cloud Console e nos logs de deploy. O Google Secret Manager oferece encriptacao at-rest e auditoria de acesso.

**Resposta**:**melhoria?**, nunca utilizei secret manager, mas se for melhorar a segurança do app e não me gerar custos. Não vejo problema em implementar.

---

### Q6.3 — Sem monitoramento estruturado / alertas
Os Cloud Functions usam `console.error` para logar erros, mas nao ha alertas configurados no Cloud Monitoring para falhas recorrentes (cron de cobrancas, webhook, onboarding). Se o cron falhar silenciosamente, ninguem sera notificado.

**Resposta**:**melhoria** quero ser monitorado de alguma forma. Principalmente se o webhook do asaas não retornar como deveria, pois depois de determinadas tentativas o webhook é desativado.

---

### Q6.4 — Webhook URL registrado uma vez durante onboarding
A URL do webhook e registrada na subconta Asaas durante o onboarding (onboarding.js linhas 128-151). Se a URL mudar (redeployment, migracao de regiao), todas as subcontas existentes precisariam ser atualizadas manualmente. Nao ha mecanismo de migracao.

**Resposta**:**intencional** se existir algum mecanismo de migração fácil, ótimo mas não planejo ficar mudando a url ou a região, a princípio.

---

### Q6.5 — Sem ambiente de staging/QA
O app parece ter apenas sandbox (dev) e producao. Nao ha ambiente de staging para testar mudancas antes do deploy em producao. Cloud Functions e Firestore rules sao deployados direto para producao.

**Resposta**:**adiado** vou verificar esse ponto da necessidade de um staging assim que lançar o app em produção. enquanto em fase de desenvolvimento continuarei utilizando sandbox.

---

### Q6.6 — `functions/check-charge.js`, `check-split.js`, `simulate-payment.js`, `test-sandbox.js` no repositorio
Existem 4 scripts de debugging/teste na raiz de `functions/`. Estes devem ser commitados? Contem credenciais ou dados sensiveis?

**Resposta**:**intencional** não vejo necessidade de comittar, nem de retirar, se forem arquivos de teste que podem ser utilizados futuramente

---

## 7. UX & FRONTEND

### Q7.1 — Foreground notifications usam `Alert.alert` nativo
O `notificationService` handler de foreground (linha 63) usa `Alert.alert` do React Native. Isso e intrusivo — interrompe o que o usuario esta fazendo com um dialog modal. Um toast/banner na parte superior da tela seria menos intrusivo.

**Sugestao**: Usar `react-native-flash-message` ou componente de toast customizado.

**Resposta**:**SUPER_MELHORIA**, é horrível receber um pop-up enorme na tela no meio do uso devido a notificação. durante o uso do app a react-native-flash-message, ou uma própria notificação(no mesmo modelo que aparece quando o usuário está fora do app) seria melhor.

> ✅ **IMPLEMENTADO — v1.16.0** — banner foreground via `react-native-flash-message`; substituiu o `Alert.alert` intrusivo.

---

### Q7.2 — Loading states sem skeleton screens
Todas as telas usam `ActivityIndicator` simples durante carregamento. Skeleton screens (placeholder content) proporcionam uma experiencia mais fluida e reduzem a percepcao de lentidao.

**Resposta**:**intencional**, não vejo necessidade.

---

### Q7.3 — Sem pull-to-refresh em todas as telas de listagem
Algumas telas tem pull-to-refresh (HomeScreen, TenantPaymentsScreen), mas outras (TasksScreen, MuralManagerScreen, tabs do FinancialDashboard) podem nao ter. Consistencia de UX e importante.

**Resposta**:**melhoria** todas as telas com listagem de dados, que utilizam webhook, que puxam informações em "tempo real" devem ter pull to refresh.

> **IMPLEMENTADO** (batch 3, v1.20.0): Todas as telas com listagem possuem pull-to-refresh: HomeScreen, TenantPaymentsScreen, TasksScreen (com reset de paginacao), MuralManagerScreen, CobrancasTab, ContratosTab, ResumoTab.

---

### Q7.4 — Sem confirmacao antes de acoes destrutivas
Acoes como "Remover Locatario", "Cancelar Contrato", "Deletar Carro" deveriam ter confirmacao com dialog. Existem confirms em todas essas acoes?

**Resposta**:**bug**"Deletar Carro" tem um alert; "Cancelar Contrato", além de não ter nada, eu não tenho um botão na aba de detalhamento do contrato para Cancelar, e deveria ter. "Remover Locatario" também ter um alert na tela com alguns avisos.

> ✅ **IMPLEMENTADO — v1.17.0** — botão "Cancelar Contrato" adicionado em `ContractDetailsScreen` com Alert de confirmação; confirmações presentes em todas as ações destrutivas.

---

### Q7.5 — Sem feedback visual de sucesso apos operacoes
Apos completar uma task, criar uma cobranca, ou aprovar uma task, ha feedback visual claro (toast, banner, navegacao automatica)? Ou o usuario fica sem saber se a operacao foi bem-sucedida?

**Resposta**:**melhoria**, não tem um feedback visual claro, e eu gostaria que tivesse.

---

### Q7.6 — Sem suporte a tema escuro (dark mode)
Todas as cores sao hardcoded (branco, cinza claro, indigo). Nao ha suporte a dark mode do sistema operacional. Isso pode ser relevante para conforto de uso noturno.

**Resposta**:**adiado** também acho super necessário mas temos outras prioridades no momento.

---

### Q7.7 — Sem acessibilidade (a11y)
Nao vi `accessibilityLabel`, `accessibilityHint`, ou `accessibilityRole` em nenhum componente. Isso torna o app inacessivel para usuarios com deficiencia visual que usam TalkBack (Android) ou VoiceOver (iOS).

**Resposta**:**adiado** como crítico. assim que terminarmos a melhoria, iremos "refatorar" o código inteiro adicionando opções de acessibilidade.

---

## 8. DATA INTEGRITY & CONSISTENCY

### Q8.1 — Dados denormalizados podem ficar inconsistentes
Varias entidades armazenam dados copiados de outras:
- `charges.carInfo` (copia de car brand/model/plate)
- `rentalContracts.carInfo`, `tenantName`, `landlordName`
- `tenantRequests.carInfo`, `landlordName`
- `tasks.tenantId` (copia de car.tenantId)

Se o nome do locatario mudar, ou a placa do carro for editada, esses dados denormalizados ficam desatualizados. Isso e aceitavel?

**Resposta**:**bug** isso não é aceitável.

---

### Q8.2 — `tasks.tenantId` pode divergir de `car.tenantId`
Quando um locatario e removido do carro, as tasks pending sao deletadas, mas tasks completed mantem o `tenantId` original. Se um novo locatario for atribuido, tasks do locatario anterior permanecem no Firestore. Isso e correto? O novo locatario pode ver tasks do anterior?

**Resposta**:as tasks completed devem se manter no firestore. mas o novo locatário não deve ver tasks do locatário anteior.

---

### Q8.3 — Formato de datas inconsistente no Firestore
Algumas datas sao `Timestamp` do Firestore (createdAt, dueDate em tasks), outras sao strings "YYYY-MM-DD" (dueDate em charges, startDate em contracts), e outras sao strings "DD/MM/AAAA" (birthDate). Isso complica comparacoes e conversoes.

**Sugestao**: Padronizar: Timestamps para datas com hora, strings "YYYY-MM-DD" para datas sem hora.

**Resposta**:**SUPER_MELHORIA** quero TODAS as datas do aplicativo no formato "DD/MM/AAAA". e de preferencia se for pro usúario inserir, com máscara. me incomoda muito inconsistência entre os formatos.

> ✅ **IMPLEMENTADO — v1.16.0** — datas exibidas em "DD/MM/AAAA" em toda a UI do app.

---

### Q8.4 — `charges.status` usa UPPERCASE, `tasks.status` e `tenantRequests.status` usam lowercase
Charges: `'PENDING' | 'RECEIVED' | 'CONFIRMED' | 'OVERDUE' | 'CANCELLED'`
Tasks: `'pending' | 'completed'`
Tenant Requests: `'pending' | 'accepted' | 'rejected' | 'cancelled'`

Isso e intencional (charges refletem o Asaas) ou deveria ser padronizado?

**Resposta**: **melhoria** padronize tudo como uppercase.

---

### Q8.5 — Nao ha validacao server-side para campos de task na conclusao
Quando o locatario completa uma task (ex: KM update), os dados enviados (newKm, photos) sao validados apenas client-side. As Firestore rules nao validam o formato dos dados — apenas que os campos "estruturais" nao foram alterados. Um client malicioso poderia enviar KM negativo ou URLs de fotos falsas.

**Resposta**:**intencional**,Mas ja há uma validação que não deixa o usuário inserir uma kilometragem menor do que a anterior. como ele poderia enviar KM negativo?

---

## 9. MELHORIAS TECNICAS

### Q9.1 — Migrar services de .js para .ts
Dado que as telas ja sao TypeScript, migrar os services para TS com tipos de retorno e parametros tipados reduziria bugs de runtime e melhoraria a DX (autocompletion, refactoring seguro).

**Resposta**:**melhoria**

---

### Q9.2 — Criar types centralizados para documentos Firestore
Um arquivo `src/types/` com interfaces como `IUser`, `ICar`, `ITask`, `ICharge`, `IRentalContract` seria util para type-safety em todo o codebase.

**Resposta**:**melhoria**

---

### Q9.3 — Usar Firestore Persistence para offline reads
O React Native Firebase ja habilita persistence por default, mas nao ha estrategia explicita de "read from cache first" vs "always fetch from server". Configurar explicitamente poderia melhorar a experiencia offline.

**Resposta**:**melhoria** o usuário deve ser capaz de verificar informações offline, mas nunca criar tasks, cadastros, cobranças ou qualquer coisa.

---

### Q9.4 — Implementar retry com exponential backoff nos services client-side
Os services do client nao tem retry. Uma unica falha de rede retorna erro imediatamente. O Asaas client (functions/src/asaas/client.js) tem retry — o client-side deveria ter algo similar para operacoes Firestore.

**Resposta**:**melhoria** implemente retry, mas 1 vez só no máximo, não quero gastar infinitas requisições ao firebase.

---

### Q9.5 — Adicionar campo `landlordId` diretamente nos documentos de tasks
Atualmente, para buscar tasks de um locador, e necessario primeiro buscar seus carros e depois buscar tasks por carId (N+1 query). Adicionar `landlordId` diretamente na task permitiria uma query direta.

**Resposta**:**melhoria** adicione. o ganho de performance será notável.

> ✅ **IMPLEMENTADO — v1.17.0** — `landlordId` adicionado a todos os documentos de tasks; `getAllUserTasks` usa query direta por `landlordId`.

---

### Q9.6 — Considerar sub-colecoes para escalabilidade
Em vez de colecoes de topo (`charges`, `tasks`, `notifications`), considerar sub-colecoes como `users/{uid}/notifications`, `cars/{carId}/tasks`. Isso melhora as queries (scoped automaticamente) e simplifica security rules.

**Sugestao**: Pode ser muito trabalho agora — avaliar se vale para o proximo major refactoring.

**Resposta**:**adiar** faz sentido, mas temos outras prioridades.

---

### Q9.7 — Adicionar TTL/cleanup para documentos temporarios
Documentos como `tenantRequests` (status: rejected/cancelled), `notifications` antigas, e tasks completed muito antigas nunca sao limpos. Considerar um cron de limpeza ou Firestore TTL policies.

**Resposta**:**melhoria**

---

### Q9.8 — Externalizar constantes magicas
Valores como `10000` (km para troca de oleo), `10` (dias para KM update), `15` (dias para foto), `7` (prazo de oil change), `5` (dias de antecedencia do cron mensal) estao hardcoded no service. Poderiam ser configurados por locador ou globalmente em um documento de config no Firestore.

**Resposta**:**melhoria** não quero que o locador configure, mas quero que ele seja informado de alguma forma, ao criar uma conta por exemplo, dessas informações. além disso quero mudar a (dias para KM update) para 7 dias, e (dias para foto) para 10 dias.

> ✅ **IMPLEMENTADO — v1.17.0** — constantes extraídas em `tasksService.js` (`KM_UPDATE_INTERVAL_DAYS=7`, `PHOTO_INSPECTION_INTERVAL_DAYS=10`); intervalos ajustados conforme solicitado.

---

### Q9.9 — Considerar usar Firestore onSnapshot para dados real-time em vez de polling
Algumas telas re-buscam dados no `useFocusEffect` (polling ao focar). Usar `onSnapshot` listeners proporcionaria atualizacoes em tempo real sem necessidade de refetch manual.

**Resposta**:**melhoria** use o que for mais performático.

---

### Q9.10 — Implementar feature flags
Para lancar novas features gradualmente (sistema de despesas, iOS, etc.), feature flags permitiriam ativar/desativar funcionalidades sem redeployment.

**Resposta**:**adiar** é uma boa ideia para quando estivermos em produção.

---

## 10. QUESTOES ESPECIFICAS DO CODIGO

### Q10.1 — `createManualTask`: spread de `extraData` antes do switch pode sobrescrever campos
Em `tasksService.createManualTask()` (linhas 89-99), o spread `...extraData` e feito antes do switch que define `title` e `description`. Se `extraData` contiver `title`, ele sera sobrescrito pelo switch. Mas se `extraData` contiver campos inesperados (ex: `status`, `approved`), eles serao incluidos no documento sem validacao.

**Resposta**:**não entendi** me explique e me questione melhor quando passarmos por essa parte da implementação.

---

### Q10.2 — `calcNextDueDate` pode ter edge case em dezembro
O calculo de `nextMonth` e `nextYear` em `charges.js` (linhas 198-205) usa `month + 1` e modulo 12. Para dezembro (month=11): `nextMonth=12`, `12 > 11 = true` entao `nextYear++`, `normalizedMonth = 12 % 12 = 0` (janeiro). Funciona, mas o `new Date(nextYear, normalizedMonth + 1, 0)` para `lastDayOfNextMonth` usa `normalizedMonth + 1 = 1`, que e fevereiro. Isso calcula o ultimo dia de fevereiro, nao de janeiro. Ha um bug aqui?

Esperado: de 15/dez → proximo vencimento em ~15/jan.
`normalizedMonth = 0` (janeiro), `lastDayOfNextMonth = new Date(2026, 0 + 1, 0) = new Date(2026, 1, 0)` = 31 de janeiro. `safeDay = min(15, 31) = 15`. `nextDate = new Date(2026, 0, 15)` = 15/jan. **Correto!**

Mas o nome `lastDayOfNextMonth` e enganoso — deveria ser `lastDayOfTargetMonth`.

**Resposta**: **intencional** não me parece um edge case, mas renomeie para fazer sentido tomando cuidado de renomear em todos os lugares que é mencionado.

> ✅ **IMPLEMENTADO — v1.17.0** — renomeado para `lastDayOfTargetMonth` em `charges.js`.

---

### Q10.3 — `approveTask` e `requestRevision` fazem require inline
Em `tasksService.approveTask()` (linha 617) e `requestRevision()` (linha 651), `notificationService` e importado com `require()` inline em vez de usar o import do topo do arquivo (que ja existe na linha 4). Isso e intencional (circular dependency?) ou um descuido?

**Resposta**: **bug** acredito ser um descuido.

> ✅ **IMPLEMENTADO — v1.17.0** — `notificationService` usa o import do topo do arquivo em `approveTask` e `requestRevision`.

---

### Q10.4 — `muralService.updatePost` aplica spread do `data` sem filtro
Em `muralService.updatePost()` (linha 65), o `...data` e aplicado diretamente no update. Se o client passar campos como `landlordId`, `createdAt`, etc., eles seriam sobrescritos. As Firestore rules protegem parcialmente (landlordId deve ser imutavel), mas outros campos poderiam ser manipulados.

**Resposta**: **intencional**

---

### Q10.5 — `getContractByCar` faz 2 queries separadas (landlord e tenant)
O metodo tenta como landlord primeiro, depois como tenant (linhas 306-335). Poderia ser otimizado com uma unica query `where('carId', '==', carId).where('active', '==', true)` e filtrar o resultado, mas isso abriria para leitura de contratos de outros locadores (restrito pelas rules). A abordagem atual e correta mas custosa (2 roundtrips no worst case).

**Resposta**: **melhoria** faça da forma mais performática, usando indices compostos, se necessário. agora que podemos fazer deploy de indices compostos por linha de código, tudo ficou mais fácil.

---

### Q10.6 — `getDashboardSummary` e sincrono — deveria ser memoizado?
`paymentService.getDashboardSummary()` e a unica funcao sincrona no service — recebe `charges` como parametro e faz calculos. Dado que e chamada em cada render do ResumoTab, deveria ser memoizada com `useMemo` no componente?

**Resposta**:**intencional**, por serem calculos simples, e sem grandes amostras de dados, acredito que é mais performatico rodar a cada render do que usar memo.

---

### Q10.7 — `PdfViewer` usa HEAD requests para verificar numero de paginas
O `PdfViewer` faz HEAD requests para cada pagina (pg_1, pg_2, pg_3...) do Cloudinary para determinar o numero de paginas do PDF. Isso e lento e nao escalavel para PDFs grandes. O Cloudinary oferece uma API de metadados que retorna o numero de paginas em uma unica chamada.

**Resposta**: **adiar** me questiono se ganhariamos performance utilizando uma API pra isso sendo que normalmente os pdfs que recebemos são bem pequenos (máximo de 3 páginas para alguns documentos), mas no caso onde ganhariamos, é valido.

---

### Q10.8 — Google Web Client ID hardcoded no App.tsx
O `GOOGLE_WEB_CLIENT_ID` esta hardcoded na linha 43 do App.tsx. Deveria estar em uma variavel de ambiente ou config file para facilitar troca entre ambientes (dev/staging/prod).

**Resposta**: **intencional**, nao e problema de seguranca. O Client ID e publico por design (ja exposto no APK via google-services.json). Sem a SHA-1 signing key, e inutil.

---

---

## RESUMO DE PRIORIDADES SUGERIDAS

| Prioridade | Perguntas | Tema |
|-----------|-----------|------|
| **P0 — Critico** | Q1.1, Q1.2, Q1.3, Q2.1, Q3.1, Q3.2 | Seguranca + Performance |
| **P1 — Alto** | Q1.4, Q1.8, Q2.2, Q2.3, Q2.7, Q4.2, Q5.4, Q5.6 | Bugs + Compliance + Arch |
| **P2 — Medio** | Q1.5-Q1.7, Q2.4-Q2.6, Q2.8-Q2.12, Q3.3-Q3.7, Q4.1, Q4.3-Q4.7, Q5.1-Q5.3, Q5.5, Q5.7-Q5.12 | Tudo mais |
| **P3 — Baixo** | Q6.x, Q7.x, Q8.x, Q9.x, Q10.x | Infra + UX + DX |

---

> **Proximo passo**: Responda cada pergunta acima. Apos suas respostas, farei as implementacoes baseadas nas suas decisoes.
