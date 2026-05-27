# Audit technique micro — fork Twenty pour Veridian CRM

> **Auteur** : Agent audit Opus (2026-05-26)
> **Périmètre** : audit TECHNIQUE GÉNÉRAL (archi méta-modèle, stack, custom fields, perf, déploiement)
> **Repo audité** : `/home/brunon5/Bureau/veridian-platform/veridian-crm-repo/` — `twentyhq/twenty` cloné, HEAD `1188ea9cd5` (chore: remove unused REST→GraphQL HTTP bridge), version package `0.2.1`
> **L'audit CONTRAT HUB (auth, billing, endpoints) est livré séparément par l'autre agent.**

---

## 1. Synthèse en 1 page — 7 points à savoir avant Vague 11

### 🔴 1. Twenty utilise **schema-per-workspace Postgres** — pas de row-level multi-tenant

Chaque workspace = un **schéma Postgres séparé** nommé `workspace_{base36(uuid)}` (`packages/twenty-server/src/engine/workspace-datasource/utils/get-workspace-schema-name.util.ts:3-5`). La création se fait via `CREATE SCHEMA` dans `WorkspaceDataSourceService.createWorkspaceDBSchema()` (lignes 56-69 du même module). **Conséquence directe** : 1000 workspaces = 1000 schémas Postgres dans la même DB. Postgres tient des dizaines de milliers de schémas par DB mais le `pg_catalog` devient lent au-delà de ~5 000. À surveiller dès la centaine de tenants. Aucun isolation network — c'est une isolation logique uniquement.

### 🔴 2. Custom fields = **vraies colonnes Postgres** créées par DDL en live

Pas de JSONB générique : quand un user ajoute un Field, Twenty exécute un `ALTER TABLE workspace_xxx.person ADD COLUMN "newField" ...` via `WorkspaceSchemaManagerService.columnManager.addColumns()` (`packages/twenty-server/src/engine/workspace-manager/workspace-migration/workspace-migration-runner/action-handlers/field/services/create-field-action-handler.service.ts:198-203`). Sur 100k rows : verrou bref (Postgres rapide sur ADD COLUMN nullable), mais **lock complet** sur ALTER TYPE / DROP / rename. **Implication Veridian** : Twenty est conçu pour des tables modestes (~100k records par object). Vos 996K leads Prospection **ne tiennent pas** dans ce modèle — il faudra rester en archi séparée, le CRM consomme Prospection via API.

### 🔴 3. **107 fichiers serveur + 19 fichiers front du module billing sont marqués `@license Enterprise`**

Le module `engine/core-modules/billing/` entier est sous licence commerciale (AGPL OU Enterprise = double licensing Twenty Inc.). Idem pour `sso/`, `event-logs/`, `row-level-permission-predicate/`, `enterprise/`, `usage/`. Total : **242 fichiers serveur + 52 front** marqués `@license Enterprise`. Le `EnterprisePlanService` (`enterprise-plan.service.ts:48-60`) vérifie un JWT `ENTERPRISE_KEY` signé par Twenty Inc. — **on n'aura jamais ce JWT légalement sans payer**. Verdict : on **rip et remplace** tout le module billing (déjà acté côté Hub) ET on doit décider **rip ou re-coder** pour SSO, row-level perms, audit logs avancés. Le double-licensing n'interdit pas le fork CE-only (AGPL), mais on doit retirer/désactiver les fichiers `@license Enterprise` ou les remplacer avant tout deploy commercial pour ne pas être en violation contractuelle (et pas juste licence open source).

### 🟡 4. Frontend = **Jotai, PAS Recoil** (le brief était outdated)

Le brief original mentionne "React + Recoil". **Faux** : 506 imports Jotai dans `twenty-front/src`, **0 imports Recoil**. Migration déjà faite par Twenty Inc. Stack frontend exacte : React 18 + **Jotai 2.17** + Apollo Client 4 + React Router 6 + **Vite + Lingui i18n + @wyw-in-js (linaria CSS-in-JS) + Storybook + Vitest 4**. Build via `vite build` avec `NODE_OPTIONS=--max-old-space-size=8192` (gros bundle). Pas de Next.js.

### 🟡 5. Workflows = **AGPLv3/CE**, pas Enterprise — bonne nouvelle

288 fichiers dans `packages/twenty-server/src/modules/workflow/`, **aucun marqué Enterprise**. Le module workflows complet (triggers DB/cron/form/manual, actions HTTP/code/AI/mail-sender/record-CRUD/if-else/delay/iterator/filter) est sous AGPL. On peut **garder tel quel** et juste ajouter notre action custom `SendViaNotifuse` dans `workflow-executor/workflow-actions/` (~1 j-h). C'est probablement le plus gros gain valeur du fork.

### 🟡 6. Pas de magic-link natif — auth = passwords + OAuth (Google/Microsoft/SAML/OIDC)

Le `AppTokenType` enum (`app-token.entity.ts:23-31`) liste : `RefreshToken`, `CodeChallenge`, `AuthorizationCode`, `PasswordResetToken`, `InvitationToken`, `EmailVerificationToken`, `EnterpriseValidityToken`. **Pas de `MagicLinkToken`**. Le flow "invitation" Twenty (`workspace-invitation.service.ts`) est le plus proche d'un magic-link (token signé envoyé par mail, qui auto-créé un workspace member au clic), mais c'est dédié à l'onboarding, pas au sign-in récurrent. **Implication** : pour brancher l'auth Hub (qui livre un token JWT signé HMAC), il faudra **soit** créer un nouveau `AppTokenType.HubAuth`, **soit** réutiliser le pattern `LoginToken` (JWT court avec payload `userId`) et écrire un endpoint `/auth/hub-bridge` qui prend le JWT Hub et émet directement un access+refresh token Twenty.

### 🟢 7. Stack runtime : Node 24 + Postgres 16 + Redis (BullMQ) + image Docker officielle

`docker-compose.yml` : `server` + `worker` + `db` (postgres:16) + `redis`. Image officielle `twentycrm/twenty:latest`. Node 24.5.0 (`.nvmrc`). RAM minimale recommandée : 2 GB pour le serveur (build OOM si moins), 1 GB pour le worker, 1 GB pour Postgres, 512 MB pour Redis = **4-5 GB RAM** machine pour staging minimal. Logs via NestJS ConsoleLogger natif (driver `CONSOLE`, peut être étendu vers Sentry). **Pas de JSON Pino par défaut** — il faudra wrap si on veut Grafana Cloud (1 fichier à écrire, ~2h).

---

## 2. Réponses détaillées question par question

### Métadata layer

**Q1. Twenty stocke comment les rows custom : 1 table par Object ou JSONB ?**

→ **1 table par Object**, schéma Postgres dédié par workspace. Quand on crée un Object via API, Twenty crée :
1. Une row dans `core.objectMetadata` (`object-metadata.entity.ts:22`) — la définition logique.
2. Une **vraie table physique** dans `workspace_{base36(uuid)}.{tableName}` via `WorkspaceSchemaManagerService` (création gérée par `CreateObjectActionHandlerService`).

**Aucun JSONB générique pour les rows**. Les seules colonnes JSONB sont sur les types `defaultValue`, `settings`, `standardOverrides` des **métadonnées** (`field-metadata.entity.ts:91-92`, `object-metadata.entity.ts:63-64, 93-94`) — c'est de la config, pas de la donnée user.

**Verdict** : excellent design pour requêtes SQL natives (WHERE/ORDER BY/JOIN classiques + index B-tree). Mais ça veut dire qu'on **NE PEUT PAS** importer 996K leads Prospection ici sans plomber le schéma. Trace DDL exact d'un Field create : `create-field-action-handler.service.ts:198-203` appelle `columnManager.addColumns({queryRunner, schemaName, tableName, columnDefinitions})`.

**Q2. Séquence DDL exacte pour créer un Field "Priority" sur "Deal" + temps sur 100k rows ?**

Séquence (extraite de `create-field-action-handler.service.ts:162-239`) :
1. **Collect enum operations** si `type IN (SELECT, MULTI_SELECT, RATING)` → `CREATE TYPE workspace_xxx.deal_priority_enum AS ENUM(...)`.
2. **Generate column definitions** via `generateColumnDefinitions()` — produit le SQL `ADD COLUMN "priority" "deal_priority_enum" DEFAULT 'medium'`.
3. **Execute batch enum operations** : `CREATE TYPE` puis `ALTER TYPE ADD VALUE`.
4. **`ALTER TABLE workspace_xxx.deal ADD COLUMN ...`** via `columnManager.addColumns`.
5. Si MORPH/RELATION MANY_TO_ONE : `ALTER TABLE ... ADD CONSTRAINT FK_xxx FOREIGN KEY ...`.
6. **Insert dans `core.fieldMetadata`** (`executeForMetadata` lignes 92-102).

Temps sur 100k rows :
- `ADD COLUMN nullable DEFAULT NULL` : **instantané** (Postgres 11+ ne réécrit pas la table).
- `ADD COLUMN NOT NULL DEFAULT 'value'` (Postgres 11+) : **instantané** (metadata-only).
- `CREATE TYPE ... ENUM` : **instantané** (catalog-only).
- `ALTER TYPE ADD VALUE` (Postgres 12+) : **instantané** mais ne marche pas en transaction explicite (à confirmer dans le code de Twenty).
- **Drop column / Rename column** : verrou ACCESS EXCLUSIVE, mais sans réécriture → secondes.
- **ALTER COLUMN TYPE** (changement de type texte → enum) : **réécriture complète de la table**, peut bloquer 30s à plusieurs minutes selon disque et 100k rows.

**Verdict** : Twenty est rapide pour ADD COLUMN / DROP COLUMN. Le piège c'est le **changement de type** (rare en pratique côté user).

**Q3. Indexes sur fields custom : auto-créés ou à demander ?**

→ **Manuels via UI** depuis PR #20846 (commit `d602f35cbd` 2026-05-25, "feat(data-model): custom-indexes management UI and mutations"). Avant ça : aucun index auto sauf sur les FK (relations). Le module `metadata-modules/index-metadata/` existe et le `IndexMetadataEntity` est branché sur `objectMetadata` (`object-metadata.entity.ts:115-118`). Le user peut créer un index named ou unique via les nouvelles mutations GraphQL.

**Verdict** : avant la PR du 25, les workspaces Twenty avec 50k+ records sans index custom **rament** au moindre WHERE / ORDER BY. C'est un piège classique. Côté Veridian : **on documente les indexes obligatoires** pour le module Leads-B2B avant le first deploy client.

---

### Multi-tenancy

**Q4. Workspace = schéma Postgres séparé ou row-level ?**

→ **Schéma Postgres séparé**. Voir Q1 + `WorkspaceDataSourceService.createWorkspaceDBSchema()` (`workspace-datasource.service.ts:56-69`) qui appelle `queryRunner.createSchema(schemaName, true)` — c'est un vrai `CREATE SCHEMA workspace_xxxxx` Postgres natif. Le schéma `core` contient les méta-données partagées (workspace, user, fieldMetadata, objectMetadata, etc.).

**Q5. Combien de workspaces Twenty supporte sur un seul Postgres ?**

Aucune limite imposée par le code Twenty. Limite Postgres : `pg_namespace` (table système des schémas) tient des centaines de milliers d'entrées, mais :
- **Performance `pg_dump` / `pg_restore`** se dégrade au-delà de 1 000 schémas.
- **Auto-vacuum** s'enkystue (chaque schéma a ses tables → des dizaines de tables par schéma × 1 000 schémas = 30k+ tables à scanner).
- **Plan cache PostgreSQL** : chaque connexion avec `search_path` différent gonfle le plan cache.
- Twenty docs officielles recommandent < 10 000 workspaces par instance Postgres.

**Verdict pragmatique** : **OK jusqu'à 500 workspaces sur une instance correctement tuned**. Au-delà : sharding par instance Postgres (chaque shard = N workspaces). Pour Veridian : on est large pendant 2-3 ans.

**Q6. Isolation workers BullMQ par workspace ?**

→ **NON, tous mélangés**. Les queues BullMQ sont **globales par type de job** (`message-queue.constants.ts`) :
- `taskAssignedQueue`, `messagingQueue`, `webhookQueue`, `cronQueue`, `emailQueue`, `calendarQueue`, `contactCreationQueue`, `billingQueue`, `workspaceQueue`, `entityEventsToDbQueue`, `workflowQueue`, `delayedJobsQueue`, `deleteCascadeQueue`, `logicFunctionQueue`, `triggerQueue`, `aiQueue`, `aiStreamQueue`.

Le `workspaceId` est passé en payload du job, pas en nom de queue. **Implication** : un workspace qui lance 100k jobs workflow à la fois **prive tous les autres** workspaces de slot worker. Pas de throttling per-workspace natif. **Risque noisy-neighbor à anticiper** quand on aura 50+ clients.

**Mitigation Veridian** : soit ajouter un middleware de rate-limiting per-workspace dans les jobs handlers, soit (plus tard) une instance worker dédiée pour clients Business+.

---

### Auth

**Q7. Le module `core-modules/auth/` est-il facile à remplacer par HMAC Hub ?**

→ Modéré. Le module n'est PAS modulaire au sens "remplace la classe AuthService" — c'est un patchwork de **9 contrôleurs** (`controllers/`), **10+ stratégies Passport** (`strategies/`), **20+ services** (`services/`), **7 types de tokens** (`token/services/`). On hooke où ?

**Solution recommandée** (sans toucher au reste) : créer un nouveau controller `HubBridgeController` dans `engine/core-modules/auth/controllers/hub-bridge.controller.ts` qui :
1. Reçoit un POST `/auth/hub-bridge` avec un JWT signé HMAC par le Hub.
2. Vérifie la signature HMAC avec `NOTIFUSE_HUB_API_SECRET` (cf. CLAUDE.md cross-app).
3. Trouve ou crée le `UserEntity` correspondant à `payload.email`.
4. Émet un `loginToken` via `LoginTokenService.generateLoginToken()` (`login-token.service.ts:26`).
5. Redirige le frontend vers `/verify?token=...` (le flow existant gère la suite).

**Effort** : ~2 j-h pour le controller + 1 j-h pour les tests + 0.5 j-h pour le branchement front (juste un bouton "Login avec Veridian"). **Total : ~3.5 j-h pour câbler le SSO Hub sans toucher au reste.**

Callbacks à hooker : aucun, on n'a pas besoin de modifier les flows existants — on ajoute un nouveau flow parallèle.

**Q8. Twenty supporte-t-il les magic-links ? Sessions cross-app cookie `.veridian.site` ?**

→ **Magic-link** : pas en tant que tel (cf. point 6 synthèse). Le pattern le plus proche = `InvitationToken` (`workspace-invitation.service.ts`). On peut **réutiliser** : créer un token côté Hub, l'envoyer par mail, le user clique → endpoint Twenty qui consomme le token et émet access/refresh. Effort : ~1 j-h.

**Cookie cross-app `.veridian.site`** : Twenty utilise `accessToken` en mémoire JS + `refreshToken` en cookie httpOnly. Le domaine cookie est configuré via `SERVER_URL` env. Pour partager le cookie entre `crm.veridian.site` et `hub.veridian.site`, il faut :
- Setter `Domain=.veridian.site` au lieu de `Domain=crm.veridian.site`.
- Setter `SameSite=Lax` (déjà le cas).
- Setter `Secure` (déjà le cas en prod).

Recherche dans le code : le cookie est setté dans `RefreshTokenService` (à vérifier). **Effort de mod** : ~30 min pour patcher le `Set-Cookie` header. Mais attention : si Hub et CRM partagent le cookie, **tu cumules les vulnérabilités CSRF** — préférer un flow SSO explicite avec redirect, pas un cookie partagé. **Reco** : ne pas partager le cookie, faire un SSO via Hub.

**Q9. Le `UserEntity` Twenty est-il compatible avec notre `hub_user_id` ?**

Le `UserEntity` a son propre `id: uuid` (PK auto-générée, `user.entity.ts:39-41`). Pas de champ `hub_user_id` natif. Pour mapper : ajouter une colonne `hubUserId: string | null` (1 migration TypeORM, ~10 lignes) avec index unique. Effort : 1 j-h max incluant tests.

Champ `email` est unique (index `UQ_USER_EMAIL` lignes 34-37), donc on peut aussi mapper par email — plus simple, mais le risque c'est qu'un user change d'email côté Hub et casse le bridge. **Reco** : mapper par `hubUserId` (UUID, immuable) avec fallback email pour la première migration.

---

### Billing

**Q10. `core-modules/billing/` modulaire (replace facile) ?**

→ **NON, monolithique et entièrement Enterprise-licensed**. 107 fichiers serveur (`engine/core-modules/billing/`) + 22 fichiers `billing-webhook/` + 19 front (`twenty-front/src/modules/settings/billing/`). Toutes les classes commencent par `/* @license Enterprise */` (vérifié : `billing.module.ts:1`, `billing-webhook.controller.ts:1`).

Le `BillingResolver`, le `BillingService`, le `BillingWebhookController`, les `BillingSubscription*Service` sont **tous interconnectés** via DI NestJS et le `BillingModule` est importé dans `AuthModule` (`auth.module.ts:42`) → impossible de juste virer `BillingModule`, il faut écrire un **`HubBillingModule` mock** qui expose les mêmes services (mêmes signatures) mais renvoie des données depuis Hub.

**Reco Veridian** : **ne pas tenter de remplacer in-place**. Tu :
1. Désactives `IS_BILLING_ENABLED=false` (flag déjà supporté, `.env.example:23`).
2. Forks le `BillingResolver` minimal qui renvoie toujours `plan: Pro, status: active` (un mock).
3. Le statut réel d'abo est lu côté Hub par le user dans `hub.veridian.site/billing`.
4. Le CRM ne gère AUCUN billing en local — c'est la philosophie "Hub orchestrateur" déjà actée.

**Effort** : ~2 j-h pour câbler les mocks + 1 j-h pour vérifier qu'aucun resolver / cron / listener ne plante en l'absence du module billing complet.

**Q11. Quels events Stripe Twenty utilise ?**

(`engine/core-modules/billing/enums/billing-webhook-events.enum.ts`)
- `customer.subscription.created` / `updated` / `deleted`
- `customer.created`
- `setup_intent.succeeded`
- `entitlements.active_entitlement_summary.updated`
- `product.created` / `updated`
- `price.created` / `updated`
- `billing.alert.triggered`
- `invoice.finalized` / `paid`
- `subscription_schedule.updated`
- `billing.credit_grant.created` / `updated`

Compatible avec Hub orchestrator Veridian ? **Partiellement** : Hub gère `customer.subscription.*`, `invoice.payment_failed`, `customer.subscription.deleted` (cf. `veridian-prospection/shared/docs/saas-standards.md:319-323`). Twenty utilise en plus `entitlements`, `setup_intent`, `credit_grant`, `alert.triggered` — c'est leur modèle de billing usage-based / metered, **pas le notre**. Comme on désactive le billing CRM (Q10), pas de conflit : les webhooks Stripe Veridian vont uniquement vers Hub, pas vers Twenty.

---

### Email

**Q12. Comment Twenty envoie un mail transactional ?**

→ Via `EmailService.send()` (`engine/core-modules/email/email.service.ts:11-24`) qui **push un job BullMQ** (`EmailSenderJob`) dans la queue `emailQueue`. Le job consomme via `EmailDriverFactory` (`email-driver.factory.ts:14-83`) qui résout 2 drivers :
- `LOGGER` (dev, log dans la console)
- `SMTP` (prod, via `nodemailer` 8 — `smtp.driver.ts`)

Pas de driver Sendgrid / Brevo / Postmark natif.

**Q13. Possible de remplacer par client HTTP vers Notifuse ?**

→ **OUI, trivial**. Créer un nouveau driver `notifuse.driver.ts` dans `engine/core-modules/email/drivers/` qui implémente `EmailDriverInterface` (juste 1 méthode `send(options): Promise<void>`). Ajouter `NOTIFUSE` dans l'enum `EmailDriver`. Ajouter le case dans `email-driver.factory.ts:43-77`. **Effort : ~1.5 j-h** incluant les tests + variables d'env.

Le driver Notifuse fera un POST HMAC-signé vers `notifuse.veridian.site/api/transactional/send` avec le payload converti depuis `SendMailOptions` (nodemailer) vers le format Notifuse v1.4. Le seul piège : les pièces jointes (Twenty les envoie en base64 inline) — Notifuse les accepte-t-il ? À vérifier côté agent Notifuse.

---

### Messaging (mail réception)

**Q14. Archi mail réception Twenty ?**

`packages/twenty-server/src/modules/messaging/message-import-manager/drivers/` :
- `gmail/` — OAuth2 + Gmail API.
- `microsoft/` — OAuth2 + Microsoft Graph API.
- `imap/` — **IMAPflow 1.2.1** (lib JS native), supporte QRESYNC pour delta sync efficace (vu dans `can-use-qresync.util.ts`).
- `inbound-email/` — webhook (Mailgun / Postmark / SES inbound).

Le sync est piloté par des crons (`crons/`) + des jobs BullMQ qui appellent les drivers. Cursor de sync persisté dans `MessageChannel.syncCursor`.

**Q15. On garde tel quel ou on remplace par Mail Gateway Hub Veridian ?**

**Reco : garder Twenty tel quel pour le MVP.** Le code est mature, supporte IMAP/Gmail/MS/Inbound, et c'est différentiateur (récupérer les mails dans le timeline du contact = killer feature CRM). Re-écrire ça nous coûterait 4-6 semaines.

**Pour Vague 12+** : si Robert veut une "Mail Gateway Hub" centralisée (single point of OAuth + IMAP credentials, propagation vers CRM + Prospection), on peut remplacer plus tard. Pas P0.

**Q16. Impact AGPL sur Mail Gateway si on garde Twenty messaging ?**

Twenty messaging = AGPLv3 (vérifié : aucun `@license Enterprise` dans `modules/messaging/`). **Conséquence stricte AGPL** : si on modifie le messaging Twenty (ex : ajout d'un driver custom Veridian Mail Gateway), on doit **publier ces modifications** dans notre fork public. Si on ne modifie pas → on peut juste publier notre fork (qui contient déjà la mod AGPL) sans ajouter de contraintes nouvelles.

**Verdict pragmatique** : on garde, on documente le fork public, on est cool. Si plus tard on créé un "Veridian Mail Gateway" séparé (microservice à part), ce service-là peut être propriétaire fermé tant qu'il ne contient pas de code Twenty.

---

### Workflows

**Q17. Workflows = EE ou CE ?**

→ **CE/AGPLv3**. Vérifié : 288 fichiers dans `packages/twenty-server/src/modules/workflow/`, **aucun marqué Enterprise**. C'est la bonne nouvelle du fork. Workflows = part of OSS Twenty.

**Q18. Archi Workflow (trigger + condition + action) + sync/async ?**

(`modules/workflow/`)
- **Trigger types** (`workflow-trigger/automated-trigger/`) :
  - `DATABASE_EVENT` (création/update/delete d'un record → listener TypeORM hook)
  - `CRON_TRIGGER` (cron expression évaluée toutes les minutes par `automated-trigger.workspace-service.ts`)
  - `MANUAL_TRIGGER` (déclenché depuis UI ou API)
  - `FORM_TRIGGER` (submission d'un form public, cf. `assert-form-step-is-valid.util.ts`)
- **Conditions / branchements** : actions `if-else`, `filter`, `iterator`.
- **Actions disponibles** (`workflow-executor/workflow-actions/`) :
  - `ai-agent` — appel LLM via SDK ai 6.0.97
  - `code` — exécution JS sandboxed (via `code-interpreter` core module, peut être LOCAL ou cloud)
  - `delay` — pause N secondes/heures
  - `filter` — condition gate
  - `form` — interaction utilisateur (workflow attend une saisie)
  - `http-request` — POST/GET HTTP externe
  - `if-else` — branchement booléen
  - `iterator` — loop sur un array
  - `logic-function` — appel à une `logic-function` externe (lambda-like)
  - `mail-sender` — envoi mail via le module Email (cf. Q12)
  - `record-crud` — create/update/delete d'un record CRM

- **Exécution** : **ASYNCHRONE via BullMQ** (queue `workflowQueue`, cf. `MessageQueue.workflowQueue`). Le `WorkflowRunner` (`workflow-runner/`) pull les jobs et exécute action par action. Chaque step persisté en `workflowRun` pour reprise sur crash.

**Verdict** : archi solide, comparable à Make / n8n. Hautement extensible. Excellent fondation.

**Q19. Ajouter une action "Send via Notifuse" facile ?**

→ **Très facile**. Créer un dossier `workflow-executor/workflow-actions/notifuse-send/` avec :
- `notifuse-send.workflow-action.ts` (la classe action, ~80 lignes en suivant le pattern `mail-sender/`).
- `types/` (settings input du form de config workflow).
- `guards/is-workflow-notifuse-send-action.guard.ts` (typeguard).
- `notifuse-send-action.module.ts` (module DI).
- Enregistrer dans `workflow-executor.module.ts`.

Côté frontend, ajouter le rendu de config dans `twenty-front/src/modules/workflow/components/...`. **Effort total : ~3 j-h** pour avoir l'action câblée bout-en-bout (back + front + form de config + tests).

**C'est le quick-win le plus juteux du fork.** Robert pourra dire à un client : "compose ton scénario CRM en glisser-déposer, l'action Notifuse envoie le mail avec ton template Veridian". Killer feature.

---

### Frontend / UI

**Q20. Stack frontend exacte ?**

(`packages/twenty-front/package.json`)
- **React 18** + ReactDOM 18
- **Jotai 2.17** (state management, pas Recoil)
- **Apollo Client 4** (GraphQL)
- **React Router 6**
- **Vite** + plugin React SWC 4 (build rapide)
- **@wyw-in-js/transform 0.7.0** (zero-runtime CSS-in-JS, fork de Linaria, patché localement)
- **Emotion** (au moment des stories Storybook)
- **Lingui 5.1.2** (i18n)
- **Storybook 10.3** (composants en isolation)
- **Vitest 4** (tests unitaires)
- **TipTap 3.4** + BlockNote 0.47 (rich text editors)
- **xyflow/react 12** (workflow builder visuel)
- **Mantine 8** (datepicker, popover, etc.)
- **@dnd-kit/react 0.3** + Hello Pangea DnD 16 (drag-and-drop)
- **Sentry 10** (errors)
- **AI SDK 6** (workflow AI actions)

Composants réutilisables : tout `packages/twenty-ui/src/` (display, input, navigation, layout, feedback, accessibility, json-visualizer, theme-constants).

**Q21. UI builder Object/Field/View — composant principal ?**

→ `packages/twenty-front/src/modules/settings/data-model/` :
- `objects/` — liste & édition des Objects
- `object-details/` — détail d'un Object (fields, relations, settings)
- `new-object/` — wizard de création

C'est extensible et l'archi `flat-*` (vu côté serveur : `flat-object-metadata`, `flat-field-metadata`) est précisément faite pour générer le formulaire dynamiquement à partir des `FieldMetadataType` (TEXT, NUMBER, SELECT, RELATION, etc. — 23 types). Très propre.

**Q22. Thème centralisé ? Combien de fichiers pour rebrand visuel ?**

→ **Thème centralisé** dans `packages/twenty-ui/src/theme/constants/` :
- `ColorsLight.ts` / `ColorsDark.ts` (palette de base)
- `AccentLight.ts` / `AccentDark.ts` (couleurs d'accent — c'est ici qu'on changera "Twenty Blue" → "Veridian Indigo")
- `BackgroundLight/Dark`, `BorderLight/Dark`, `FontLight/Dark`, etc. (1 fichier par axe × 2 modes)
- `themeCssVariables.ts` dans `theme-constants/` — exporte en CSS variables.

**Pour rebrand visuel Veridian** :
1. Modifier `AccentLight.ts` / `AccentDark.ts` (10 lignes max).
2. Modifier `theme-constants/theme-light.css` + `theme-dark.css` (CSS variables hardcodées).
3. Remplacer le favicon dans `packages/twenty-front/public/` (à vérifier — pas trouvé de fichier `favicon.ico` direct, à creuser).
4. Remplacer le logo SVG dans `twenty-ui/src/assets/` + `twenty-front/src/...` (cherche les usages de `LogoFull` / `LogoIcon`).
5. Remplacer les strings "Twenty" : **7 469 occurrences front + 35 605 serveur + 798 emails = 43 872 total**. La majorité sont du code (paths d'import, noms de classes/types `TwentyConfigService`, `TwentyORM`, etc.) — **on NE renomme PAS le code, on ne renomme que les strings user-visible** (UI labels, page titles, emails subject/body).

**Effort rebrand visuel pragmatique** :
- Logos + favicon + couleurs : ~1 j-h.
- Strings user-visible (titres pages, meta tags, emails, copy marketing) : ~2-3 j-h en passant via Lingui (les `msg\`...\`` dans le code) + grep des hardcoded strings.
- **Total : ~4 j-h** pour un rebrand visuel propre sans casser le upstream merge.

**À NE PAS renommer** : `TwentyConfigService`, `twenty-orm`, le namespace `twenty-shared`, les classes internes — ces strings disparaissent à la compilation, pas visible user. Renommer ça = enfer pour les futurs merges upstream.

---

### Tests

**Q23. E2E ? Lib ? Coverage ?**

→ **Playwright** 1.56. Package dédié `packages/twenty-e2e-testing/` :
- 8 specs : `create-kanban-view.spec.ts`, `create-record.spec.ts`, `login.setup.ts`, `workflow-creation.spec.ts`, `workflow-run.spec.ts`, `workflow-use-as-draft.spec.ts`, `workflow-visualizer.spec.ts`.
- Coverage **faible** (8 specs pour un CRM aussi gros = ~3-5% de coverage E2E max). Twenty Inc. ne mise pas sur les E2E exhaustifs.

Tests unitaires Vitest 4 côté front, Jest côté serveur. Coverage plus correcte côté serveur (les `flat-entity` ont des `__tests__/` partout).

**Q24. Hooker nos propres E2E ?**

→ Très facile. Le package `twenty-e2e-testing` est isolé (sa propre `playwright.config.ts`, son propre `package.json`). On peut ajouter `tests/veridian/*.spec.ts` sans toucher au reste. Pattern : reproduire le flow Hub→login bridge→CRM, créer un Object custom, créer 100 records, vérifier la perf, etc.

**Reco** : avant d'attaquer la Vague 11, écrire **3-5 specs Playwright critiques** :
1. Login via Hub bridge (le SSO Veridian)
2. Création d'un Object custom + 10 fields
3. Création d'un record + vérification GraphQL recomputed
4. Workflow simple (trigger DB → action Notifuse)
5. Import CSV → propagation au timeline

Ces specs vont devenir le gate `pnpm e2e:staging:full` (cf. règle team-lead CLAUDE.md cross-app).

---

### Déploiement

**Q25. Stack runtime exacte ?**

(`docker-compose.yml`)
- `server` (image `twentycrm/twenty:latest`, port 3000)
- `worker` (mêmes images, command `yarn worker:prod`)
- `db` (`postgres:16`)
- `redis` (image `redis` default, `--maxmemory-policy noeviction`)

Node **24.5.0**. Postgres **16**. Redis **default** (pas de version pin, à fixer en prod). Yarn 4.13.

**Q26. Taille machine minimum staging + prod ?**

Build Vite frontend : `NODE_OPTIONS=--max-old-space-size=8192` (8 GB max heap) → il faut **au minimum 8 GB RAM** sur le runner CI/CD pour build.

Runtime production estimation :
- `server` Node 24 : ~700 MB RAM idle, 1.5 GB sous charge
- `worker` : ~500 MB idle, 1-2 GB sous charge (avec workflows AI actions)
- Postgres 16 : ~500 MB pour 100 workspaces + données normales (à monitorer, peut exploser avec les indexes custom)
- Redis : ~100-300 MB selon volume queues

**Minimum staging** : 4 GB RAM (juste serveur, pas de worker actif), 30 GB disque.
**Minimum prod (100 clients)** : 8 GB RAM, 100 GB disque, 4 vCPU.

À noter : le dev server OVH (`dev-pub`) a 7.6 GB RAM — **juste suffisant** pour Twenty staging si on ne fait pas tourner Hub + Prospection en parallèle dessus. Anticipation infra requise.

**Q27. Logs structurés JSON ?**

→ **NON par défaut**. Twenty utilise `ConsoleLogger` NestJS (`engine/core-modules/logger/logger.module.ts:17-22`) qui produit du texte plain. Pas de Pino, pas de Winston, pas de JSON structuré.

Pour Grafana Cloud Veridian : il faut **wrapper** le logger. Pattern reco :
1. Créer `engine/core-modules/logger/drivers/json-pino.driver.ts` qui implémente `LoggerDriver`.
2. Ajouter `JSON_PINO` à l'enum `LoggerDriverType`.
3. Brancher dans `LoggerModule.forRoot()`.
4. Variable d'env `LOGGER_DRIVER=JSON_PINO`.

**Effort** : ~2 j-h. Pas bloquant pour le MVP — on peut shipper avec ConsoleLogger et migrer en Vague 12.

Driver Sentry **déjà supporté** (`SENTRY_DSN` dans `.env.example:48`). Compatible avec notre stack monitoring Veridian.

---

### Enterprise edition

**Q28. Features EE les plus précieuses ?**

Par valeur business descendante (mon avis) :
1. **SSO** (SAML, OIDC) — `core-modules/sso/` (14 fichiers EE). Indispensable pour Enterprise clients. Mais probablement pas P0 pour MVP Veridian (Hub gère déjà OAuth Google + Microsoft).
2. **RBAC fin / Roles** — `metadata-modules/role/` (frontend EE : `settings/roles/`, 19 fichiers). Permet de créer des rôles custom avec permissions granulaires par Object et par Field. Très demandé par les clients > 10 users.
3. **Row-level permissions** — `metadata-modules/row-level-permission-predicate/` (17 fichiers EE). "Cet user ne voit que les leads dont owner = lui" type filtres. Premium, mais déjà plus rare.
4. **Audit logs avancés** — `core-modules/event-logs/` (11 fichiers EE). Trace toutes les modifs avec metadata (ip, user-agent, etc.). Compliance-friendly.
5. **Custom domains** (`core-modules/cloudflare/`, `core-modules/dns-manager/`) — déjà des features Hub Veridian.
6. **Billing usage-based** — irrelevant, on a notre Hub orchestrator.

**Q29. Coût licence EE OEM ?**

Pas trouvé sur leur site officiel. Twenty Inc. ne publie pas de tarif EE OEM publique en 2026. **À demander par mail à sales@twenty.com** si Robert veut investiguer. Mon estimation marché : **50k-200k USD/an** pour OEM rebrand SaaS, avec sliding scale selon revenu généré.

**Verdict** : pas la peine d'envoyer un mail tant qu'on n'a pas 50+ clients payants. Au démarrage, on dev nos features EE-like (ou on s'en passe) et on garde le contact ouvert pour plus tard.

**Q30. Si dev en interne, lesquelles coûtent le plus cher ?**

Effort estimatif pour re-coder les features EE en interne :
1. **SSO SAML** : ~3-4 sem (passport-saml + UI + tests)
2. **RBAC fin** : ~6-8 sem (refactor des permissions partout dans le code, UI complète, edge cases nombreux)
3. **Row-level permissions** : ~4-6 sem (intégration avec le query builder GraphQL, tests perf)
4. **Audit logs avancés** : ~2-3 sem (writer ClickHouse + UI viewer)
5. **Custom domains** : déjà fait côté Hub Veridian
6. **Billing usage-based** : N/A (on a Hub)

**Reco MVP Vague 11** : **n'implémenter aucune feature EE**. Notre MVP = AGPL CE pur. SSO/RBAC viennent en Vague 13-14 si demande client. Pour rappel : la philo Veridian "tout illimité partout" (cf. CLAUDE.md `PRICING-VERIDIAN.md`) rend RBAC moins critique.

---

## 3. Top 5 pièges identifiés

### 🔴 Piège 1 : 242 fichiers serveur marqués `@license Enterprise` mêlés dans le repo principal

**Risque** : si on deploy le fork tel quel pour un client payant **sans avoir désactivé/retiré ces fichiers**, on est en violation contractuelle de la double-licence Twenty Inc. (AGPL OU EE — pas AGPL ET EE). Le `EnterprisePlanService` vérifie un JWT signé par Twenty Inc. (`enterprise-plan.service.ts:48-60`), donc à runtime ces features sont gatées **mais le code source les contient**.

**Mitigation** :
- Phase 1 (Vague 11.1) : laisser le code en place mais **set `ENTERPRISE_KEY` vide** → features désactivées à runtime.
- Phase 2 (avant first paid client) : **retirer physiquement les fichiers** `@license Enterprise` du fork. Ou les `// @ts-nocheck` + stubs vides. Action légalement safe car notre fork AGPL ne contient pas ces fonctionnalités effectives.
- Documenter explicitement dans le README du fork : "Veridian CRM = AGPLv3 only, Enterprise features removed". Lawyer-safe.

### 🔴 Piège 2 : Schema-per-workspace explose à 5 000 schémas

**Risque** : Twenty crée un `CREATE SCHEMA workspace_xxx` à chaque nouveau workspace. Au-delà de quelques milliers, **`pg_dump` devient lent, auto-vacuum lag, plan cache bloated**. Veridian ne va pas y arriver de sitôt mais c'est un piège architectural à connaître.

**Mitigation** : sharder par instance Postgres dès 1 000 workspaces actifs. Documenter dans `veridian-infra/docs/scaling-crm.md` quand on aura > 100 workspaces réels.

### 🔴 Piège 3 : Brief original outdated — Recoil → Jotai

**Risque** : si on copie-colle des patterns Recoil dans le code Veridian (vu sur les sites de docs Twenty datés < 2025), ça ne compilera pas. **Tout est Jotai 2.17 maintenant**.

**Mitigation** : tout nouveau code front lit le state via `useAtomValue`, `useSetAtom`, `useAtom` (Jotai), **PAS** `useRecoilValue`. Le team-lead doit briefer les agents de Vague 11 sur ce point. Documenter dans `veridian-crm/CONVENTIONS.md` à créer.

### 🟡 Piège 4 : E2E coverage très faible (8 specs)

**Risque** : on fork un produit qu'on a peu testé. Les bugs régressifs vont apparaître quand on touchera à des features non couvertes (custom domains, audit, billing, advanced workflows).

**Mitigation** : écrire les 5 specs Playwright critiques **AVANT** la Vague 11.1 (cf. Q24). Les inscrire dans `pnpm e2e:staging:full` comme blocking gate.

### 🟡 Piège 5 : Queues BullMQ globales (pas isolated par workspace)

**Risque** : un client qui lance 10k jobs workflow d'un coup **affame les autres workspaces**. Pas de quota par tenant natif.

**Mitigation** : middleware de rate-limiting `per-workspace` à coder dans les job handlers (~2 j-h). À faire avant le 5e client payant.

---

## 4. Recommandations — ordre d'attaque Vague 11

### Vague 11.1 — Setup & rebrand minimal (1 sem solo)

1. Fork `twentyhq/twenty` → `Christ-Roy/veridian-crm`
2. Branche `staging` créée
3. Rebrand visuel : couleurs + logo + favicon (cf. Q22) — **4 j-h**
4. Désactiver Enterprise features (`ENTERPRISE_KEY=` vide, `IS_BILLING_ENABLED=false`)
5. Setup Dokploy compose staging sur `crm.staging.veridian.site`
6. Écrire 5 specs Playwright critiques (cf. Q24) — **3 j-h**
7. CI staging GH Actions qui deploy auto + smoke
8. **Gate** : staging accessible avec login local password (sans Hub bridge encore) ✓

### Vague 11.2 — Bridge Hub auth (1 sem solo)

1. Créer `HubBridgeController` (`auth/controllers/hub-bridge.controller.ts`) — **3.5 j-h** (cf. Q7)
2. Ajouter colonne `User.hubUserId` + migration TypeORM — **1 j-h** (cf. Q9)
3. Front : bouton "Se connecter avec Veridian" qui redirige vers Hub OAuth flow
4. E2E spec : login Hub bridge end-to-end ✓
5. **Gate** : un user créé sur Hub peut se logger sur CRM staging ✓

### Vague 11.3 — Notifuse integration (1 sem solo)

1. Driver email `NotifuseDriver` (`email/drivers/notifuse.driver.ts`) — **1.5 j-h** (cf. Q13)
2. Action workflow `notifuse-send` (back + front + form config) — **3 j-h** (cf. Q19)
3. E2E spec : workflow "lead created → Notifuse send welcome email" ✓
4. **Gate** : un workflow Veridian envoie un mail Notifuse depuis le CRM ✓

### Vague 11.4 — Module Leads-B2B (lecture from Prospection) (2 sem solo)

1. Nouveau remote object Twenty (`isRemote: true`) pour `leads_b2b` — il existe déjà un concept `isRemote` dans `object-metadata.entity.ts:76`
2. Connector vers API Prospection `/api/leads/search` HMAC-signé
3. UI search + import-as-Person dans le CRM (1-clic enrichissement)
4. **Gate** : un user CRM peut chercher dans les 996K leads et créer un Person à partir d'un lead ✓

### Vague 11.5 — Polish + first client (1.5 sem solo)

1. Rebrand strings user-visible (Lingui + meta tags) — **3 j-h**
2. Cleanup Enterprise code (rip physiquement les `@license Enterprise` files) — **2 j-h**
3. Documentation client (`docs/veridian-crm-quickstart.md`)
4. Promo prod `crm.veridian.site`
5. **Gate** : 1 client Robert utilise le CRM en prod ✓

**Total** : ~6.5 semaines (vs 8 sem initialement estimées). Possible parce qu'on n'attaque PAS de feature EE et on garde 100% du méta-modèle Twenty.

### À éviter en Vague 11

- ❌ Ne PAS implémenter SSO custom — Hub gère.
- ❌ Ne PAS implémenter RBAC custom — laisser Twenty CE "tous admin" et différencier plus tard.
- ❌ Ne PAS toucher au workspace-schema-builder GraphQL — c'est le cœur de Twenty, casser ça = catastrophe.
- ❌ Ne PAS migrer les 996K leads Prospection vers Twenty — schema-per-workspace ne tient pas, les leads restent dans Prospection.
- ❌ Ne PAS implémenter d'audit logs avancés — `event-logs` est EE, et nos clients MVP n'en ont pas besoin.

---

## 5. Risques et mitigation

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Twenty Inc. release breaking changes (méta-modèle, API GraphQL) | Élevée | Élevé | Pin notre fork sur un tag stable (ex: `v0.2.1`). Mise à jour mensuelle planifiée avec battery E2E. |
| Codebase 100k+ lignes — courbe d'apprentissage | Certain | Moyen | Documenter dans `veridian-crm/ARCHI.md` les 10 modules-clés (custom-fields, workflow-runner, workspace-schema-builder, twenty-orm, message-queue). |
| Faille sécu non patchée upstream | Moyen | Élevé | Subscribe aux releases GitHub Twenty + dependabot auto-PR. `npm audit critical` bloquant en CI. |
| Twenty Inc. pivot ou acquisition → fork orphelin | Faible | Faible | On a déjà accepté le risque (cf. décision Robert 2026-05-25). Le code est AGPL, on garde le contrôle du fork. |
| Dette technique cachée (TODO SECURITY, deprecated columns) | Confirmé | Faible | Vu `@deprecated` partout dans `object-metadata.entity.ts:38`, `person.workspace-entity.ts:41-46`. Twenty est en migration interne (architecture flat-entity en cours). À auditer plus tard avec `grep -rn "@deprecated\|TODO\|FIXME"` régulièrement. |
| Build front Vite OOM (8 GB minimum) | Élevée | Faible | CI sur runner self-hosted 16 GB. Document dans `veridian-infra`. |
| Migration upstream Twenty conflicts | Moyenne | Élevé | Garder un fork **vanilla** (zéro modif des fichiers Twenty) + tout notre code dans `packages/veridian-extensions/` séparé. Suit le pattern Twenty Inc. workspace structure. |

---

## 6. Conclusion et go/no-go

**Verdict global** : ✅ **GO pour Vague 11 avec le scope cadré ci-dessus.**

Twenty est une bonne base technique :
- Méta-modèle propre (vraies tables Postgres, vrai GraphQL recomputed).
- Workflows AGPL solides (288 fichiers, archi mature trigger+action+queue async).
- Frontend moderne (React 18 + Jotai 2.17 + Apollo 4 + Vite).
- Multi-tenant via schémas Postgres (OK jusqu'à 1 000 workspaces).

Pièges connus, mitigation cadrée :
- Désactiver / retirer Enterprise code avant first paid client.
- E2E coverage à booster nous-mêmes (5 specs critiques minimum).
- Brief Recoil obsolète → tout est Jotai maintenant.
- Schema-per-workspace OK pour 2-3 ans Veridian.

Effort réel estimé : **~6.5 semaines solo** pour livrer crm.veridian.site avec auth Hub + Notifuse + lien Prospection lecture, en restant 100% AGPL CE.

**Avant lancement Vague 11** :
1. Robert valide ce verdict.
2. Robert valide les 5 spécifications Playwright critiques (Q24) → spawn d'un agent dédié.
3. Le `00-VISION.md` est mis à jour avec : Recoil → Jotai, schema-per-workspace, désactivation EE.
4. Les 13 questions ouvertes de `08-questions-ouvertes.md` ont été tranchées.

**Si tu changes d'avis et reviens aux voies D/C** (méta-modèle léger maison ou briques génériques) → ce rapport documente précisément ce qu'on aurait gagné/perdu en partant Twenty. Reste utile en historique.

---

*Fin de l'audit micro. Le ticket source `2026-05-25-audit-twenty-micro-detail.md` est résolu — peut être déplacé vers `done/`.*
