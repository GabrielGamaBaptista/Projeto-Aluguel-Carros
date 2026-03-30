# Relatório Extensivo de Validação de Segurança - BapCar App

Após uma análise profunda em toda a base de código, regras do Firestore e Cloud Functions, este relatório detalha falhas críticas de segurança, arquitetura e privacidade que precisam ser corrigidas antes do lançamento em produção. **O falso positivo referente ao Cloudinary foi removido, pois o código atual (`src/config/cloudinary.js`) implementa corretamente uploads assinados.**

---

## 1. Vulnerabilidades Críticas (Prioridade Máxima)

### 🔴 IDOR na Criação de Cobranças (Geração Arbitrária de Dívidas)
*   **Vulnerabilidade:** Na Cloud Function `createCharge` (`functions/src/handlers/charges.js`), a validação de propriedade e vínculo (`carData.landlordId !== data.landlordId` e `carData.tenantId !== data.tenantId`) está condicionada à presença do campo `carId` (`if (data.carId)`). 
*   **Risco:** Se um locador mal-intencionado chamar a função omitindo o `carId`, o bloco de validação é **totalmente ignorado**. A função interna `_createChargeInternal` prossegue, buscando qualquer `tenantId` informado (como um ID obtido na busca de locatários), criando um "Customer" na subconta Asaas do locador e gerando um boleto/PIX oficial contra aquela pessoa. Isso permite que um locador gere cobranças financeiras reais para *qualquer* usuário do sistema sem autorização prévia.
*   **Recomendação:** Tornar `carId` obrigatório em `createCharge` ou garantir que, se for uma cobrança sem carro (avulsa), a função valide rigorosamente que o `tenantId` fornecido possui pelo menos um vínculo ativo (`rentalContracts` ou `cars`) com o `landlordId` que está solicitando.

### 🔴 Data Leakage e Spam Vetor no Mural (Mural de Avisos)
*   **Vulnerabilidade:** O cliente realiza a criação de `mural_posts` diretamente no Firestore (`muralService.js`). As regras de segurança (`firestore.rules`) não validam se o `targetTenantId` pertence realmente a um locatário vinculado ao locador. Pior ainda, a regra de leitura permite que qualquer usuário autenticado leia um post se `targetType == 'all'` (`allow read: if ... || resource.data.targetType == 'all'`).
*   **Risco:** 
    1. **Spam/Phishing Direcionado:** Um locador pode enviar avisos para locatários de outros locadores usando a busca por CPF/Email para obter os IDs, resultando em notificações push indevidas e mensagens na tela inicial de terceiros.
    2. **Vazamento de Dados:** Qualquer locatário que saiba consultar o Firestore diretamente pelo client SDK pode ler *todos* os avisos globais de *todos* os locadores da plataforma, violando o isolamento de tenants.
*   **Recomendação:** 
    1. Mover a criação de posts do mural para uma Cloud Function que valide estritamente o vínculo entre `landlordId` e `targetTenantId`.
    2. Modificar as regras de leitura do `mural_posts` para permitir a leitura de `targetType == 'all'` APENAS se o leitor estiver vinculado a um carro do `landlordId` daquele post.

### 🔴 Spam e Abuso na Coleção de Notificações
*   **Vulnerabilidade:** A regra de segurança do Firestore para a coleção `notifications` permite que *qualquer* usuário autenticado crie documentos para *qualquer outro* usuário (`allow create: if request.auth != null ... && request.resource.data.userId != request.auth.uid`).
*   **Risco:** Um usuário mal-intencionado pode disparar notificações push em massa (via trigger `sendPushNotification` que lê desta coleção) contendo links de phishing, engenharia social ou assédio, diretamente para os celulares de outros usuários.
*   **Recomendação:** Bloqueie a criação via client-side (`allow create: if false` em `/notifications`) e mantenha o envio de notificações exclusivamente via Cloud Functions. A maior parte do sistema (tarefas, contratos) já faz isso de forma correta.

---

## 2. Vulnerabilidades de Severidade Média

### 🟡 Acesso Público Irrestrito à Raiz da Coleção de Usuários
*   **Vulnerabilidade:** A regra `allow read: if request.auth != null;` no path `/users/{userId}` permite que qualquer pessoa com uma conta no app leia todos os documentos públicos.
*   **Risco:** Apesar da excelente segregação de PII (CPF, endereço) para a subcoleção `private/data`, o documento raiz de `/users` ainda expõe nome, e-mail e foto do Google. Um usuário mal-intencionado pode fazer um dump (scraping) de toda a base de e-mails do sistema para fins de spam ou venda de dados.
*   **Recomendação:** Restringir a leitura ampla. Os dados públicos de um usuário devem ser acessados apenas via Cloud Functions autorizadas (como já é feito na `getTenantDetailsCF`) ou ajustando as regras para permitir leitura apenas entre pares vinculados via a coleção `cars`.

### 🟡 Spam de Solicitações de Vínculo (Tenant Requests)
*   **Vulnerabilidade:** A regra de criação de `/tenantRequests/` valida apenas que o remetente é ele mesmo, sem validação de limites ou relação.
*   **Risco:** Permite que locadores bombardeiem contas de locatários com solicitações indesejadas. É parcialmente mitigado pelo fato de o locatário poder aceitar apenas um carro, mas ainda gera notificações e sujeira no banco.
*   **Recomendação:** Adicionar restrições de "Rate Limiting" na criação de solicitações, ou mover a criação inteira para uma Cloud Function para coibir ataques de repetição rápida.

---

## 3. Vulnerabilidades de Severidade Baixa (Privacidade UX)

### 🔵 Enumeração de PII na Verificação de Unicidade
*   **Vulnerabilidade:** A função `checkPiiUniqueCF` é pública (sem auth) para permitir o fluxo de cadastro.
*   **Risco:** Informa se um determinado CPF, CNPJ ou número de telefone já está registrado na plataforma. Embora o excelente limite de 10 chamadas/minuto por IP mitigue ataques de força bruta massivos, a enumeração manual (verificar se uma pessoa específica usa o app) ainda é possível.
*   **Recomendação:** Para o lançamento, o risco é tolerável devido ao ganho vital em UX, mas considere implementar App Check, reCAPTCHA ou exigir autenticação básica para o endpoint num futuro próximo.

---

## 4. Pontos Fortes da Arquitetura (Aprovados)

*   **Gestão de Chaves Asaas (Gen 2):** Implementação excelente do *Firebase Secret Manager*. O padrão Lazy Load com `Proxy` e interceptadores Axios para injetar as chaves garante que tokens críticos nunca vazem e não fiquem hardcoded.
*   **Webhooks Seguros e Idempotentes:** A rota `asaasWebhook` trata regressões de status de forma correta e usa transações do Firestore (`db.runTransaction`) com verificação estrita em `processedEvents`, impossibilitando ataques de *replay* e corridas de concorrência que duplicariam processamentos de pagamentos.
*   **Cloudinary Signed Uploads:** A geração do `getCloudinarySignature` com hash SHA256 do lado do servidor em conformidade com a documentação do Cloudinary garante segurança total na ingestão de mídias, impedindo uploads anônimos em lote.
*   **Isolamento LGPD e Exclusão Cascata:** O script `accountDeletion.js` lida de forma exemplar com a exclusão e anonimização cruzada (apagando PII mas preservando o histórico financeiro estrutural para a outra ponta), cumprindo padrões de compliance de forma técnica impecável e segura utilizando o limite de lotes (Batch Limits) do Firestore.
