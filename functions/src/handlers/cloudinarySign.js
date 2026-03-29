const { onCall, HttpsError } = require('firebase-functions/v2/https');
const crypto = require('crypto');
const { CLOUDINARY_API_KEY: CLOUDINARY_API_KEY_SECRET, CLOUDINARY_API_SECRET: CLOUDINARY_API_SECRET_SECRET } = require('../asaas/client');

exports.getCloudinarySignature = onCall({ cors: true, invoker: 'public', secrets: [CLOUDINARY_API_KEY_SECRET, CLOUDINARY_API_SECRET_SECRET] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }

  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  // SEC-21: sem fallback hardcoded — variavel obrigatoria
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

  if (!apiSecret || !apiKey || !cloudName) {
    console.error('CLOUDINARY_API_SECRET, CLOUDINARY_API_KEY ou CLOUDINARY_CLOUD_NAME nao configurados.');
    throw new HttpsError('internal', 'Configuracao de upload indisponivel.');
  }

  const timestamp = Math.round(new Date().getTime() / 1000);
  // SEC-12: pasta isolada por usuario — impede acesso cross-user a uploads nao processados
  const folder = 'aluguel-carros/' + request.auth.uid;
  const paramsToSign = 'folder=' + folder + '&timestamp=' + timestamp;
  const signature = crypto
    .createHash('sha256')
    .update(paramsToSign + apiSecret)
    .digest('hex');

  return { signature, timestamp, apiKey, cloudName, folder };
});
