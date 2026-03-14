const { onCall, HttpsError } = require('firebase-functions/v2/https');
const crypto = require('crypto');

exports.getCloudinarySignature = onCall({ cors: true, invoker: 'public' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario nao autenticado.');
  }

  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dzjqdjdcz';

  if (!apiSecret || !apiKey) {
    console.error('CLOUDINARY_API_SECRET ou CLOUDINARY_API_KEY nao configurados.');
    throw new HttpsError('internal', 'Configuracao de upload indisponivel.');
  }

  const timestamp = Math.round(new Date().getTime() / 1000);
  const folder = 'aluguel-carros';
  const paramsToSign = 'folder=' + folder + '&timestamp=' + timestamp;
  const signature = crypto
    .createHash('sha256')
    .update(paramsToSign + apiSecret)
    .digest('hex');

  return { signature, timestamp, apiKey, cloudName, folder };
});
