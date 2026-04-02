# Roteiro de Testes — QUESTIONS.md (16 itens)

Organizado por o que é diretamente observável no app.

---

## 1. Mural — Categoria Urgente (Q2.9)
**Locador:**
1. Mural → Criar post → verificar que "Urgente" aparece na lista de categorias
2. Criar post com categoria **Urgente** → salvar → confirmar badge vermelho (`#FEE2E2 / #DC2626`)
3. Criar post com categoria **Aviso** → confirmar badge amarelo (`#FEF3C7 / #92400E`)
4. Criar post com categoria **Geral** → confirmar badge indigo (cor original)

---

## 2. Cancelar Contrato (Q7.4)
**Locador:**
1. Financeiro → Contratos → abrir contrato **ativo**
2. Verificar que botão "Cancelar Contrato" (vermelho) aparece
3. Tocar → confirmar que Alert de confirmação aparece com texto descritivo
4. Confirmar cancelamento → verificar que contrato passa para `active: false` e botão some
5. Abrir contrato **inativo** → verificar que botão **não aparece**

---

## 3. Tarefas — Geração Automática + Intervalos (Q9.8 + Q3.4)
**Setup:** carro com `lastKmUpdate` há mais de 7 dias e `lastPhotoInspection` há mais de 10 dias.

1. Abrir CarDetailsScreen → verificar que tasks de KM e foto são geradas automaticamente
2. Fechar e reabrir CarDetailsScreen em menos de 5 min → verificar que **não** gera tasks duplicadas (rate-limit)
3. Checar prazo das tasks geradas: KM = hoje + 3 dias, Foto = hoje + 5 dias

---

## 4. Solicitação de Manutenção (Q2.2)
**Locatário:**
1. CarDetailsScreen → "Solicitar Manutenção" → preencher e enviar
2. No Firestore, abrir a task criada → confirmar `dueDate` = hoje + 7 dias (não hoje)

---

## 5. Tasks com landlordId (Q9.5)
**Locador:**
1. TasksScreen → aba "Pendentes" → verificar que as tasks aparecem normalmente
2. No Firestore, abrir qualquer task criada **após o deploy** → confirmar que campos `tenantId` e `landlordId` estão presentes
3. Criar nova task manual via CarDetailsScreen → confirmar no Firestore que `landlordId` foi preenchido

---

## 6. Cobranças por carro (Q3.1)
**Locador:**
1. CarDetailsScreen → seção de cobranças → abrir cobranças de um carro específico
2. Verificar que carrega normalmente (sem erro de índice no console)
3. No Firebase Console → Firestore → verificar que o índice `charges[landlordId+carId+dueDate]` está `ENABLED`

---

## 7. Cancelar Contrato ao Remover Locatário
**Locador:**
1. CarDetailsScreen → "Remover Locatário" em carro com contrato ativo
2. Confirmar remoção → verificar que o carro volta para `status: available` e o contrato associado fica `active: false`

---

## 8. Notificações — Auto-delete (Q5.5)
**Qualquer usuário:**
1. Disparar uma ação que gera notificação (ex: locador cria task manual para locatário)
2. No Firebase Console → Firestore → coleção `notifications` → verificar que o documento **desaparece** após poucos segundos (após o push ser enviado)
3. Verificar que o push chegou no dispositivo do destinatário

---

## 9. Google Sign-In — Unicidade CPF/Telefone (Q1.8)
*(Requer conta Google nova que ainda não completou perfil)*

1. Fazer login com Google em conta nova → completar perfil com CPF já cadastrado no app
2. Verificar erro: "Este CPF ja esta cadastrado."
3. Repetir com telefone já cadastrado → verificar erro: "Este numero ja esta cadastrado."

---

## 10. Verificações via logs (Cloud Functions)
Após deploy, no **Firebase Console → Functions → Logs**:

| Item | O que verificar |
|------|----------------|
| Q1.7 | Log do onboarding mostra CPF mascarado (ex: `*******123`) |
| Q5.5 | Log `sendPushNotification` não mostra erros após delete |
| Q3.1 | Sem erros de índice faltante ao abrir cobranças por carro |

---

## Ordem sugerida
1 → 2 → 3 → 4 → 6 → 8 → 5 → demais conforme disponibilidade de conta Google nova.
