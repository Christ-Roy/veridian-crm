// Lu par preuve-suspension.py dans le conteneur crm-server. Lecture seule.
// Rend l'état d'un espace (activationStatus, suspendedAt) et le décompte de ses fiches, toutes lignes comprises.
const { Client } = require(process.env.PGMOD);
const TABLES = ['person', 'company', 'opportunity', 'note', 'task', 'workspaceMember', 'message', 'calendarEvent'];
(async () => {
  const c = new Client({ connectionString: process.env.PG_DATABASE_URL });
  await c.connect();
  await c.query('SET default_transaction_read_only = on');
  const w = (
    await c.query(
      `select id, "activationStatus" as statut, "suspendedAt" as suspendu, "databaseSchema" as schema from core.workspace where subdomain = $1 and "deletedAt" is null`,
      [process.env.SOUS_DOMAINE],
    )
  ).rows[0];
  if (!w || !w.schema) {
    console.log('ESPACE_NON_ABOUTI espace introuvable');
    process.exit(2);
  }
  const comptes = {};
  for (const t of TABLES) {
    const existe = await c.query(
      `select 1 from information_schema.tables where table_schema = $1 and table_name = $2`,
      [w.schema, t],
    );
    if (existe.rowCount === 0) continue;
    comptes[t] = Number((await c.query(`select count(*) as n from "${w.schema}"."${t}"`)).rows[0].n);
  }
  await c.end();
  console.log('ESPACE ' + JSON.stringify({ statut: w.statut, suspendu: w.suspendu, comptes }));
  process.exit(Object.keys(comptes).length ? 0 : 2);
})().catch((e) => {
  console.log('ESPACE_NON_ABOUTI ' + e.message);
  process.exit(2);
});
