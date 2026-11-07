# CLAUDE.md : Veridian CRM

Fork de `twentyhq/twenty`, base `twenty/v2.56.1`. Directives techniques de l'amont (Nx, tests, conventions) :
`CLAUDE-TWENTY.md`. Ce fichier prime en cas de conflit. Ce qui diffère de l'amont : `VERIDIAN-PATCHES.md`.

## 1. Vision

- **Le plus petit fork qui tient.** Tout écart avec l'amont figure dans `VERIDIAN-PATCHES.md`, sinon c'est une
  anomalie. Du code neuf dans `veridian-*`, de la variable d'environnement d'abord, du patch amont en dernier.
  Une fonction Veridian retirée reste dans l'historique git (`git log --first-parent`).
- **Le Hub, seule source des utilisateurs** (Robert, 06/11/2026). Twenty n'a ni inscription, ni mot de passe client,
  ni changement d'email ou de nom hors Hub, ni invitation interne. Les tables `core` sont des copies alimentées par
  `core-modules/veridian-hub-sso/`, identifiées par `hub_user_id` (= `hub_app.users.supabase_user_id`). Le contrat
  est `veridian-hub/docs/CONTRAT-HUB.md` (§3.8, §5, §6bis.8.0) : c'est lui qui fait foi. Pas de base commune, pas d'OIDC.
- **Rien ne sort sans décision.** Télémétrie, enrichissement, logos, iframes tierces, marketplace : coupés, et
  prouvés par capture réseau et navigateur (`VERIDIAN-PATCHES.md`). Un nouveau canal amont est une anomalie.
- **Staging d'abord.** La prod attend les serveurs. Staging : `crm.staging.veridian.site`, privé au tailnet, base neuve.

**Décisions ouvertes, à Robert :** migrer ou non le workspace « Veridian » de l'archive
`~/veridian/archives/crm-decommission-2026-09-23/` (base en 2.13, saut jamais testé, reco : ne pas migrer sans usage
décidé) ; nom et image du fork avant toute prod (`.github/TRADEMARK.md` l'impose à un fork exploité publiquement).

## 2. Licence : ligne rouge

Chaque fichier `/* @license Enterprise */` (685 en v2.56.1) est sous licence commerciale :

- ne jamais le modifier, ni le copier, ni le lire pour s'en inspirer ; ne jamais patcher `enterprisePlanService.isValid()` ;
- une fonction Enterprise voulue se réécrit en clean-room, dans un fichier neuf ;
- aucune clé Enterprise, aucun achat sans l'accord de Robert.

`scripts/ci/check-ee-integrity.sh` le vérifie au push et en CI. La limite de workspaces vit dans un fichier AGPL et se
patche légalement. AGPL : le code du fork reste public, le copyright d'origine reste dans les fichiers, le fork le dit.

## 3. Travailler dans ce dépôt

- Trunk sur `staging`, pas de PR. Promotion vers `main` quand la prod existera.
- Tu touches ce dépôt seul. Un correctif ailleurs : ticket dans le `todo/` du dépôt cible, et signale-le.
- Tickets : `todo/AAAA-MM-JJ-<sujet>.md`.
- `docs/spec/` : notes de mai 2026, base légale incluse (`AUDIT-LIMITE-EE-TWENTY.md`). Ce fichier prime sur elles.
- Paquets modifiés : `twenty-server`, `twenty-front`, `twenty-shared`. Les autres restent ceux de l'amont.
- Base de données : pas de table Veridian, les liens Hub vivent dans `core.keyValuePair`.

## 4. Tests : ce qui prouve

| Commande | Prouve | Vue échouer |
|---|---|---|
| `scripts/ci/check-ee-integrity.sh` | aucun fichier Enterprise touché | fichier modifié, code 1 |
| `scripts/ci/patch-survival.sh` (`--statique` au pre-push) | chaque patch présent, `*.veridian.spec.ts` | limite remise à 5, code 1 |
| `HUB_API_SECRET=… scripts/ci/parcours-staging.py <url> <dossier> <n>` | identité, rebond, connexion, déconnexion, navigateur sans hôte tiers | oui, plusieurs fois |
| `scripts/ci/capture-sortante.sh <conteneur crm-postgres> <secondes>` (sur le nœud) | silence réseau, témoin compris | image officielle ; IP directe, code 1 |

Codes : 0 vrai, 1 faux, 2 mesure non aboutie. Le secret : `CRM_HUB_API_SECRET_STAGING` dans `.all-creds.env`.
Le parcours crée et retire son compte de test ; une capture couvre le démarrage seulement si elle démarre avant lui.

Lecture d'une session depuis le navigateur, sur l'hôte du workspace (cookie `__Host-twenty-session`, pas de jeton
en localStorage) : `POST /metadata`, `credentials: 'include'`, en-tête `x-twenty-session-cookie: 1`, `{currentUser{email}}`.

## 5. Construire et déployer

- **Image : par la CI**, `.github/workflows/veridian-crm-ci.yaml`, sur nos runners : garde légale, patch-survival, image
  `ghcr.io/christ-roy/veridian-crm:<branche>-<sha7>`. Compter près de 3 h (1 cœur réservé sur le runner). Pas de
  `docker build` direct sur un nœud (règle de la plateforme, 07/11/2026) : hors CI, `lourd.sh` en `nice -n 19` sur un nœud libre.
- `[skip ci]` dans un commit qui ne touche pas le produit. Un push normal annule la CI en cours sur la branche.
- **Déployer :** tag dans `deploy/crm-staging.nomad.hcl` (source déclarée dans `~/nomad-veridian/jobs/SOURCES.tsv`), commit,
  push sur `staging`, puis `echo oui | timeout 280 nomad-v deploy deploy/crm-staging.nomad.hcl`. Le garde anti-recul refuse
  tant que le commit n'est pas sur la branche distante.
- **Piège :** `nomad-v` attend une confirmation et garde le verrou global pendant ce temps. Toujours `echo oui |` et un
  `timeout` (`restart-task` lancé sans le faire : écritures Nomad du parc bloquées 83 min le 07/11/2026).
- Démarrage lent : chaque étape d'entrée recharge Nest. Environ 2 min au calme, plus de 20 min sur un nœud saturé.
- Mémoire de pointe mesurée : serveur 1,2 Go, worker 1 Go, Postgres 170 Mo, Redis 140 Mo.

## 6. Sync amont

Procédure dans `VERIDIAN-PATCHES.md`. Après un sync, supprimer les workflows amont réapparus (aucun runner GitHub hébergé).
