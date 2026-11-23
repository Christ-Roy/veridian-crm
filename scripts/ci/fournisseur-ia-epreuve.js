// fournisseur-ia-epreuve.js : faux fournisseur « veridian » compatible OpenAI, pour prouver l'identité IA (VER-203).
// Lancé à la main DANS le conteneur crm-server du staging (127.0.0.1, même réseau que le serveur), borné à la session,
// jamais un service. Il répond à POST /v1/chat/completions par une complétion dont le texte est son VERDICT sur
// l'en-tête x-veridian-ia-identite, vérifié indépendamment du code du CRM. Le secret vient de l'environnement du
// conteneur (VERIDIAN_IA_IDENTITE_SECRET), jamais affiché. Usage : node fournisseur-ia-epreuve.js [port]
const http = require('http');
const crypto = require('crypto');

const SECRET = process.env.VERIDIAN_IA_IDENTITE_SECRET || '';
const PORT = Number(process.argv[2] || 18765);
const ATTENDU = process.argv[3] || null;
const vus = new Set();

if (SECRET.length < 32) {
  console.log('NON ABOUTI : secret absent du conteneur');
  process.exit(2);
}

const b64 = (s) => Buffer.from(s, 'base64url');

const verdict = (jeton) => {
  if (!jeton) return 'REFUSE en-tête absent';
  const p = jeton.split('.');
  if (p.length !== 3) return 'REFUSE jeton illisible';
  const attendue = crypto.createHmac('sha256', SECRET).update(`${p[0]}.${p[1]}`).digest();
  const recue = b64(p[2]);
  if (recue.length !== attendue.length || !crypto.timingSafeEqual(recue, attendue)) return 'REFUSE signature fausse';
  const c = JSON.parse(b64(p[1]).toString('utf8'));
  const maintenant = Math.floor(Date.now() / 1000);
  if (c.iss !== 'veridian-crm' || c.aud !== 'https://app.veridian.site/api/ia/v1') return 'REFUSE émetteur ou audience';
  if (!(c.exp > maintenant) || c.exp - c.iat > 60) return 'REFUSE expiré';
  if (ATTENDU && c.workspace_id !== ATTENDU) return 'REFUSE workspace qui ne correspond pas';
  if (vus.has(c.jti)) return 'REFUSE rejoué';
  vus.add(c.jti);
  return `IDENTITE OK workspace_id=${c.workspace_id} hub_user_id=${c.hub_user_id} fil=${c.fil}`;
};

http
  .createServer((req, res) => {
    let corps = '';
    req.on('data', (d) => (corps += d));
    req.on('end', () => {
      if (req.method !== 'POST') return res.end('ok');
      const fuite = 'x-veridian-ia-contexte' in req.headers;
      const texte = verdict(req.headers['x-veridian-ia-identite']) + (fuite ? ' ; FUITE du contexte interne' : '');
      console.log(`${new Date().toISOString()} ${req.url} ${texte}`);
      let modele = 'auto';
      try {
        modele = JSON.parse(corps).model || modele;
      } catch {}
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'epreuve',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: modele,
          choices: [{ index: 0, message: { role: 'assistant', content: texte }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`fournisseur d'épreuve sur 127.0.0.1:${PORT}`));
