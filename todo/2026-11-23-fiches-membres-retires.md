# Un membre retiré par le Hub garde sa fiche dans l'espace

Mesuré le 23/11/2026 sur staging (`cheerful-yellow-zebra`, VER-203) : après `remove-member` puis
`users/sync {deleted: true}`, le compte est coupé (absent de `GET /api/hub/users`, rebond refusé), mais sa fiche
`workspaceMember` reste visible, et une fiche reste listée sous le rôle `Member`.

Cause : `VeridianHubSsoService.removeMember` et `cutAccess` appellent `deleteUserWorkspace({ softDelete: true })`, qui ne
touche ni `workspaceMember` ni `roleTarget`. Le retrait natif (`deleteUserFromWorkspace`) transfère aussi les comptes
connectés et les partages : c'est lui qui fait le travail complet. Par l'API, `deleteWorkspaceMember` le refuse et renvoie à lui.

Effet : un ancien collaborateur reste proposable comme responsable d'une fiche. Aucun accès rouvert.

Restes à retirer après décision : `e2e-sso-mwsnpav0743e-role-mcp`, `e2e-sso-mwsnr8mc2b43-role-mcp`,
`e2e-sso-mwsnxk653889-role-mcp` (`@veridian.site`). Le cas 16 du Hub en ajoute une par passage.

À trancher : le retrait par le Hub doit-il passer par le chemin natif complet ? Code du fork (module AGPL `veridian-hub-sso`).
