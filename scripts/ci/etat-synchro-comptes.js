// Lu par etat-synchro-comptes.sh dans le conteneur crm-server : état des comptes connectés et de leurs canaux.
// Lecture seule, aucun identifiant ni paramètre de connexion lu.
const { Client } = require(process.env.PGMOD);
const VIEUX_MS = 24 * 3600 * 1000;
(async () => {
  const c = new Client({ connectionString: process.env.PG_DATABASE_URL });
  await c.connect();
  await c.query('SET default_transaction_read_only = on');
  const espaces = new Map(
    (await c.query(`select id, subdomain from core.workspace where "deletedAt" is null`)).rows.map((r) => [r.id, r.subdomain]),
  );
  const comptes = (
    await c.query(`select id, "workspaceId", handle, provider, "authFailedAt" from core."connectedAccount"`)
  ).rows;
  const canaux = [];
  for (const [table, genre] of [['messageChannel', 'messagerie'], ['calendarChannel', 'agenda']]) {
    const r = await c.query(
      `select "workspaceId", handle, "syncStatus", "syncStage", "syncedAt", "isSyncEnabled", "connectedAccountId" from core."${table}"`,
    );
    for (const x of r.rows) canaux.push({ ...x, genre });
  }
  const ko = [];
  const maintenant = Date.now();
  for (const a of comptes)
    if (a.authFailedAt) ko.push(`${espaces.get(a.workspaceId) ?? a.workspaceId} ${a.handle} (${a.provider}) : authentification en échec depuis ${a.authFailedAt.toISOString()}`);
  for (const k of canaux) {
    if (!k.isSyncEnabled) continue;
    const ou = `${espaces.get(k.workspaceId) ?? k.workspaceId} ${k.genre} ${k.handle}`;
    if (String(k.syncStatus).startsWith('FAILED')) ko.push(`${ou} : ${k.syncStatus}`);
    else if (k.syncStatus === 'ACTIVE' && (!k.syncedAt || maintenant - k.syncedAt.getTime() > VIEUX_MS))
      ko.push(`${ou} : aucune synchro depuis ${k.syncedAt ? k.syncedAt.toISOString() : 'jamais'}`);
  }
  const actifs = canaux.filter((k) => k.isSyncEnabled).length;
  if (ko.length === 0) console.log(`SYNCHRO_OK ${actifs} canal(aux) actif(s), ${comptes.length} compte(s)`);
  else {
    console.log(`SYNCHRO_KO ${ko.length} écart(s) sur ${actifs} canal(aux) actif(s)`);
    for (const l of ko) console.log(`  ${l}`);
  }
  await c.end();
  process.exit(ko.length === 0 ? 0 : 1);
})().catch((e) => {
  console.log(`SYNCHRO_NON_ABOUTI ${e.message}`);
  process.exit(2);
});
