# FIRESTORE — ÍNDICES E REGRAS DE SEGURANÇA

> Parte da documentação modularizada do CLAUDE.md. Consultar ao criar novas queries ou índices.

---

## Regras de Segurança

As regras estão em `firestore.rules` e seguem:
- `users/{uid}`: escrita restrita ao próprio `userId`; leitura autenticada
- `users/{uid}/private/{doc}`: **bloqueado para o cliente** — acessado apenas via Cloud Functions (admin SDK). Contém PII (CPF, CNPJ, telefone, CNH, endereço).
- `charges`: leitura restrita a `landlordId` ou `tenantId` da cobrança; escrita apenas por autenticado
- `rentalContracts`: escrita restrita ao `landlordId`; leitura autenticada
- Demais coleções: leitura e escrita para qualquer usuário autenticado
- `asaasAccounts`: leitura/escrita bloqueada para o cliente — acessada apenas via Cloud Functions (admin SDK)

---

## Estratégia de Índices

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

---

## Registro de Índices Compostos (20 ativos) + 3 fieldOverrides collection group

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
| `tasks` | landlordId ↑ + status ↑ + dueDate ↑ | `getAllUserTasks` locador pending (Q9.5) |
| `tasks` | landlordId ↑ + status ↑ + completedAt ↓ | `getAllUserTasks` locador completed (Q9.5) |
| `tasks` | carId ↑ + tenantId ↑ + status ↑ + dueDate ↑ | `getCarTasks` locatario pending (Q8.2) |
| `tasks` | carId ↑ + tenantId ↑ + status ↑ + completedAt ↓ | `getCarTasks` locatario completed (Q8.2) |
| `tenantRequests` | carId ↑ + status ↑ | `getSentRequests` |
| `tenantRequests` | carId ↑ + tenantId ↑ + status ↑ | `createContract` (validação) |
| `tenantRequests` | tenantId ↑ + status ↑ + createdAt ↓ | `getPendingRequests` |
| `charges` | landlordId ↑ + carId ↑ + dueDate ↓ | `getChargesByCar` (Q3.1) |
| `rentalContracts` | carId ↑ + landlordId ↑ + active ↑ | `getContractByCar` locador (Q10.5) |
| `rentalContracts` | carId ↑ + tenantId ↑ + active ↑ | `getContractByCar` locatario (Q10.5) |
| `users` | role ↑ + email ↑ | `searchTenantsCF` busca por email (Q1.6) |

**fieldOverrides (collection group `private` — Q1.2 Fase C):**

| Campo | queryScope | Usado em |
|-------|-----------|----------|
| `cpf` | COLLECTION_GROUP | `checkPiiUniqueCF`, `findEmailByIdentifierCF`, `searchTenantsCF` |
| `cnpj` | COLLECTION_GROUP | `checkPiiUniqueCF`, `findEmailByIdentifierCF` |
| `phone` | COLLECTION_GROUP | `checkPiiUniqueCF` |

> **Manter esta tabela e o `firestore.indexes.json` atualizados** ao criar novos índices.
> Exportar: `firebase firestore:indexes > firestore.indexes.json`
