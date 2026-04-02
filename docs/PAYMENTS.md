# SISTEMA DE PAGAMENTOS (ASAAS)

> Parte da documentação modularizada do CLAUDE.md. Consultar ao trabalhar em funcionalidades de pagamento, contratos ou cobranças.

---

## Onboarding do Locador

1. Antes de criar contratos/cobranças, o locador precisa ter uma **subconta Asaas**
2. `checkOnboarding` (Cloud Function) verifica se a subconta existe no Firestore (`asaasAccounts/{uid}`)
3. Se não existe, locador chama `createAsaasSubaccount` → cria subconta via API Asaas e salva `apiKey` + `walletId` no Firestore
4. **Lock com TTL de 10 minutos** (`isCreating: true`) previne criação duplicada de subcontas
5. O webhook da Asaas é **cadastrado automaticamente** na subconta durante o onboarding
6. A `apiKey` da subconta **nunca é exposta ao app** — fica somente no Firestore, acessada apenas via Cloud Functions

---

## Contratos de Aluguel

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

---

## Cobranças Recorrentes (Cron)

- Cloud Function `generateRecurringCharges` executa **diariamente às 08h (America/Sao_Paulo)**
- **Mensal**: processa se `nextDueDate <= hoje + 5 dias`
- **Semanal**: processa se `nextDueDate <= último dia do mês atual` — gera lote do mês
- **Quinzenal**: processa se `nextDueDate <= hoje + 16 dias` — garante 1 cobrança futura pending
- Idempotência: ignora cobranças já existentes com mesmo `contractId + dueDate` (exceto CANCELLED)
- Em caso de falha, `nextDueDate` não avança — cron retenta no dia seguinte
- `nextChargeOverride`: se definido no contrato, a próxima cobrança mensal usa esse valor e o campo é limpo após uso

---

## Cobranças Avulsas

- Locador pode criar cobrança avulsa via `ChargesScreen` (sem vínculo a contrato)
- Validação: carro pertence ao locador + locatário está vinculado ao carro

---

## Edição de Cobrança

- Locador pode editar valor de uma cobrança PENDING/OVERDUE
- Cloud Function `editCharge`:
  1. Cria nova cobrança no Asaas com novo valor
  2. Atualiza Firestore com novo `asaasPaymentId` ANTES de deletar a antiga
  3. Deleta cobrança antiga no Asaas
  (ordem garante consistência se o webhook chegar durante a operação)

---

## Edição de Contrato

- Locador pode editar `rentAmount` permanente do contrato via `ContractDetailsScreen`
- Também pode definir `nextChargeOverride` para alterar o valor pontual da próxima cobrança mensal
- Cloud Function `editContract` valida ownership e que o contrato está ativo

---

## Cancelamento de Cobrança

- Locador pode cancelar cobranças PENDING/OVERDUE (não pode cancelar RECEIVED/CONFIRMED)
- Cloud Function `cancelCharge`:
  - Se Asaas retornar 404: prossegue (já deletado)
  - Se Asaas retornar erro não-404: faz GET para verificar status real (webhook pode ter falhado) e sincroniza Firestore

---

## Cancelamento / Pausa de Contrato

- `cancelContract` CF: cancela contrato + cobranças atomicamente via `Promise.allSettled` + batch; partial failure salva sucessos e não derruba contrato
- `pauseContract` CF: pausa contrato (suspende geração de novas cobranças pelo cron)
- Ao remover locatário do carro, `cancelContract` é chamada automaticamente

---

## Webhook Asaas

- URL: `https://asaaswebhook-3sd2w2j7mq-uc.a.run.app`
- Cadastrado automaticamente em cada subconta durante o onboarding
- Atualiza `status`, `paymentDate`, `netAmount`, `platformFee` no Firestore via transação atômica
- `processedEvents[]` garante idempotência (mesmo evento não processado duas vezes)
- Bloqueio de regressão de status: RECEIVED/CONFIRMED não regride para OVERDUE
- Zombie charge recovery: fallback por `asaasPaymentId` se `externalReference` não encontrado
- Suporta eventos: `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED`, `PAYMENT_UPDATED`

---

## QR Code PIX

- Gerado sob demanda via Cloud Function `getPixQrCode`
- Somente `tenantId` ou `landlordId` da cobrança podem solicitar
- No `PaymentDetailsScreen`, QR Code usa `asaasPaymentId` como chave (não recarrega ao mudar PENDING→OVERDUE)

---

## Aba Financeiro (Locador)

- `FinancialDashboardScreen` com **top tabs**:
  - **Resumo**: cards de totais (recebido, pendente, vencido) + BarChart dos últimos 6 meses
  - **Contratos**: lista todos os contratos (ativos primeiro) → navega para `ContractDetailsScreen`
  - **Cobranças**: lista com filtros por carro e por status (filtros persistem ao navegar via context)
  - **Despesas**: registro de despesas do veículo via `DespesasTab` e `expenseService`
- `AddCarScreen` foi movido para stack screen; card "Adicionar Carro" está na HomeScreen

## Aba Pagamentos (Locatário)

- Bottom tab "Pagamentos" visível apenas para locatários
- `TenantPaymentsScreen`: lista cobranças onde `tenantId == uid` do locatário
- Navega para `PaymentDetailsScreen` para ver detalhes e pagar via PIX

---

## Notificações de Pagamento

Eventos que geram notificações (salvas em `notifications/`):
- Novo contrato criado → locatário
- Contrato encerrado → locatário
- Contrato editado (valor alterado) → locatário
- Nova cobrança criada → locatário
- Cobrança cancelada → locatário
- Cobrança editada (valor alterado) → locatário
- Cobrança vencendo em 3 dias → locatário (via cron, com flag de idempotência `notificationFlags.warning3Days`)

---

## Robustez do Client Asaas

- `functions/src/asaas/client.js`: timeout 30s + retry exponencial (1s/2s/4s) para 429/5xx, max 3 tentativas
- `customers.js`: `console.warn` para múltiplos customers (CPF mascarado — 3 últimos dígitos)
