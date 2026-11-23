// refus-identite-ia.js : envoie au faux fournisseur (fournisseur-ia-epreuve.js) des assertions forgées et imprime
// son verdict pour chacune. Lancé dans le conteneur crm-server du staging, avec le secret de son environnement
// (jamais affiché). Usage : node refus-identite-ia.js <port du faux fournisseur> <workspace_id attendu>
const crypto = require('crypto');

const [port, attendu] = process.argv.slice(2);
const SECRET = process.env.VERIDIAN_IA_IDENTITE_SECRET || '';
const b64 = (x) => Buffer.from(x).toString('base64url');

const forger = (secret, claims) => {
  const signe = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify(claims))}`;
  return `${signe}.${b64(crypto.createHmac('sha256', secret).update(signe).digest())}`;
};

const claims = (autres = {}) => {
  const iat = Math.floor(Date.now() / 1000);
  return { iss: 'veridian-crm', aud: 'https://app.veridian.site/api/ia/v1', workspace_id: attendu, hub_user_id: 'epreuve', fil: 'epreuve', iat, exp: iat + 60, jti: crypto.randomUUID(), ...autres };
};

const cas = [
  ['sans en-tête', null],
  ['signature fausse', forger('une-autre-cle-de-test-de-plus-de-32-octets', claims())],
  ['expirée', forger(SECRET, claims({ iat: Math.floor(Date.now() / 1000) - 120, exp: Math.floor(Date.now() / 1000) - 60 }))],
  ['workspace qui ne correspond pas', forger(SECRET, claims({ workspace_id: 'c6005824-6d1a-4c72-b5e6-b94ee950477a' }))],
  ['contrôle positif (valide)', forger(SECRET, claims())],
];

(async () => {
  for (const [nom, jeton] of cas) {
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(jeton ? { 'x-veridian-ia-identite': jeton } : {}) },
      body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'épreuve' }] }),
    });
    const d = await r.json();
    console.log(`${nom.padEnd(34)} -> ${d.choices[0].message.content}`);
  }
})().catch((e) => {
  console.log(`NON ABOUTI ${e.message}`);
  process.exit(2);
});
