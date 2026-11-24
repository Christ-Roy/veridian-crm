// Chaque fiche de membre vivante vise-t-elle le compte qui a l'accès à l'espace, avec la même adresse ? Lecture seule.
const { Client } = require('/app/node_modules/pg');
const masque = (e) => String(e || '').replace(/^(.).*@/, '$1***@');

(async () => {
  const c = new Client({ connectionString: process.env.PG_DATABASE_URL });
  await c.connect();
  await c.query('SET default_transaction_read_only = on');
  const espaces = (
    await c.query(
      `select id, subdomain, "databaseSchema" s from core.workspace where "deletedAt" is null and "databaseSchema" is not null`,
    )
  ).rows;
  let fiches = 0;
  let acces = 0;
  const ecarts = [];
  for (const w of espaces) {
    const a = (
      await c.query(
        `select u.id, u.email from core."userWorkspace" uw join core."user" u on u.id = uw."userId"
          where uw."workspaceId" = $1 and uw."deletedAt" is null and u."deletedAt" is null`,
        [w.id],
      )
    ).rows;
    const f = (
      await c.query(`select id, "userId", "userEmail" from "${w.s}"."workspaceMember" where "deletedAt" is null`)
    ).rows;
    acces += a.length;
    fiches += f.length;
    for (const x of f) {
      const u = a.find((y) => y.id === x.userId);
      if (!u) ecarts.push(`${w.subdomain} : fiche ${masque(x.userEmail)} vise un compte sans accès`);
      else if ((u.email || '').toLowerCase() !== (x.userEmail || '').toLowerCase())
        ecarts.push(`${w.subdomain} : fiche ${masque(x.userEmail)} vise le compte ${masque(u.email)}`);
    }
    for (const u of a) {
      const n = f.filter((x) => x.userId === u.id).length;
      if (n !== 1) ecarts.push(`${w.subdomain} : accès ${masque(u.email)}, ${n} fiche(s)`);
    }
  }
  console.log(
    `FICHES_${ecarts.length ? 'KO' : 'OK'} ${espaces.length} espace(s), ${acces} accès, ${fiches} fiche(s), ${ecarts.length} écart(s)`,
  );
  for (const e of ecarts) console.log('  ' + e);
  await c.end();
  process.exit(ecarts.length ? 1 : 0);
})().catch((e) => {
  console.log('FICHES_NON_ABOUTI ' + e.message.slice(0, 120));
  process.exit(2);
});
