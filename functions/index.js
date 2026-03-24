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

// Tasks
exports.notifyOverdueTasks = taskNotifications.notifyOverdueTasks;
