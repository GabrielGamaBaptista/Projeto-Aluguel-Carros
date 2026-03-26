/**
 * apply-iam.js — Aplica IAM policy "roles/run.invoker" para allUsers em todas as
 * Cloud Functions gen2 do projeto (necessario porque a org policy do GCP bloqueia
 * o invoker: 'public' automatico do Firebase gen2).
 *
 * Executado automaticamente pelo hook postdeploy do firebase.json.
 * Pode ser executado manualmente: node functions/scripts/apply-iam.js
 */

const fs = require('fs');
const https = require('https');

const PROJECT = 'aluguel-carros-30b83';
const LOCATION = 'us-central1';

// Lista completa de Cloud Run services (nomes em lowercase do Firebase export)
const SERVICES = [
  'createasaassubaccount',
  'checkonboarding',
  'createcharge',
  'cancelcharge',
  'editcharge',
  'getpixqrcode',
  'generaterecurringcharges',
  'createcontractcf',
  'cancelcontract',
  'editcontract',
  'asaaswebhook',
  'getcloudinarysignature',
  'sendpushnotification',
  'notifyoverduetasks',
  // Adicionados nesta sessao (Q1.4 e Q2.3):
  'assigntenantcf',
  'deletecarcf',
  // Adicionados no batch 3 (Q1.2):
  'gettenantdetailscf',
  // Adicionados no batch 3 (Q5.4):
  'deleteaccountcf',
  // Adicionados no batch 4 (Q5.12):
  'pausecontract',
];

function getAccessToken() {
  try {
    const credsPath = `${process.env.USERPROFILE || process.env.HOME}/.config/configstore/firebase-tools.json`;
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    return creds.tokens?.access_token || null;
  } catch (e) {
    console.error('Nao foi possivel ler o token de acesso:', e.message);
    return null;
  }
}

function setIamPolicy(token, service) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      policy: {
        bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }],
      },
    });

    const url = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${LOCATION}/services/${service}:setIamPolicy`;

    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log(`  OK  ${service}`);
          } else if (res.statusCode === 404) {
            console.log(`  --  ${service} (nao encontrado — pode nao ter sido deployado ainda)`);
          } else if (res.statusCode === 401) {
            console.error('\nERRO: Token expirado. Execute "firebase login" para renovar e repita o deploy.');
            process.exit(1);
          } else {
            console.warn(`  !!  ${service} -> HTTP ${res.statusCode}`);
          }
          resolve();
        });
      }
    );

    req.on('error', (err) => {
      console.error(`  EE  ${service} -> ${err.message}`);
      resolve();
    });

    req.write(body);
    req.end();
  });
}

async function main() {
  const token = getAccessToken();
  if (!token) {
    console.error('Token de acesso nao encontrado. Execute "firebase login" e tente novamente.');
    process.exit(1);
  }

  console.log(`\nAplicando IAM policy em ${SERVICES.length} servicos Cloud Run...\n`);

  // Processar em paralelo (sem delay necessario para operacoes IAM)
  await Promise.all(SERVICES.map((svc) => setIamPolicy(token, svc)));

  console.log('\nIAM policy concluido.\n');
}

main();
