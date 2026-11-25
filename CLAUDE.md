# CLAUDE.md : Veridian CRM

Fork de `twentyhq/twenty`, base `twenty/v2.56.1`. Directives techniques de l'amont (Nx, tests, conventions) :
`CLAUDE-TWENTY.md`. Ce fichier prime en cas de conflit. Ce qui diffère de l'amont : `VERIDIAN-PATCHES.md`.

## 1. Vision

- **On ne modifie plus ce fork** (Robert, 18/11/2026), sauf exception justifiée et listée dans le catalogue
  `veridian-crm-apps/docs/CATALOGUE.md` (auth Hub, gating, rebrand du bundle). Tout le reste est un plugin du dépôt
  `Veridian-site/veridian-crm-apps` (standard dans son `CLAUDE.md`) ou un réglage par l'API. Tout écart avec l'amont
  figure dans `VERIDIAN-PATCHES.md`, sinon c'est une anomalie.
- **Le Hub, seule source des utilisateurs** (Robert, 06/11/2026). Twenty n'a ni inscription, ni mot de passe client, ni double authentification locale,
  ni changement d'email ou de nom hors Hub, ni invitation interne. Les tables `core` sont des copies alimentées par
  `core-modules/veridian-hub-sso/`, identifiées par `hub_user_id` (= `hub_app.users.supabase_user_id`). Le contrat
  est `veridian-hub/docs/CONTRAT-HUB.md` (§3.8, §5, §6bis.8.0) : c'est lui qui fait foi. Pas de base commune, pas d'OIDC.
- **Rien ne sort sans décision.** Télémétrie, enrichissement, logos, iframes tierces, marketplace : coupés, et
  prouvés par capture réseau et navigateur (`VERIDIAN-PATCHES.md`). Un nouveau canal amont est une anomalie.
- **Staging d'abord, puis prod.** Staging : `crm.staging.veridian.site`, privé au tailnet. Prod depuis le 08/11/2026 : `crm.app.veridian.site` sur `ovh-prod`, job `crm` sur la grappe `pg-saas` depuis le 09/11/2026, branchée au Hub de prod. `main` = `staging` à chaque mise en prod.

**Décisions (07/11/2026) :** pas de migration, archive `~/veridian/archives/crm-decommission-2026-09-23/` intacte, base neuve ;
marque « Veridian CRM » sur les seules chaînes visibles, au chargement du catalogue (pas de renommage interne, `.po` intacts), logo du Hub,
mention « Basé sur Twenty, AGPL » ; domaine `crm.app.veridian.site`.

**Décisions (08/11/2026) :** le plan vient du Hub par `POST /api/tenants/update-plan` (CONTRAT-BILLING v2 §3), stocké
sur le lien tenant avec `trial_status` et `trial_ends_at`, relus par `by-email` ; rien n'est limité ni mis en lecture seule
(PRICING-VERIDIAN, décision de Robert pour lever un drapeau).
Aucun fournisseur IA tiers (Robert) : `VERIDIAN_AI_DISABLED=true` coupe l'IA, MCP reste.
L'espace d'un compte prouvé se crée à la **première ouverture** depuis le Hub (Robert : « ça ne crée pas de compte »),
ou par `hub app-access … --app twenty` : les deux passent par `ensureCrmWorkspace` du Hub (provisioning signé,
`metadata.crm` pour reconcile, nom du Hub poussé).
**Accès agent, espaces jetables, plugins :** skill `twenty-cli` (`twenty-admin`), clés jamais affichées.
**Coupé (parente, 08/11/2026) :** e-mailing de Twenty (Notifuse fait foi), console Logs (pas de ClickHouse, voulu),
code client hors liste blanche (fonctions d'app : seuls les couples `VERIDIAN_LOGIC_FUNCTION_ALLOW`, ROB-235 ; exécuteur isolé ROB-237), installation d'app hors couples `VERIDIAN_APP_INSTALL_ALLOW` (VER-173, jetable refusé), réglages en base.

## 1bis. Le natif v2.56.1, à utiliser avant d'écrire (inventaire du 08/11/2026)

| Brique | Natif | Licence | Usage Veridian |
|---|---|---|---|
| Clés API | `createApiKey(name, expiresAt, roleId)` + `generateApiKeyToken` (`/metadata`), REST `rest/metadata/apiKeys` ; une clé porte un rôle, `getApiKeyRoles` liste les assignables (rôle standard `Admin`) | AGPL | accès agent : rôle Admin. La commande `workspace:generate-api-key` refuse hors dev/test |
| Webhooks | `createWebhook(targetUrl, operations, secret, roleId)`, signature HMAC SHA-256 du corps, filtrés par rôle ; sortie par `SecureHttpClient` (SSRF : privé bloqué sauf `OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS`) | AGPL | accès agent |
| API | REST `/rest/*`, GraphQL `/graphql` et `/metadata`, sur l'hôte du workspace ou le domaine nu avec une clé | AGPL | |
| MCP | `POST /mcp` (JSON-RPC, clé API ou OAuth), outils CRM ; page Paramètres > AI > MCP | AGPL | agent externe sans fournisseur IA chez nous ; la porte MCP du Hub y entre avec son JWT (`veridian-hub-mcp/`, CONTRAT-MCP) |
| Serveur OAuth | `/.well-known/oauth-authorization-server`, `/oauth/register` (enregistrement dynamique), `/oauth/token` | AGPL | piste du Hub registre OAuth (Academy) |
| CLI `twenty` (npm `twenty@2.56.0`, MIT) | `auth login --with-token` par stdin, `TWENTY_API_URL` + `TWENTY_API_KEY`, `api rest|graphql`, `metadata`, `data`, `app *` ; ne crée pas de clé | MIT | installé dans `~/.local/twenty-cli`, lancé par `~/bin/twenty` |
| SDK (`twenty-sdk`, `twenty-client-sdk`) | apps : objets, fonctions, composants front ; publiées au registre privé puis installées par espace | MIT | plugins Veridian : dépôt privé `Veridian-site/veridian-crm-apps` (Dossiers, Google Meet, Téléphonie, `twenty-admin app:install`) ; ici seule l'app Android `packages/twenty-apps/veridian/telephonie/android` |
| IA | chat, agents, compétences, actions IA des workflows, derrière le drapeau `AI` ; fournisseurs d'instance (`AI_PROVIDERS`) | AGPL | seul fournisseur « veridian » (Hub), identité signée par appel (VER-203) |
| Workflows | déclencheurs, actions données, HTTP, email (driver), code | AGPL | email inerte (`EMAIL_DRIVER=logger`) |
| Facturation | Stripe, plans, crédits, `usage-limit` : 211 fichiers Enterprise | EE | inutilisable : `IS_BILLING_ENABLED=false`, aucune limite appliquée sans elle |
| SSO OIDC/SAML | module `sso` | EE | interdit ; le rebond Hub le remplace |
| Workspaces | multi-workspace par sous-domaine, provisioning par nos routes Hub | AGPL | |

**Plans :** référence `veridian-hub/docs/PRICING-VERIDIAN.md` : générosité maximale, aucune limite, aucun écran de
facturation. Plan et source dans `core.keyValuePair` (lien tenant) ; `update-plan` n'accepte que l'enum canonique,
le provisioning garde aussi les anciens noms.

## 2. Licence : ligne rouge

Chaque fichier `/* @license Enterprise */` (685 en v2.56.1) est sous licence commerciale :

- ne jamais le modifier, ni le copier, ni le lire pour s'en inspirer ; ne jamais patcher `enterprisePlanService.isValid()` ;
- une fonction Enterprise voulue se réécrit en clean-room, dans un fichier neuf ;
- aucune clé Enterprise, aucun achat sans l'accord de Robert.

`scripts/ci/check-ee-integrity.sh` le vérifie au push et en CI. La limite de workspaces vit dans un fichier AGPL et se
patche légalement. AGPL : le code du fork reste public, le copyright d'origine reste dans les fichiers, le fork le dit.

## 3. Travailler dans ce dépôt

- Trunk sur `staging`, pas de PR.
- Tickets : `todo/AAAA-MM-JJ-<sujet>.md`.
- `docs/spec/` : notes de mai 2026 (base légale : `AUDIT-LIMITE-EE-TWENTY.md`).
- Paquets modifiés : `twenty-server`, `twenty-front`, `twenty-shared`.
- Base de données : pas de table Veridian, les liens Hub vivent dans `core.keyValuePair`.

## 4. Tests : ce qui prouve

| Commande | Prouve | Vue échouer |
|---|---|---|
| `scripts/ci/check-ee-integrity.sh` | aucun fichier Enterprise touché | fichier modifié, code 1 |
| `scripts/ci/patch-survival.sh` (`--statique` au pre-push) | chaque patch présent, `*.veridian.spec.ts` | limite remise à 5, code 1 |
| `scripts/ci/mutations-connexion.sh` (CI) | connexion automatique §6bis.8.0, boucle du domaine nu, garde d'identité, marque : chaque comportement retiré casse la spec | à chaque CI |
| `HUB_API_SECRET=… scripts/ci/parcours-staging.py <url> <dossier> <n>` | identité, rebond, connexion, déconnexion, navigateur sans hôte tiers, écrans sans action réservée au Hub ni nom amont | oui, plusieurs fois |
| `HUB_API_SECRET=… scripts/ci/charge-staging.py <url> [n] [s]` | latence et débit par palier | mesure |
| `scripts/ci/preuve-mcp-role.py` | rôle restreint tenu sur `/mcp` | `--sabotage`, code 1 (23/11) |
| `scripts/ci/preuve-retrait-membre.py`, `membres-orphelins.sh [job]` | un membre retiré n'enferme pas les autres | ancienne version, code 1 (23/11) |
| `twenty-admin [--env prod] agent:preuve <ws> --email <membre>` (skill `twenty-cli`) | accès agent natif : clé Admin, appel REST, webhook `company.created` signé reçu par tunnel public, révocation | secret faussé, code 1 (08/11/2026) |
| `scripts/ci/preuve-app-deleguee.py`, `preuve-reponse-mail.py` (jetable) | app posée au premier jeton d'action, réponse Mail sans membre | 25/11, clés du Hub injoignables |
| `scripts/ci/preuve-organisation.py`, `-suspension.py`, `-suspension-deploiement.py`, `-identite.py` (jetables) | document du Hub (VER-252), suspension dans tous les processus (VER-254, réponse en 2 s), personne = `hub_user_id` | sabotages CI |
| `scripts/ci/preuve-redemarrage-redis.py` (jetable) | Redis redémarré sans perte, coupure vue | 25/11, `--sabotage` ; prod 0 raté |
| `scripts/ci/admins-instance.py <env>`, `preuve-admins.py` (staging) | administrateurs d'instance = `HUB_SERVER_ADMIN_HUB_USER_IDS`, jamais l'adresse | 25/11, codes 1 et 2 |
| `scripts/ci/preuve-installation-app.py` | garde d'installation (VER-173) | jetable (22/11) |
| `scripts/ci/capture-sortante.sh <conteneur crm-postgres> <secondes>` (sur le nœud) | silence réseau, témoin compris | image officielle ; IP directe, code 1 |

Codes : 0 vrai, 1 faux, 2 non abouti. Parcours de prod : `scripts/ci/parcours-node02.sh <dossier>` (Chromium sur node02, secret par stdin).

Avec `lourd`, `dist` est effacé à chaque copie : `nx run twenty-shared:build` avant toute spec.

Lire la session (hôte du workspace) : `POST /metadata`, `credentials: 'include'`, `x-twenty-session-cookie: 1`.

## 5. Construire et déployer

- **Image : par la CI**, `.github/workflows/veridian-crm-ci.yaml`, sur nos runners : garde légale, patch-survival, image
  `ghcr.io/christ-roy/veridian-crm:<branche>-<sha7>`. Hors CI : règle
  Machines de la plateforme.
- **Ne déployer qu'un run vert EN ENTIER** : depuis le 24/11 l'image se construit en parallèle des tests, sa présence au registre ne prouve rien.
- `[skip ci]` dans un commit qui ne touche pas le produit. Un push normal annule la CI en cours sur la branche.
- **Déployer :** tag dans `deploy/crm-staging.nomad.hcl` (source déclarée dans `~/nomad-veridian/jobs/SOURCES.tsv`), commit,
  push sur `staging`, puis `echo oui | timeout 280 nomad-v deploy deploy/crm-staging.nomad.hcl`. Le garde anti-recul refuse
  tant que le commit n'est pas sur la branche distante.
- **Piège :** `nomad-v` attend une confirmation et garde le verrou global pendant ce temps. Toujours `echo oui |` et un
  `timeout`.
- **Job prod `crm` : seule source vivante `deploy/crm-prod.nomad.hcl`** (`SOURCES.tsv` ; `nomad-veridian` n'en a qu'une
  archive). Tronc `staging` ; le garde lit `origin/main` pour la prod : avancer `main` sur `staging` (ff) avant de déployer.
- **Prod :** base sur la grappe `pg-saas` (Patroni, entrée `172.26.64.1:15432`, base `twenty`, sauvegarde de la grappe) ; Job `crm` : groupe `redis`, groupe `stack` (serveur, prestart qui attend base et Redis) en canari
  sans `canary_tags`, santé active Traefik, `shutdown_delay` 30 s ; groupe `worker` hors canari. Réservations
  données par `infra` (non reprenable mesuré + 30 à 50 %, plafond = pointe × 1,5). Jamais de base sur `rise`.
- **pg-saas :** budget 24 connexions (pool 8 serveur, 4 worker) ; check Nomad `base` sans redémarrage ; santé Traefik 3 s.
- **Piège (08/11/2026) :** derrière Traefik par le tailnet, `TRUST_PROXY` doit inclure `100.64.0.0/10`, sinon Twenty se croit en
  http et refuse le cookie de session : le rebond du Hub finit sur la page de connexion. Le parcours le vérifie.
- **AGPL :** `scripts/agpl/publier-source.sh <commit>` avant chaque image de prod (`--essai` pour voir sans pousser).
- **Piège IA (23/11) :** changer `VERIDIAN_AI_DISABLED` exige `scripts/ci/invalider-cache-roles.sh <job>` (cache Redis des rôles figé).
- Après un sync amont, rejouer `scripts/ci/marque.sh <icon.svg du Hub>`.

## 6. Sync amont

Procédure dans `VERIDIAN-PATCHES.md`. Après un sync, supprimer les workflows amont réapparus (aucun runner GitHub hébergé).
