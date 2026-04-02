# FLUXOS DE AUTENTICAÇÃO E NEGÓCIO

> Parte da documentação modularizada do CLAUDE.md. Consultar ao modificar login, cadastro, atribuição de locatário, tarefas ou mural.

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
- Email + senha OU CPF + senha (detecta automaticamente via `findEmailByIdentifierCF`)
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
2. Busca por **email** (prefix match via `searchTenantsCF`) ou **CPF** (match exato)
3. Clica "Enviar" → cria `tenantRequest` com status `pending`
4. Locatário vê card na HomeScreen seção "Solicitações Pendentes"
5. **Aceitar**: `tenantRequest` → `accepted`, carro recebe `tenantId` via `assignTenantCF`, outras solicitações pendentes para o mesmo carro são canceladas automaticamente
6. **Recusar**: `tenantRequest` → `rejected`, locador é notificado
7. Locador pode **cancelar** solicitações enviadas

**Regra**: Cada locatário só pode ter **1 carro** atribuído por vez (verificação em `carsService.checkTenantHasCar`).

### Remoção de Locatário
- Locador pode remover via CarDetailsScreen → "Remover Locatário"
- Antes de desatribuir: `paymentService.cancelActiveContractByCar(carId)` chama CF `cancelContract` que cancela o contrato ativo + todas as cobranças PENDING/OVERDUE
- Volta carro para `status: 'available'`, `tenantId: null`
- Tarefas pendentes do carro permanecem no Firestore (não são deletadas)

### Tarefas — Geração Automática

O sistema gera tarefas automaticamente baseado em intervalos:

| Tipo | Intervalo | Prazo |
|------|-----------|-------|
| `km_update` | A cada **7 dias** sem atualização | 3 dias |
| `photo_inspection` | A cada **10 dias** sem inspeção | 5 dias |
| `oil_change` | A cada **10.000 km** rodados | 7 dias |

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
- Locador cria avisos com categorias: `geral`, `pagamento`, `contato`, `regras`, `aviso`, `urgente`
- Posts criados via CF `createMuralPostCF` (validação server-side)
- Pode direcionar: todos locatários, locatário específico, ou carro específico
- Posts podem ser fixados (`pinned`)
- Locatário vê posts do seu locador na HomeScreen
