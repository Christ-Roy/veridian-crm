# Un membre retiré par le Hub fermait l'espace aux autres (VER-203)

Mesuré le 23/11/2026 sur staging : `removeMember` et `cutAccess` supprimaient l'appartenance en douceur et laissaient la
fiche `workspaceMember`. `currentUser.workspaceMembers` échoue alors (« UserEntity workspace not found ») et l'écran de
tous les autres membres reste sur « Welcome ». Prod à la même heure : 6 espaces, 0 orpheline.

Correctif `a0965d8288` : fiche et appartenance partent ensemble en suppression douce, `attach-member` restaure la fiche,
`remove-member` rejoué répare. Tranché avec la session Hub (§5.19.2, §5.20 inchangés).

Preuves : `retrait-membre.veridian.spec.ts`, sabotages de `mutations-connexion.sh`, `preuve-retrait-membre.py` (code 1 sur
l'ancienne image, espace jetable), `membres-orphelins.sh` (code 1 sur staging, 0 sur prod).

Servi : staging 03:26Z (six fiches réparées, cas 16 du Hub code 0, sabotage code 1), prod v30 03:36Z (retrait réel dans
`innovative-mint-penguin`, 0 orpheline avant et après, écran de l'autre membre vu). Reste : le Hub lève son fusible.
