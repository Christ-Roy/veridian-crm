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

**Décisions (07/11/2026) :** base neuve (archive `~/veridian/archives/crm-decommission-2026-09-23/`) ; marque « Veridian CRM »
(calque au build, `.po` intacts), logo du Hub, mention « Basé sur Twenty, AGPL ».

**Décisions (08/11/2026) :** le plan vient du Hub par `POST /api/tenants/update-plan` (CONTRAT-BILLING v2 §3), stocké
sur le lien tenant avec `trial_status` et `trial_ends_at`, relus par `by-email` ; rien n'est limité ni mis en lecture seule
(PRICING-VERIDIAN, décision de Robert pour lever un drapeau).
Aucun fournisseur IA tiers (Robert) : `VERIDIAN_AI_DISABLED=true` coupe l'IA, MCP reste.
L'espace d'un compte prouvé se crée à la **première ouverture** depuis le Hub, ou par `hub app-access … --app twenty`,
tous deux par `ensureCrmWorkspace` du Hub (provisioning signé). Une signature du Hub ne sert qu'une fois.
**Dépôt public** : ni adresse, ni liste de failles (rapports : `~/.claude/releves/crm-*.md`).
**Impersonate natif :** refusé entre espaces et muet (pas de ClickHouse) : passer par `hub open` ; sous emprunt, rien qui survive (26/11).
**Accès agent, jetables, plugins :** skill `twenty-cli`, clés jamais affichées.
**Coupé (parente, 08/11/2026) :** e-mailing de Twenty (Notifuse fait foi), console Logs (pas de ClickHouse, voulu),
code client hors liste blanche (fonctions d'app : seuls les couples `VERIDIAN_LOGIC_FUNCTION_ALLOW`, ROB-235 ; exécuteur isolé ROB-237), installation d'app hors couples `VERIDIAN_APP_INSTALL_ALLOW` (VER-173) hors apps de base `VERIDIAN_BASE_APPS` (Liaisons, clients existants exclus), réglages en base.

## 1bis. Le natif v2.56.1, à utiliser avant d'écrire (inventaire du 08/11/2026)

| Brique | Natif | Licence | Usage Veridian |
|---|---|---|---|
| Clés API | `createApiKey(name, expiresAt, roleId)` + `generateApiKeyToken` (`/metadata`), REST `rest/metadata/apiKeys` ; une clé porte un rôle, `getApiKeyRoles` liste les assignables (rôle standard `Admin`) | AGPL | accès agent : rôle Admin. La commande `workspace:generate-api-key` refuse hors dev/test |
| Webhooks | `createWebhook(targetUrl, operations, secret, roleId)`, signature HMAC SHA-256 du corps, filtrés par rôle ; sortie par `SecureHttpClient` (SSRF : privé bloqué sauf `OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS`) | AGPL | accès agent |
| API | REST `/rest/*`, GraphQL `/graphql` et `/metadata`, sur l'hôte du workspace ou le domaine nu avec une clé | AGPL | |
| MCP | `POST /mcp` (JSON-RPC, clé API ou OAuth), outils CRM ; page Paramètres > AI > MCP | AGPL | agent externe sans fournisseur IA chez nous ; la porte MCP du Hub y entre avec son JWT (`veridian-hub-mcp/`, CONTRAT-MCP) |
| Serveur OAuth | `/.well-known/oauth-authorization-server`, `/oauth/register` (enregistrement dynamique), `/oauth/token` | AGPL | piste du Hub registre OAuth (Academy) |
| CLI `twenty` (npm `twenty@2.56.0`, MIT) | `auth login --with-token` par stdin, `TWENTY_API_URL` + `TWENTY_API_KEY`, `api rest|graphql`, `metadata`, `data`, `app *` | MIT | installé dans `~/.local/twenty-cli`, lancé par `~/bin/twenty` |
| SDK (`twenty-sdk`, `twenty-client-sdk`) | apps : objets, fonctions, composants front, registre privé puis installation par espace | MIT | plugins : dépôt privé `Veridian-site/veridian-crm-apps` (`twenty-admin app:install`) ; ici seule l'app Android de Téléphonie |
| IA | chat, agents, compétences, actions IA des workflows, derrière le drapeau `AI` ; fournisseurs d'instance (`AI_PROVIDERS`) | AGPL | seul fournisseur « veridian » (Hub), identité signée par appel (VER-203) |
| Workflows | déclencheurs, actions données, HTTP, email (driver), code | AGPL | email inerte (`EMAIL_DRIVER=logger`) |
| Facturation | Stripe, plans, crédits, `usage-limit` : 211 fichiers Enterprise | EE | inutilisable : `IS_BILLING_ENABLED=false`, aucune limite appliquée sans elle |
| SSO OIDC/SAML | module `sso` | EE | interdit ; le rebond Hub le remplace |
| Workspaces | multi-workspace par sous-domaine, provisioning par nos routes Hub | AGPL | |

**Plans :** référence `veridian-hub/docs/PRICING-VERIDIAN.md` : générosité maximale, aucune limite, aucun écran de
facturation.

## 2. Licence : ligne rouge

Chaque fichier `/* @license Enterprise */` (685 en v2.56.1) est sous licence commerciale :

- ne jamais le modifier, ni le copier, ni le lire pour s'en inspirer ; ne jamais patcher `enterprisePlanService.isValid()` ;
- une fonction Enterprise voulue se réécrit en clean-room, dans un fichier neuf ;
- aucune clé Enterprise, aucun achat sans l'accord de Robert.

`scripts/ci/check-ee-integrity.sh` le vérifie au push et en CI. La limite de workspaces vit dans un fichier AGPL et se
patche légalement. AGPL : le code du fork reste public, le copyright d'origine reste dans les fichiers, le fork le dit.

## 3. Travailler dans ce dépôt

- Trunk sur `staging`, pas de PR.
- `docs/spec/` : base légale `AUDIT-LIMITE-EE-TWENTY.md`.
- Base de données : pas de table Veridian, les liens Hub vivent dans `core.keyValuePair`.

## 4. Tests : ce qui prouve

| Commande | Prouve | Vue échouer |
|---|---|---|
| `check-ee-integrity.sh` | aucun fichier Enterprise touché | fichier modifié, code 1 |
| `patch-survival.sh` (`--statique` au pre-push) | chaque patch présent, `*.veridian.spec.ts` | limite remise à 5, code 1 |
| `scripts/ci/mutations-connexion.sh` (CI) | connexion automatique §6bis.8.0, domaine nu, garde d'identité, marque | à chaque CI |
| `HUB_API_SECRET=… scripts/ci/parcours-staging.py <url> <dossier> <n>` | identité, rebond, déconnexion, aucun hôte tiers, ni action réservée au Hub ni nom amont | oui |
| `charge-staging.py <url> [n] [s]` (secret par env.) | latence et débit par palier | mesure |
| `preuve-mcp-role.py` | rôle restreint tenu sur `/mcp` | `--sabotage` (23/11) |
| `preuve-retrait-membre.py`, `membres-orphelins.sh [job]` | un membre retiré n'enferme pas les autres | ancienne version (23/11) |
| `twenty-admin [--env prod] agent:preuve <ws> --email <membre>` | accès agent : clé Admin, REST, webhook signé reçu, révocation | secret faussé (08/11) |
| `scripts/ci/preuve-webhook-role.py <jetable>` | un webhook ne reçoit que ce que son rôle lit | `--sabotage`, code 1 (26/11) |
| `preuve-app-deleguee.py`, `preuve-reponse-mail.py` | app posée au premier jeton, réponse Mail sans membre | staging (26/11) |
| `scripts/ci/preuve-organisation.py`, `-suspension.py`, `-suspension-deploiement.py`, `-identite.py` (jetables) | organisation du Hub (VER-252), suspension partout (VER-254), personne = `hub_user_id` | sabotages CI |
| `preuve-redemarrage-redis.py` | Redis redémarré sans perte | `--sabotage` |
| `admins-instance.py <env>`, `preuve-admins.py` | admins d'instance = `HUB_SERVER_ADMIN_HUB_USER_IDS` | codes 1 et 2 (25/11) |
| `scripts/ci/preuve-emprunt.py <jetable>` | l'emprunt lit ; ni clé, jeton, code OAuth, webhook, ni app OAuth | 7d4af31, 0a0f5cf : code 1 (26/11) |
| `mutations-signature-unique.sh`, `preuve-rejeu-signature.py` | signature du Hub à usage unique, v2 liée à la route | sabotages, prod (26/11) |
| `preuve-cors.py`, `preuve-espace-public.py` | aucune origine étrangère en CORS ; sans session, le nom seul | prod (26/11) |
| `adresses-personnes.sh` (pre-push, CI) | aucune adresse de personne dans ce dépôt PUBLIC | trois cas, code 1 |
| `preuve-installation-app.py`, `preuve-apps-de-base.py` | garde d'installation (VER-173), Liaisons posée à la création | jetable, prod (26/11) |
| `scripts/ci/capture-sortante.sh <conteneur> <s>` (sur le nœud) | silence réseau, témoin compris | IP directe, code 1 |

Codes : 0 vrai, 1 faux, 2 non abouti. Parcours de prod : `scripts/ci/parcours-node02.sh <dossier>` (Chromium sur node02, secret par stdin).

Avec `lourd` : `nx run twenty-shared:build` avant toute spec. Session : `POST /metadata`, `credentials: 'include'`,
`x-twenty-session-cookie: 1`.

## 5. Construire et déployer

- **Image : par la CI**, `.github/workflows/veridian-crm-ci.yaml`, sur nos runners : garde légale, patch-survival, image
  `ghcr.io/christ-roy/veridian-crm:<branche>-<sha7>`. Hors CI : règle
  Machines de la plateforme.
- **Ne déployer qu'un run vert EN ENTIER** : depuis le 24/11 l'image se construit en parallèle des tests, sa présence au registre ne prouve rien.
- `[skip ci]` si le produit ne bouge pas : un push normal annule la CI en cours.
- **Déployer :** tag dans `deploy/crm-staging.nomad.hcl` (source déclarée dans `~/nomad-veridian/jobs/SOURCES.tsv`), commit,
  push sur `staging`, puis `echo oui | timeout 280 nomad-v deploy deploy/crm-staging.nomad.hcl`. Le garde anti-recul refuse
  tant que le commit n'est pas sur la branche distante.
- **Piège :** `nomad-v` attend une confirmation en gardant le verrou global : `echo oui |` et `timeout`.
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
