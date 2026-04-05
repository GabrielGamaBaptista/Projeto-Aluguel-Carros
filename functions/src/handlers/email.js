// functions/src/handlers/email.js
// CF para envio de email de verificacao via Resend (dominio proprio @bapcar.tech).
// Substitui o sendEmailVerification() nativo do Firebase Auth para controle total
// do remetente e template.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const axios = require('axios');
const admin = require('firebase-admin');
const { checkRateLimit } = require('../utils/rateLimiter');

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');

const EMAIL_FROM = 'BapCar <noreply@bapcar.app>';
const APP_NAME = 'BapCar';

function buildVerificationEmailHtml(link) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <span style="font-size:28px;font-weight:bold;color:#4F46E5;">${APP_NAME}</span>
            </td>
          </tr>
          <tr>
            <td style="font-size:16px;color:#111827;padding-bottom:16px;">
              Bem-vindo ao ${APP_NAME}!
            </td>
          </tr>
          <tr>
            <td style="font-size:14px;color:#6B7280;padding-bottom:32px;line-height:1.6;">
              Confirme seu endereco de email clicando no botao abaixo para ativar sua conta.
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <a href="${link}" style="display:inline-block;background:#4F46E5;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">
                Confirmar email
              </a>
            </td>
          </tr>
          <tr>
            <td style="font-size:12px;color:#9CA3AF;border-top:1px solid #F3F4F6;padding-top:24px;line-height:1.5;">
              Se voce nao criou uma conta no ${APP_NAME}, ignore este email.<br>
              O link expira em 24 horas.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * sendVerificationEmailCF — envia email de verificacao via Resend.
 *
 * Chamado pelo app logo apos criar conta (substitui user.sendEmailVerification())
 * e tambem para reenvio manual.
 *
 * Rate limit: 5 chamadas/minuto por usuario.
 */
exports.sendVerificationEmailCF = onCall(
  { cors: true, invoker: 'public', secrets: [RESEND_API_KEY] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'O usuario deve estar autenticado.');
    }

    try {
      await checkRateLimit(request.auth.uid, 'sendVerificationEmail', 5, 60000);

      // Fonte de verdade: registro atualizado no Firebase Auth (evita email defasado do JWT)
      const userRecord = await admin.auth().getUser(request.auth.uid);
      const email = userRecord.email;
      if (!email) {
        throw new HttpsError('invalid-argument', 'Usuario sem email cadastrado.');
      }

      // Verificar se ja confirmado — evitar envio desnecessario
      if (userRecord.emailVerified) {
        return { success: true, alreadyVerified: true };
      }

      const apiKey = RESEND_API_KEY.value();
      if (!apiKey) {
        console.error('RESEND_API_KEY nao configurado.');
        throw new HttpsError('internal', 'Servico de email indisponivel.');
      }

      const link = await admin.auth().generateEmailVerificationLink(email);

      await axios.post(
        'https://api.resend.com/emails',
        {
          from: EMAIL_FROM,
          to: [email],
          subject: `Confirme seu email — ${APP_NAME}`,
          html: buildVerificationEmailHtml(link),
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      return { success: true };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      // Erro HTTP da API do Resend (4xx/5xx): axios popula err.response
      if (err.response) {
        console.error('Erro na API do Resend:', err.response.status, JSON.stringify(err.response.data));
      } else {
        console.error('Excecao em sendVerificationEmailCF:', err.message);
      }
      throw new HttpsError('internal', 'Falha no processamento do e-mail.');
    }
  }
);
