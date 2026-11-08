# CLAUDE.md : Veridian CRM

Fork de `twentyhq/twenty`, base `twenty/v2.56.1`. Directives techniques de l'amont (Nx, tests, conventions) :
`CLAUDE-TWENTY.md`. Ce fichier prime en cas de conflit. Ce qui diffère de l'amont : `VERIDIAN-PATCHES.md`.

## 1. Vision

- **Le plus petit fork qui tient.** Tout écart avec l'amont figure dans `VERIDIAN-PATCHES.md`, sinon c'est une
  anomalie. Du code neuf dans `veridian-*`, de la variable d'environnement d'abord, du patch amont en dernier.
  Une fonction Veridian retirée reste dans l'historique git (`git log --first-parent`).
- **Le Hub, seule source des utilisateurs** (Robert, 06/11/2026). Twenty n'a ni inscription, ni mot de passe client, ni double authentification locale,
  ni changement d'email ou de nom hors Hub, ni invitation interne. Les tables `core` sont des copies alimentées par
  `core-modules/veridian-hub-sso/`, identifiées par `hub_user_id` (= `hub_app.users.supabase_user_id`). Le contrat
  est `veridian-hub/docs/CONTRAT-HUB.md` (§3.8, §5, §6bis.8.0) : c'est lui qui fait foi. Pas de base commune, pas d'OIDC.
- **Rien ne sort sans décision.** Télémétrie, enrichissement, logos, iframes tierces, marketplace : coupés, et
  prouvés par capture réseau et navigateur (`VERIDIAN-PATCHES.md`). Un nouveau canal amont est une anomalie.
- **Staging d'abord.** Staging : `crm.staging.veridian.site`, privé au tailnet, base neuve. Prod préparée, non déployée : `deploy/crm-db.nomad.hcl` et `deploy/crm-prod.nomad.hcl`, nœud et moment donnés par `infra`. La reprise se fait depuis `todo/2026-11-07-passage-prod.md`.

**Décisions (07/11/2026) :** pas de migration, archive `~/veridian/archives/crm-decommission-2026-09-23/` intacte, base neuve ;
marque « Veridian CRM » sur les seules chaînes visibles, au chargement du catalogue (pas de renommage interne, `.po` intacts), logo du Hub,
mention « Basé sur Twenty, AGPL » ; domaine `crm.app.veridian.site`. Reste avant prod : `todo/2026-11-07-passage-prod.md`.

**Décisions (08/11/2026, parente) :** Twenty est une app `client_only` tant que le Hub n'a pas de plan CRM : pas
d'`update-plan` ni de Stripe, le plan reçu est gardé sans effet. Aucun fournisseur IA (Robert) : `VERIDIAN_AI_DISABLED=true`
refuse le drapeau `AI` à tout rôle, MCP reste. Un espace se crée par l'activation de `twenty` au Hub (`app-access`),
qui appelle `/api/tenants/provision` ; l'ancienne intégration du Hub (mot de passe et Bearer chiffrés) est retirée.
**Accès agent :** skill `twenty-cli` : `twenty-admin agent:grant` (clé rôle Admin + webhook, rangés dans `~/credentials`,
jamais affichés), usage par le CLI natif `twenty` (`twenty-admin run <ws> -- …`).

## 1bis. Le natif v2.56.1, à utiliser avant d'écrire (inventaire du 08/11/2026)

| Brique | Natif | Licence | Usage Veridian |
|---|---|---|---|
| Clés API | `createApiKey(name, expiresAt, roleId)` + `generateApiKeyToken` (`/metadata`), REST `rest/metadata/apiKeys` ; une clé porte un rôle, `getApiKeyRoles` liste les assignables (rôle standard `Admin`) | AGPL | accès agent : rôle Admin. La commande `workspace:generate-api-key` refuse hors dev/test |
| Webhooks | `createWebhook(targetUrl, operations, secret, roleId)`, signature HMAC SHA-256 du corps, filtrés par rôle ; sortie par `SecureHttpClient` (SSRF : privé bloqué sauf `OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS`) | AGPL | accès agent |
| API | REST `/rest/*`, GraphQL `/graphql` et `/metadata`, sur l'hôte du workspace ou le domaine nu avec une clé | AGPL | |
| MCP | `POST /mcp` (JSON-RPC, clé API ou OAuth), outils CRM ; page Paramètres > AI > MCP | AGPL | agent externe sans fournisseur IA chez nous |
| Serveur OAuth | `/.well-known/oauth-authorization-server`, `/oauth/register` (enregistrement dynamique), `/oauth/token` | AGPL | piste du Hub registre OAuth (Academy) |
| CLI `twenty` (npm `twenty@2.56.0`, MIT) | `auth login --with-token` par stdin, `TWENTY_API_URL` + `TWENTY_API_KEY`, `api rest|graphql`, `metadata`, `data`, `app *` ; ne crée pas de clé | MIT | installé dans `~/.local/twenty-cli`, lancé par `~/bin/twenty` |
| SDK (`twenty-sdk`, `twenty-client-sdk`) | apps : objets, fonctions, composants front, déployés par `twenty app apply` | MIT | pas d'app Veridian à ce jour |
| IA | chat, agents, compétences, actions IA des workflows, tout derrière le drapeau de permission `AI` ; fournisseurs par clés d'env | AGPL | aucun fournisseur : drapeau `AI` forcé à faux (`VERIDIAN_AI_DISABLED`) |
| Workflows | déclencheurs, actions données, HTTP, email (driver), code | AGPL | email inerte (`EMAIL_DRIVER=logger`) |
| Facturation | Stripe, plans, crédits, `usage-limit` : 211 fichiers Enterprise | EE | inutilisable : `IS_BILLING_ENABLED=false`, aucune limite appliquée sans elle |
| SSO OIDC/SAML | module `sso` | EE | interdit ; le rebond Hub le remplace |
| Workspaces | multi-workspace par sous-domaine, provisioning par nos routes Hub | AGPL | |

**Plans :** référence `veridian-hub/docs/PRICING-VERIDIAN.md` : générosité maximale, aucune limite appliquée, aucun
écran de facturation. Le plan reçu du Hub est gardé dans `core.keyValuePair` (`free`, `freemium`, `starter`, `pro`,
`business`, `enterprise`, `lifetime_site_vitrine`, `lifetime_partner`, `internal`), sans effet dans l'app.

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
| `scripts/ci/mutations-connexion.sh` (CI) | connexion automatique §6bis.8.0, boucle du domaine nu, garde d'identité, marque : chaque comportement retiré casse la spec | à chaque CI |
| `HUB_API_SECRET=… scripts/ci/parcours-staging.py <url> <dossier> <n>` | identité, rebond, connexion, déconnexion, navigateur sans hôte tiers, écrans sans action réservée au Hub ni nom amont | oui, plusieurs fois |
| `HUB_API_SECRET=… scripts/ci/charge-staging.py <url> [n] [s]` | latence et débit par palier, espace jetable | mesure, à rejouer sur le nœud de prod |
| `twenty-admin [--env prod] agent:preuve <ws> --email <membre>` (skill `twenty-cli`) | accès agent natif : clé Admin, appel REST, webhook `company.created` signé reçu par tunnel public, révocation | secret faussé, code 1 (08/11/2026) |
| `scripts/ci/capture-sortante.sh <conteneur crm-postgres> <secondes>` (sur le nœud) | silence réseau, témoin compris | image officielle ; IP directe, code 1 |

Codes : 0 vrai, 1 faux, 2 mesure non aboutie. Le secret : `CRM_HUB_API_SECRET_STAGING` dans `.all-creds.env`.
Le parcours crée et retire son compte de test ; une capture couvre le démarrage seulement si elle démarre avant lui.

Avec `lourd`, `dist` est effacé à chaque copie : `nx run twenty-shared:build` avant toute spec.

Lecture d'une session depuis le navigateur, sur l'hôte du workspace (cookie `__Host-twenty-session`, pas de jeton
en localStorage) : `POST /metadata`, `credentials: 'include'`, en-tête `x-twenty-session-cookie: 1`, `{currentUser{email}}`.

## 5. Construire et déployer

- **Image : par la CI**, `.github/workflows/veridian-crm-ci.yaml`, sur nos runners : garde légale, patch-survival, image
  `ghcr.io/christ-roy/veridian-crm:<branche>-<sha7>`. Durée mesurée : 13 min le 07/11/2026, 2 h 48 la veille sur un runner plus bridé ; le relevé de la CI fait foi. Pas de
  `docker build` direct sur un nœud (règle de la plateforme, 07/11/2026) : hors CI, `lourd.sh` en `nice -n 19` sur un nœud libre.
- `[skip ci]` dans un commit qui ne touche pas le produit. Un push normal annule la CI en cours sur la branche.
- **Déployer :** tag dans `deploy/crm-staging.nomad.hcl` (source déclarée dans `~/nomad-veridian/jobs/SOURCES.tsv`), commit,
  push sur `staging`, puis `echo oui | timeout 280 nomad-v deploy deploy/crm-staging.nomad.hcl`. Le garde anti-recul refuse
  tant que le commit n'est pas sur la branche distante.
- **Piège :** `nomad-v` attend une confirmation et garde le verrou global pendant ce temps. Toujours `echo oui |` et un
  `timeout` (`restart-task` lancé sans le faire : écritures Nomad du parc bloquées 83 min le 07/11/2026).
- Démarrage lent : chaque étape d'entrée recharge Nest. Environ 2 min au calme, plus de 20 min sur un nœud saturé.
- **Prod :** `crm-db` (Postgres, Redis, pgBackRest, job séparé) puis `crm` : groupe `stack` (serveur) en canari
  sans `canary_tags`, santé active Traefik, `shutdown_delay` 30 s ; groupe `worker` hors canari. Réservations
  données par `infra` (non reprenable mesuré + 30 à 50 %, plafond = pointe × 1,5). Jamais de base sur `rise`.
- **AGPL :** `scripts/agpl/publier-source.sh <commit>` avant chaque image de prod (`--essai` pour voir sans pousser).
- Capacité mesurée : `todo/2026-11-07-passage-prod.md`. Après un sync amont, rejouer `scripts/ci/marque.sh <icon.svg du Hub>`.

## 6. Sync amont

Procédure dans `VERIDIAN-PATCHES.md`. Après un sync, supprimer les workflows amont réapparus (aucun runner GitHub hébergé).
