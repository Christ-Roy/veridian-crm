// Lu par membres-orphelins.sh dans le conteneur crm-server. Lecture seule.
// Une fiche workspaceMember vivante sans appartenance vivante fait échouer currentUser.workspaceMembers pour tout l'espace.
const { Client } = require(process.env.PGMOD);
(async () => {
  const c = new Client({ connectionString: process.env.PG_DATABASE_URL });
  await c.connect();
  await c.query('SET default_transaction_read_only = on');
  const espaces = (
    await c.query(
      `select id, subdomain, "databaseSchema" as schema from core.workspace where "deletedAt" is null and "databaseSchema" <> ''`,
    )
  ).rows;
  let vus = 0;
  let fiches = 0;
  const orphelins = [];
  for (const e of espaces) {
    const existe = await c.query(
      `select 1 from information_schema.tables where table_schema = $1 and table_name = 'workspaceMember'`,
      [e.schema],
    );
    if (existe.rowCount === 0) continue;
    vus += 1;
    const r = await c.query(
      `select m."userEmail", u.id is not null as vivant
         from "${e.schema}"."workspaceMember" m
         left join core."userWorkspace" u
           on u."userId" = m."userId" and u."workspaceId" = $1 and u."deletedAt" is null
        where m."deletedAt" is null`,
      [e.id],
    );
    fiches += r.rowCount;
    for (const x of r.rows) if (!x.vivant) orphelins.push(`${e.subdomain} ${x.userEmail}`);
  }
  await c.end();
  if (vus === 0 || fiches === 0) {
    console.log(`MEMBRES_NON_ABOUTI ${vus} espace(s), ${fiches} fiche(s) lues`);
    process.exit(2);
  }
  console.log(
    `${orphelins.length ? 'MEMBRES_KO' : 'MEMBRES_OK'} ${vus} espace(s), ${fiches} fiche(s), ${orphelins.length} orpheline(s)`,
  );
  for (const o of orphelins) console.log(`  ${o}`);
  process.exit(orphelins.length ? 1 : 0);
})().catch((e) => {
  console.log(`MEMBRES_NON_ABOUTI ${e.code ?? e.name}`);
  process.exit(2);
});
