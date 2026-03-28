const admin = require('firebase-admin');

// Inicializar admin SDK
admin.initializeApp();

// Importar handlers
const onboarding = require('./src/handlers/onboarding');
const charges = require('./src/handlers/charges');
const contracts = require('./src/handlers/contracts');
const webhooks = require('./src/handlers/webhooks');
const cloudinarySign = require('./src/handlers/cloudinarySign');
const notifications = require('./src/handlers/notifications');
const taskNotifications = require('./src/handlers/taskNotifications');

/**
 * EXPORTS - Cloud Functions v2 API
 */

// Onboarding
exports.createAsaasSubaccount = onboarding.createAsaasSubaccount;
exports.checkOnboarding = onboarding.checkOnboarding;

// Cobrancas
exports.createCharge = charges.createCharge;
exports.cancelCharge = charges.cancelCharge;
exports.editCharge = charges.editCharge;
exports.getPixQrCode = charges.getPixQrCode;
exports.generateRecurringCharges = charges.generateRecurringCharges;

// Contratos
exports.createContractCF = contracts.createContract;
exports.cancelContract = contracts.cancelContract;
exports.editContract = contracts.editContract;
exports.pauseContract = contracts.pauseContract;

// Webhooks
exports.asaasWebhook = webhooks.asaasWebhook;

// Cloudinary
exports.getCloudinarySignature = cloudinarySign.getCloudinarySignature;

// Notificacoes push
exports.sendPushNotification = notifications.sendPushNotification;

// Atribuicao de locatario (Q1.4 — seguranca)
const tenantAssignment = require('./src/handlers/tenantAssignment');
exports.assignTenantCF = tenantAssignment.assignTenant;

// Exclusao de carro com cascade (Q2.3)
const carManagement = require('./src/handlers/carManagement');
exports.deleteCarCF = carManagement.deleteCarCF;

// Perfil de usuario — leitura cross-user de PII via CF segura (Q1.2)
const userProfile = require('./src/handlers/userProfile');
exports.getTenantDetailsCF = userProfile.getTenantDetailsCF;

// Tasks
exports.notifyOverdueTasks = taskNotifications.notifyOverdueTasks;

// Exclusao de conta com cascade LGPD (Q5.4)
const accountDeletion = require('./src/handlers/accountDeletion');
exports.deleteAccountCF = accountDeletion.deleteAccountCF;

// Queries de PII via admin SDK — sem expor dados no doc publico (Q1.2 Fase C)
const piiQueries = require('./src/handlers/piiQueries');
exports.checkPiiUniqueCF = piiQueries.checkPiiUniqueCF;
exports.findEmailByIdentifierCF = piiQueries.findEmailByIdentifierCF;

// Busca de locatarios restrita ao locador autenticado (Q1.6)
const tenantSearch = require('./src/handlers/tenantSearch');
exports.searchTenantsCF = tenantSearch.searchTenantsCF;

// Criar notificacao via CF segura — SEC-01
const createNotification = require('./src/handlers/createNotification');
exports.createNotificationCF = createNotification.createNotificationCF;
