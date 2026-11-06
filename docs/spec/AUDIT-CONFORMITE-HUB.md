# AUDIT-CONFORMITE-HUB.md — Veridian CRM (fork Twenty) vs CONTRAT-HUB v1.7

> **Auditeur** : Claude (agent veridian-crm)
> **Date** : 2026-05-26
> **Source contrat** : `veridian-hub/docs/CONTRAT-HUB.md` v1.7 (4269 lignes),
> `veridian-hub/docs/CONTRAT-HUB-API-REF.md` v1.3 (3115 lignes),
> `veridian-hub/docs/CONTRAT-BILLING.md` v2.0 (1051 lignes).
> **Code audité** : `veridian-crm-repo/packages/twenty-server/` (fork twentyhq/twenty @ 1188ea9c).
> **Compagnon légal** : `AUDIT-LIMITE-EE-TWENTY.md`.

---

## 1. Verdict global

> **Twenty respecte ~10 % du contrat Hub nativement (uniquement par
> isomorphisme de modèle : workspaces ≈ tenants, users, magic links via
> AppToken). Les ~30 % de logique métier proche (suspend/restore/delete
> workspace, magic link interne, invitation flow, soft-delete cascade)
> sont à adapter — pas à recoder from scratch, mais à wrapper dans un
> contrôleur REST HMAC dédié (env. 35-50h-agent). Les ~50 % restants
> (HMAC m2m, lifecycle 5-états Veridian, paywall obfusqué, audit GDPR,
> plan_source, hub_user_id mapping, idempotency-key, lookup user data,
> trial state machine côté CRM) sont à créer from scratch (env.
> 60-80h-agent). Les ~10 % bloqués EE (billing entier, SSO SAML/OIDC,
> audit "event-logs", workspace EE features) doivent être contournés —
> billing Twenty est intégralement déposé (107/139 fichiers EE) :
> impossible de le réutiliser sans subscription commerciale. Reco
> stratégique billing : OPTION A — ripper entièrement `billing/` et
> piloter Stripe 100 % depuis le Hub, pattern Veridian standard (≈ 20h
> de "déshabillage" propre + smoke). Effort total Vague 11.2 estimé :
> 115-150h-agent solo, soit 3-4 semaines à plein régime.**

---

## 2. Tableau de mapping endpoints (Hub contract §5)

Légende statut :
- ✅ **Existe nativement** : Twenty a un équivalent direct → wrapper REST suffit
- 🟡 **À adapter** : logique proche mais schéma / auth / sémantique divergent → modif modérée
- 🔴 **À créer** : rien d'équivalent → from scratch
- 💀 **Bloqué EE** : la logique upstream vit dans un fichier `@license Enterprise` → réimpl. clean room obligatoire

| # | Endpoint Hub attendu | Auth | Statut | Mapping Twenty | Effort h-agent |
|---|---|---|---|---|---|
| **1** | `POST /api/tenants/provision` | HMAC | 🟡 | `WorkspaceService.activateWorkspace()` (`workspace/services/workspace.service.ts:322-394`) + `SignInUpService.signUpOnNewWorkspace()` (`auth/services/sign-in-up.service.ts:479+`) + `ApiKeyService.create()` (`api-key/services/api-key.service.ts:29-52`). Toute la mécanique métier existe (création workspace, owner, api_key) mais pas exposée en REST sous ce schéma. À écrire : nouveau contrôleur `VeridianHubProvisionController` qui orchestre ces 3 services + retourne le payload contractuel. | **8h** |
| **2** | `POST /api/tenants/update-plan` | HMAC | 🟡💀 | Twenty a `BillingSubscriptionService.cancelSubscription/createSubscription` mais **100 % EE** (`billing/services/*` → 107 fichiers EE). On ne plug PAS sur Twenty billing. À créer côté CRM : table `tenant_plan { workspace_id, plan, plan_source, trial_ends_at, last_hub_sync_at }` + endpoint REST qui valide HMAC + update + appelle `WorkspaceService.suspendWorkspace/restore` selon plan. Décision §5 (option A) : on rip `billing/`. | **8h** |
| **3** | `POST /api/tenants/attach-owner` | HMAC | 🟡 | `UserWorkspaceService.createWorkspaceMember()` (modules user-workspace) + `UserService.findUserByEmail/create()`. Mécanique : trouver user par email, le créer si absent (sans password — Twenty supporte `passwordHash: nullable: true` `user.entity.ts:69-70`), insérer dans `userWorkspace` avec role. Twenty fait déjà ça en interne pour invitations. Wrapper REST à écrire. | **5h** |
| **4** | `POST /api/tenants/suspend` | HMAC | ✅ | `WorkspaceService.suspendWorkspace(id)` (`workspace.service.ts:442-447`) **existe déjà**, écrit `activationStatus = SUSPENDED` + `suspendedAt = NOW()`. Il suffit de l'exposer en REST HMAC + bloquer les writes côté middleware quand `workspace.activationStatus === SUSPENDED`. | **3h** |
| **5** | `POST /api/tenants/resume` | HMAC | 🟡 | **Pas d'endpoint dédié natif**, mais trivial : update `activationStatus = ACTIVE` + `suspendedAt = NULL`. Twenty distingue activation `INACTIVE/PENDING_CREATION/ONGOING_CREATION/ACTIVE/SUSPENDED` (`twenty-shared/workspace/types/WorkspaceActivationStatus.ts`). Le resume doit forcer `ACTIVE` (et idempotent si déjà actif). | **2h** |
| **6** | `GET /api/tenants/{id}/health` | HMAC | 🔴 | Rien d'équivalent natif. Schéma demande : `status, owner_attached, owner_email, owner_user_id, api_key_valid, magic_link_capable, members_count, plan, checked_at`. À écrire : controller qui lit `workspace.activationStatus`, compte `userWorkspace.count()`, vérifie qu'au moins 1 owner existe (workspace n'a pas la notion "owner" — voir §6). | **5h** |
| **7** | `POST /api/workspaces.generateMagicLink` | Bearer api_key | 🟡 | Twenty a `LoginTokenService.generateLoginToken(email, workspaceId, authProvider)` (`auth/token/services/login-token.service.ts:26-50`) qui produit un JWT de type `LOGIN`. Le `computeRedirectURI()` (`auth.service.ts:761-785`) construit l'URL `<subdomain>.<base>/verify?loginToken=...`. **C'est exactement ce qu'il faut**. Wrapper REST à écrire qui : (a) valide Bearer api_key, (b) résout workspace_id depuis api_key, (c) appelle generateLoginToken, (d) construit URL. **Piège** : auth Bearer api_key Twenty = JWT signé (cf `api-key/services/api-key.service.ts:139-173`), pas opaque string. Conflit avec contrat Hub qui veut opaque string. Option : émettre une opaque `hub_api_key` parallèle stockée hash (table dédiée `hub_workspace_api_key { workspace_id, api_key_hash, revoked_at }`) qui ne sert qu'au contrat Hub. | **6h** |
| **8** | `DELETE /api/tenants/{id}` (≈ §5.8.3 purge) | HMAC | ✅ | `WorkspaceService.deleteWorkspace(id, softDelete=false)` (`workspace.service.ts:449-524`) **existe déjà**, fait : delete userWorkspaces, delete DB schema, delete custom domain, delete workspace row. Hard delete complet. Soft delete via `deleteWorkspace(id, true)` qui met `deletedAt`. Wrapper REST simple. **Attention** : le service appelle `billingSubscriptionService.assertSubscriptionCanceledOrNone()` qui est EE → à virer dans le fork. | **4h** |
| **9** | `POST /api/sso/issue-magic-link` | HMAC | 🟡 | Couche 4 du contrat (§6bis.8). C'est l'inverse de #7 (Hub → CRM au lieu de Hub stocke api_key + appelle CRM). Logiquement identique : générer un login token + retourner URL. Réutilise `LoginTokenService.generateLoginToken` + `computeRedirectURI`. Body : `{hub_user_id, email}` — résout workspace_id en cherchant `userWorkspace WHERE userId = (SELECT id FROM user WHERE email = ...)` LIMIT le plus récent. | **5h** |

### Endpoints §5.8 lifecycle complémentaires

| Endpoint | Statut | Mapping | h-agent |
|---|---|---|---|
| `POST /api/tenants/{id}/soft-delete` (§5.8.1) | ✅ | `deleteWorkspace(id, softDelete=true)` (`workspace.service.ts:475-486`) | 2h |
| `POST /api/tenants/{id}/restore` (§5.8.2) | 🟡 | Twenty fait soft-delete via TypeORM `softDelete` → `deletedAt`. Pour restore : `workspaceRepository.restore({id})` (méthode TypeORM standard), passer en `SUSPENDED`. Pas codé nativement. | 3h |
| `POST /api/tenants/{id}/purge` (§5.8.3) | ✅ | `deleteWorkspace(id, false)` = hard delete complet déjà. | (compris dans #8) |
| `POST /api/webhooks/<app>/tenant.touched` (§5.8.4) | 🔴 | Webhook app → Hub. Rien côté Twenty. À créer : middleware qui détecte "session valide sur workspace soft_deleted" + débounce 24h + POST vers Hub. | 4h |
| `GET /api/tenants/{id}/usage-summary` (§5.8.5) | 🔴 | Pas de service Twenty qui agrège `data_volume + activity + domain_specific`. À écrire : count rows custom objects + last login. | 6h |

### Endpoints user/member (§5.12–5.22)

| Endpoint | Statut | Mapping | h-agent |
|---|---|---|---|
| `GET /api/users/by-email` (§5.12 discovery, **app expose**) | 🔴 | Pas d'équivalent. Twenty a `userService.findUserByEmail()` interne. Wrapper REST simple. | 3h |
| `POST /api/tenants/{id}/rotate-api-key` (§5.15) | 🟡 | Twenty a `ApiKeyService.revoke(id, workspaceId)` (`api-key.service.ts:100-104`) + `create()`. Wrapper pour atomicité + grace period 5min. | 4h |
| `POST /api/tenants/{id}/transfer-owner` (§5.16) | 🔴 | Twenty n'a pas la notion d'owner — chaque userWorkspace a un `role` via `RoleTargetEntity` (séparé). Pour "owner" Hub-style : convention "user qui a Role.label = 'Admin' ou défaut workspace". À ajouter colonne `userWorkspace.isWorkspaceOwner BOOLEAN` ou conserver convention "premier user créé". | 6h |
| `POST /api/tenants/{id}/sync-member` (§5.18.3) | 🟡 | Réutilise même mécanique qu'`attach-owner` (#3) — créer user si absent + créer `userWorkspace` row. Différence : role member, pas owner. | 3h |
| `POST /api/veridian/workspaces/{id}/attach-member` (§5.22.2) | 🟡 | Idem `sync-member` — Twenty étant mono-workspace par tenant (1 tenant = 1 workspace), workspace-level et tenant-level se confondent. Implémenter les 2 routes (alias). | 3h |
| `POST /api/tenants/{id}/remove-member` (§5.19.2) | 🟡 | Soft delete `userWorkspace.deletedAt = NOW()`. Twenty a `handleRemoveWorkspaceMember` (workspace.service.ts:465-468). Wrapper REST. | 3h |
| `POST /api/tenants/{id}/restore-member` (§5.20) | 🔴 | `userWorkspaceRepository.restore({...})`. À écrire. | 2h |
| `POST /api/tenants/{id}/freeze-members` (§5.21) | 🔴 | Logique paywall (mode dégradé) côté CRM. Voir §3 (paywall obfusqué). | (dans paywall) |

**Sous-total endpoints HMAC (Hub → CRM) :** **~80h-agent**.

---

## 3. Tableau invariants transverses

| # | Invariant Hub | Statut | Détail / mapping | h-agent |
|---|---|---|---|---|
| 1 | **Auth HMAC §6.1** (`X-Veridian-Timestamp`, `X-Veridian-Hub-Signature`, `crypto.timingSafeEqual`) | 🔴 | Twenty n'a **rien** côté HMAC m2m. Tout est JWT (`JwtAuthStrategy` `auth/strategies/jwt.auth.strategy.ts`). À créer : `HubHmacGuard` NestJS + middleware qui lit raw body (NestJS le buffer par défaut → `app.use(rawBody)`) + `HUB_API_SECRET` env var + drift 5min check. Pattern identique aux apps Veridian existantes (Notifuse Go / Prospection TS). | **6h** |
| 2 | **Modèle d'identité `hub_user_id` §3.7** | 🔴 | Twenty `UserEntity` (`user/user.entity.ts:38-124`) **n'a PAS** de colonne `hub_user_id`. À ajouter : migration TypeORM `ALTER TABLE core.user ADD hub_user_id UUID NULL UNIQUE`. Backfill au premier passage Hub. Index unique partiel. | **4h** |
| 3 | **Idempotency-Key §5.11** | 🔴 | Rien côté Twenty. À créer : table `veridian_idempotency_keys { key PK, response_status, response_body JSONB, expires_at }` + middleware NestJS qui intercepte avant le service. TTL 24h. Cron cleanup. | **5h** |
| 4 | **Lookup user data §5.12** (`GET /api/users/{hub_user_id}` côté Hub + `GET /api/users/by-email` côté app) | 🔴 | Côté CRM (app) : `GET /api/users/by-email` à exposer (cf table endpoints). Côté CRM → Hub : ajouter client HTTP `HubClient.getUserById()` avec cache 15min. | (3h ci-dessus + 3h client) |
| 5 | **i18n / locale §5.13** | ✅ | Twenty supporte 50+ locales dont `fr-FR` (`twenty-server/src/engine/core-modules/i18n/locales/` + `twenty-shared/src/translations/`). `UserEntity.locale` colonne existe (`user.entity.ts:92-94`). `UserWorkspaceEntity.locale` aussi. Au provision Hub passe `metadata.locale = 'fr'` → setter sur user + userWorkspace. **Attention** : Twenty utilise codes ISO 639-1 + region (`fr-FR`), Hub contract veut juste `fr`. Adapter mapping. | **1h** |
| 6 | **Format d'erreurs §5.10** (`{error, message, details}` + table codes) | 🟡 | Twenty utilise des `AuthException` / `WorkspaceException` (`auth/auth.exception.ts`, `workspace/workspace.exception.ts`) avec codes internes. **Format de réponse divergent** : Twenty renvoie en GraphQL format `errors: [{message, extensions: {code}}]` ou en REST format `{statusCode, message, error}` (NestJS standard). À écrire : `VeridianHubExceptionFilter` qui mappe vers le format contractuel uniquement sur les routes `/api/tenants/*` et `/api/veridian/*`. Table codes contractuels (28 codes §5.10) à ajouter en enum. | **5h** |
| 7 | **Rotation api_key §5.15** | 🟡 | Twenty a `apiKeyService.revoke()` + `create()`. Wrapper "rotate" qui : crée nouvelle key, garde l'ancienne valide 5min, planifie revocation. À code. | (4h ci-dessus) |
| 8 | **Transfer ownership §5.16** | 🔴 | Pas de notion "owner" native Twenty (cf table endpoints). Reco : ajouter colonne `userWorkspace.isWorkspaceOwner` ou convention "le user avec `defaultRole = 'Admin'` premier créé". Voir §6 ci-dessous. | (6h ci-dessus) |
| 9 | **Sync membres §5.18 + attach-member §5.22** | 🟡 | Mécaniquement OK via `UserService` + `UserWorkspaceService`. À wrapper. | (compris) |
| 10 | **Permissions cross-app §11bis** | 🟡 | Twenty a son propre système de permissions (`RoleEntity`, `RolePermissionFlagEntity`, `ObjectPermissionEntity`) AGPL. Le Hub contract permet à l'app de garder ses rôles internes (§5.22.4 : "on n'écrase JAMAIS un rôle existant"). Pas besoin de fusionner — juste mapper `role` Hub (`owner/admin/member/viewer`) → `Role` Twenty (lookup par label, fallback "Member"). | **3h** |
| 11 | **Audit log §7 + SAAS-STANDARDS** (GDPR-compliant, append-only) | 🔴 | Twenty `AuditService` (`audit/services/audit.service.ts`) = **product analytics ClickHouse** (pageviews, object events), PAS audit log GDPR. Le module `event-logs/` qui ferait office est **EE-licensed** (cf `AUDIT-LIMITE-EE-TWENTY.md` §C). À créer clean room : table `audit_log { id, tenant_id, actor_type, actor_id, action, target_type, target_id, metadata JSONB, created_at }` + service simple. | **5h** |

**Sous-total invariants :** **~30h-agent**.

---

## 4. Section auth — Plug HMAC sur du Twenty natif (JWT/session)

### Diagnostic

Twenty est **multi-mode auth** :

- **User-session (front)** : JWT (refresh token + access token signés via `JwtWrapperService` avec clé symétrique HS256 ou asymétrique RS256). Strategy `JwtAuthStrategy` (`auth/strategies/jwt.auth.strategy.ts`).
- **API key (m2m externe)** : JWT lui-même (cf `api-key/services/api-key.service.ts:139-173`) avec `type=API_KEY`, `jti=apiKeyId`, expirable. Le client passe `Authorization: Bearer <jwt>` et le serveur valide via JWT signature + lookup `apiKeyMap` cache pour vérifier non révoqué.
- **OAuth (Google / Microsoft / SAML / OIDC)** : Passport strategies dans `auth/strategies/`. SAML + OIDC sont **EE-licensed**. Google + Microsoft sont AGPL.

### Aucune notion native HMAC m2m

Twenty **n'a pas** de pattern HMAC `{ts}.{rawBody}` signé avec secret partagé. Il faut donc l'ajouter en parallèle, sans casser le système JWT existant.

### Plan d'implémentation HMAC

1. **Créer un module `VeridianHubModule`** dans `src/engine/core-modules/veridian-hub/` (clean room, 100 % AGPL Veridian-written) avec :
   - `veridian-hub.module.ts`
   - `guards/hub-hmac.guard.ts` (vérification timestamp drift 5min + HMAC SHA256 timing-safe)
   - `decorators/raw-body.decorator.ts` (récupère le buffer brut depuis `request.rawBody`)
   - `services/hmac-verify.service.ts`
2. **Activer le raw body buffering** dans `main.ts` :
   ```ts
   const app = await NestFactory.create(AppModule, { rawBody: true });
   ```
   (NestJS support natif depuis 9.x via `request.rawBody`).
3. **Tous les controllers `/api/tenants/*` et `/api/veridian/*` sont décorés** `@UseGuards(HubHmacGuard)` + `@UseGuards(IdempotencyKeyGuard)`.
4. **Env vars** : `HUB_API_SECRET` (HMAC), `HUB_WEBHOOK_TOKEN` (Bearer pour les webhooks CRM → Hub), `HUB_API_URL` (`https://app.veridian.site` en prod), `DEPLOY_ENV` (`production|staging|development`).
5. **Mode dev** : `SKIP_HMAC=true` autorisé si `NODE_ENV !== production && NODE_ENV !== staging` (§6.6 du contrat). Garde-fou au boot.

### Garder l'auth Twenty native pour la partie produit (user front)

Le user qui se logge dans l'UI Veridian CRM reçoit toujours un JWT Twenty (`accessToken/refreshToken/workspaceAgnosticToken`). **L'auth HMAC ne concerne que les 9 endpoints Hub-driven**, qui sont strictement m2m et n'ont aucune intersection avec les flows produit. Pas de risque de casser Twenty.

### Login flow user post-bounce (couche 4 du contrat)

Quand le Hub appelle `POST /api/sso/issue-magic-link` :

1. CRM valide HMAC.
2. CRM résout `workspace_id` (le plus récent `userWorkspace` du user identifié par `hub_user_id` OU `email`).
3. CRM appelle `LoginTokenService.generateLoginToken(email, workspaceId, AuthProviderEnum.Password)` (`login-token.service.ts:26`).
4. CRM construit URL `<subdomain>.crm.veridian.site/verify?loginToken=<jwt>` via `computeRedirectURI` (`auth.service.ts:761-785`).
5. CRM retourne `{magic_link_url}` au Hub.
6. Hub `302` user vers cette URL.
7. User atterrit sur `/verify`, Twenty front consomme le `loginToken` → set cookie session JWT Twenty → home.

**Aucune divergence avec Twenty.** On réutilise l'infra existante. Effort : juste écrire le contrôleur REST `/api/sso/issue-magic-link` qui orchestre (5h estimé).

---

## 5. Section billing — Décision 3 options

> ⚠️ **C'est LA grosse décision archi de la Vague 11.2.**

### Contexte

Twenty embarque un **billing intégral autonome** :
- 7 entités DB billing (toutes **EE-licensed**) : `BillingCustomer`, `BillingSubscription`, `BillingSubscriptionItem`, `BillingPrice`, `BillingProduct`, `BillingEntitlement`, `BillingMeter`.
- 12 services Stripe (toutes EE) : `StripeCheckoutService`, `StripeCustomerService`, `StripeWebhookService`, `StripeBillingPortalService`, etc.
- 1 contrôleur webhook Stripe (`billing-webhook/billing-webhook.controller.ts` — non-EE, mais l'ensemble du module qu'il oriente l'est).
- 1 resolver GraphQL billing (EE).
- **Total : 107/139 fichiers EE.**

Le Hub Veridian, lui, est **seul maître Stripe** (§7.4 du CONTRAT-HUB → `CONTRAT-BILLING.md` §2 : "frontière Stripe unidirectionnelle, un seul endpoint `POST /api/webhooks` côté Hub, les apps ne reçoivent jamais de webhook Stripe").

### Option A — Ripper entièrement le billing Twenty (**RECOMMANDÉE**)

**Action** : supprimer du fork `packages/twenty-server/src/engine/core-modules/billing/` + `billing-webhook/` + références dans `workspace.service.ts:476-492`, `workspace.resolver.ts:176-191`, etc.

**Pour** :
- ✅ **Légal propre** : 107 fichiers EE supprimés du build → zéro risque de violation du Commercial License Twenty.com PBC (cf `AUDIT-LIMITE-EE-TWENTY.md` §C "Option propre recommandée").
- ✅ **Pattern Veridian standard** : aligne avec Notifuse/Prospection (le Hub appelle `update-plan` HMAC, l'app stocke `plan` en colonne, écoute, applique).
- ✅ **Pas de double Stripe** : 1 seul abonnement Stripe par client (Hub-side), pas de risque de "alice paie 99€ Hub + 29€ CRM par erreur".
- ✅ **UI propre** : front Twenty ne montrera plus de page "Pricing/Plan" interne — le user voit le pricing Veridian unifié sur Hub Dashboard.
- ✅ **Cohérence trial** : la state machine trial 5-mails / 15j visible / +30j-si-CB (`CONTRAT-BILLING.md` §7) vit côté Hub, pas dupliquée côté CRM.

**Contre** :
- ❌ Coût "déshabillage" : ~15-20h pour virer proprement les imports + tests + références. Tracker `WorkspaceService.deleteWorkspace` qui appelle `billingSubscriptionService.assertSubscriptionCanceledOrNone` (à virer ou no-op).
- ❌ Perd les features billing Twenty "natives" (Stripe checkout intégré, billing portal, entitlements/seats, metering) — mais on les remplace par les features Hub équivalentes (Stripe checkout Hub, billing portal Hub, paywall obfusqué Hub).

**Effort total** : **~20h-agent** (suppression + tests cassés + smoke).

### Option B — Garder le billing Twenty, désactiver le pricing visible

**Action** : laisser les fichiers EE en place (jamais importés en runtime), garder un `billing.module.ts` mock qui retourne `isBillingEnabled() = false` partout. Le Hub continue de piloter via `update-plan` HMAC vers la colonne CRM dédiée.

**Pour** :
- ✅ Pas de "déshabillage" → effort initial réduit (~5h pour faire les bons no-op).

**Contre** :
- ❌ **Légalement glissant** : si les fichiers EE sont compilés dans le bundle Docker (même non-importés), c'est limite "distribution" au sens de la Commercial License. Risque faible mais réel.
- ❌ **Dette technique** : 107 fichiers morts dans le repo. Tout futur upgrade de Twenty upstream impose de re-trier.
- ❌ **Confusion agents** : un futur agent va lire `BillingSubscriptionEntity` et croire que c'est utilisable.

**Effort total** : ~5h initial mais dette continue + risque légal.

### Option C — Hybride : garder la logique plan/quota interne Twenty, désactiver le checkout

**Action** : garder `BillingSubscriptionEntity` (qui store le plan courant côté CRM), virer uniquement la couche Stripe (`stripe-*.service.ts`). Le Hub écrit dans `billingSubscription` via `update-plan` HMAC (mappage `plan` Hub → `BillingPlanKey` Twenty).

**Pour** :
- ✅ Réutilise le modèle de quotas Twenty (`BillingEntitlement` pour les seats par exemple).

**Contre** :
- ❌ **TOUT le module billing est EE-marqué** (cf grep ci-dessus : 7/7 entités, services, utils, resolvers, exceptions, transformers... tous EE). Pour ne garder que les entités, il faudrait **réécrire** ces entités sans le marker — c'est-à-dire copier le schéma, ce qui est explicitement interdit par la Commercial License Twenty.
- ❌ Même résultat fonctionnel que option A mais plus d'effort, plus de risque légal.

**Effort total** : ~25h-agent + risque légal.

### Recommandation finale

> **Option A.** On rip `core-modules/billing/` + `core-modules/billing-webhook/` entièrement. Le Hub est seul maître Stripe (pattern Veridian gravé). Le CRM stocke uniquement une colonne `workspace.plan + plan_source + trial_ends_at + last_hub_sync_at` (clean room AGPL, à créer) et écoute les `update-plan` HMAC.

Cette option respecte le contrat Hub à 100 %, élimine le risque légal EE, et aligne le CRM avec l'architecture Veridian existante. Robert a déjà tranché AGPL OK le 2026-05-25 — l'option A est la suite logique.

---

## 6. Section identité user — Mapping `hub_user_id` ↔ `User.id` Twenty

### Mapping de tables

| Hub | Twenty |
|---|---|
| `hub_app.users.id` (UUID) | `core.user.hub_user_id` (UUID, **nullable**, **unique partiel**) — **colonne à ajouter** |
| `hub_app.users.email` | `core.user.email` (unique partiel sur `deletedAt IS NULL`) |
| `hub_app.tenants.id` (UUID) | `core.workspace.id` (UUID — Twenty génère ses propres IDs, donc divergence assumée, on stocke aussi `core.workspace.hub_tenant_id` UUID unique) — **colonne à ajouter** |
| `hub_app.tenant_members` (user ↔ tenant lien) | `core.userWorkspace` (user ↔ workspace lien) |
| `hub_app.tenant_members.role` | Twenty utilise `roleTarget` séparé → mapping via convention (label de role : `Admin` / `Member` / `Viewer`) |

### Migrations DB à créer

```sql
-- Migration Vague 11.2 step 1 : identité Hub
ALTER TABLE core."user" ADD COLUMN "hubUserId" uuid NULL;
CREATE UNIQUE INDEX "IDX_USER_HUB_USER_ID"
  ON core."user" ("hubUserId")
  WHERE "hubUserId" IS NOT NULL AND "deletedAt" IS NULL;

-- Migration step 2 : identité Hub côté workspace
ALTER TABLE core."workspace" ADD COLUMN "hubTenantId" uuid NULL;
CREATE UNIQUE INDEX "IDX_WORKSPACE_HUB_TENANT_ID"
  ON core."workspace" ("hubTenantId")
  WHERE "hubTenantId" IS NOT NULL AND "deletedAt" IS NULL;

-- Migration step 3 : plan billing (option A — clean room)
CREATE TABLE core."veridianWorkspacePlan" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspaceId" uuid NOT NULL UNIQUE REFERENCES core."workspace"("id") ON DELETE CASCADE,
  "plan" text NOT NULL DEFAULT 'free',
  "planSource" text NOT NULL DEFAULT 'manual',
  "trialEndsAt" timestamptz NULL,
  "quotas" jsonb NULL,
  "lastHubSyncAt" timestamptz NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- Migration step 4 : Veridian audit log (clean room — module event-logs Twenty est EE)
CREATE TABLE core."veridianAuditLog" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NULL,
  "actorType" text NOT NULL, -- 'hub' | 'user' | 'system' | 'api_key'
  "actorId" text NULL,
  "action" text NOT NULL,
  "targetType" text NULL,
  "targetId" text NULL,
  "metadata" jsonb NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "IDX_AUDIT_TENANT_CREATED" ON core."veridianAuditLog" ("tenantId", "createdAt" DESC);

-- Migration step 5 : Idempotency keys
CREATE TABLE core."veridianIdempotencyKey" (
  "key" text PRIMARY KEY,
  "responseStatus" int NOT NULL,
  "responseBody" jsonb NOT NULL,
  "expiresAt" timestamptz NOT NULL
);
CREATE INDEX "IDX_IDEMPOTENCY_EXPIRES" ON core."veridianIdempotencyKey" ("expiresAt");

-- Migration step 6 : optionnel — owner column sur userWorkspace
ALTER TABLE core."userWorkspace" ADD COLUMN "isWorkspaceOwner" boolean NOT NULL DEFAULT false;
-- Backfill : isWorkspaceOwner = true pour le premier userWorkspace créé par workspace
-- (à faire dans la migration runtime, pas dans le SQL).
```

### Règles de résolution (alignées §3.7 contrat)

À chaque appel Hub → CRM qui contient `metadata.hub_user_id` + `owner_email` :

1. `SELECT id FROM core.user WHERE hub_user_id = $1 AND deleted_at IS NULL` → si trouvé, use.
2. Sinon `SELECT id FROM core.user WHERE LOWER(email) = LOWER($2) AND deleted_at IS NULL` → si trouvé, `UPDATE core.user SET hub_user_id = $1 WHERE id = $local_id` (backfill atomique).
3. Sinon créer : `INSERT INTO core.user (id, email, hub_user_id, isEmailVerified, locale) VALUES (gen_random_uuid(), $2, $1, true, 'fr')`. Pas de password (Twenty supporte `passwordHash: nullable: true`).

### Sync membres cross-app

Le Hub pousse via `attach-member` (§5.22) ou `sync-member` (§5.18). Le CRM applique localement, **n'écrase JAMAIS un role déjà existant** côté Twenty (cf §5.22.4 contrat). Pour mapper `role` Hub → `Role` Twenty :

| Role Hub | Role Twenty (par convention) |
|---|---|
| `owner` | `Role.label = 'Admin'` + `userWorkspace.isWorkspaceOwner = true` |
| `admin` | `Role.label = 'Admin'` |
| `member` | `Role.label = 'Member'` (role par défaut de la workspace `defaultRoleId`) |
| `viewer` | `Role.label = 'Viewer'` (à créer si absent) |

À implémenter : `RoleService.findOrCreateByLabel(workspaceId, label)`.

---

## 7. Section EE-blocked — Features Hub bloquées par fichiers EE

| Feature Hub contract | Module Twenty équivalent | EE ? | Décision |
|---|---|---|---|
| Billing Stripe (§7.4 + CONTRAT-BILLING) | `core-modules/billing/` (107/139 fichiers EE) | 💀 OUI | Rip complet (Option A §5). Pas de réimpl needed — Hub-only billing. |
| Webhook Stripe handler | `core-modules/billing-webhook/` | 💀 OUI partiellement | Rip (le Hub reçoit les webhooks Stripe, pas le CRM). |
| Audit log GDPR §7 + SAAS-STANDARDS | `core-modules/event-logs/` | 💀 OUI | Clean room : créer `veridianAuditLog` table (cf §6 ci-dessus). |
| SSO SAML/OIDC (couche 4 bonus) | `core-modules/sso/`, `auth/strategies/saml.auth.strategy.ts`, `auth/strategies/oidc.auth.strategy.ts`, `auth/controllers/sso-auth.controller.ts`, `auth/guards/oidc-auth.guard.ts`, `auth/guards/saml-auth.guard.ts` | 💀 OUI (tous) | Pas nécessaire pour Vague 11.2 (le Hub orchestre OAuth Google/Microsoft, le CRM ne fait que `issue-magic-link`). Ignorer ces fichiers. |
| Row-level permissions (RLS) cross-app | `metadata-modules/row-level-permission-predicate/` | 💀 OUI | Pas dans le contrat Hub v1.7. Si Veridian veut RLS plus tard → clean room avec Postgres RLS natif. |
| Custom domain par tenant | `core-modules/dns-manager/` + `core-modules/cloudflare/` | 💀 OUI | Pas dans le contrat. Si besoin client : faire au niveau Dokploy/Traefik direct (pattern Veridian sites vitrines). |
| Enterprise plan validation | `core-modules/enterprise/` | 💀 OUI | Déjà neutralisé (cf `AUDIT-LIMITE-EE-TWENTY.md` patch 1 ligne — limite 5 workspaces virée). Rien d'autre à faire. |
| JWT key rotation cron | `core-modules/jwt/` (partiel EE) | 💀 partiel | À auditer fichier par fichier — la rotation n'est pas obligatoire pour Vague 11.2. |
| Usage tracking pour billing seats | `core-modules/usage/` | 💀 OUI | Pas nécessaire avec Option A (Hub fait le tracking). |
| Workspace EE features (isPasswordAuthBypassEnabled, etc.) | `workspace.entity.ts:248-272` | 🟢 AGPL | Garder, ignorer les flags qu'on n'utilise pas. |

**Conclusion EE-blocked** : aucune feature Hub-contract n'est bloquée à cause de l'EE. **Tout ce qui est EE est soit non-pertinent (SSO/RLS/custom domain hors scope contrat), soit remplacé par une création clean room** (audit log, billing → ripper / Hub-only).

---

## 8. Estimation effort total Vague 11.2 (intégration Hub)

### Breakdown par lot

| Lot | Contenu | h-agent |
|---|---|---|
| **L1 — Auth HMAC + idempotence + format erreurs** | Module `veridian-hub`, HMAC guard, idempotency-key middleware, exception filter REST, env vars, raw-body buffering, SKIP_HMAC dev mode, tests unitaires HMAC | **15h** |
| **L2 — Identity model + migrations** | Migrations TypeORM (hubUserId, hubTenantId, veridianWorkspacePlan, veridianAuditLog, veridianIdempotencyKey, isWorkspaceOwner), backfill script legacy users, tests | **8h** |
| **L3 — Rip billing Twenty (Option A)** | Suppression `core-modules/billing/` + `billing-webhook/`, no-op `WorkspaceService` (lines 476-492 `assertSubscriptionCanceledOrNone`), no-op `Workspace.resolver.ts:176-191` (`billingSubscriptions` resolver), virer imports cassés, tests Twenty existants à mettre à jour ou skip | **20h** |
| **L4 — Endpoints provisioning §5.1–5.5** | provision (8h), update-plan (8h), attach-owner (5h), suspend (3h), resume (2h). Total 26h | **26h** |
| **L5 — Endpoints lifecycle §5.7–5.8** | health (5h), soft-delete (2h), restore (3h), purge (compris dans delete = 4h), touch webhook outbound (4h), usage-summary (6h) | **24h** |
| **L6 — Endpoints magic link §5.6 + §6bis.8** | generateMagicLink Bearer (6h), issue-magic-link HMAC (5h), api_key opaque parallèle + hash table (3h) | **14h** |
| **L7 — Endpoints user/member §5.12–5.22** | users/by-email (3h), rotate-api-key (4h), transfer-owner (6h), sync-member (3h), attach-member (3h), remove-member (3h), restore-member (2h) | **24h** |
| **L8 — Webhooks app → Hub §7** | `HubWebhookEmitter` service avec outbox + retry + bearer token (`tenant.member_added/removed/role_changed`, `tenant.suspended/resumed/soft_deleted/purged`, `tenant.touched`, `tenant.quota_exceeded`) | **10h** |
| **L9 — Paywall obfusqué §5.9** | Middleware NestJS qui obfusque les champs sensibles (33% clear + `•`) sur les routes en lecture quand workspace.activationStatus IN (SUSPENDED, soft_deleted) ou plan/trial insuffisant. Liste fields sensibles par object metadata. | **12h** |
| **L10 — Audit log + i18n + smoke** | Service `veridianAuditLog` + intégration dans tous les endpoints contractuels, mapping locale `fr` ↔ `fr-FR`, tests E2E smoke contrat (HMAC valid/invalid, idempotency replay, plan_source_immutable, etc.) | **15h** |

**Total Vague 11.2 (intégration Hub stricte)** : **~168h-agent**, soit **4 semaines à plein régime** ou **6 semaines avec marges pour bugs Twenty / surprises archi**.

Le ticket original `07-sprint-decomposition.md` prévoyait Vague 11.2 sur ~8 semaines/14 agents cumul. Cet audit confirme qu'on est **dans le budget** mais que c'est tendu — pas de scope creep (pas de SSO SAML, pas de RLS, pas de custom domain).

### Hors scope Vague 11.2 (à reporter)

- **Sync membres niveau 3** (cron reconcile Hub→app) : roadmap V1.6+ du contrat, pas bloquant.
- **Quota seats freeze §5.21** : implémentable plus tard quand Robert aura ≥ 2 clients multi-membres.
- **Webhook user.updated** (§5.12.3) : non bloquant si cache 15min côté CRM.
- **Optimistic locking If-Match** (§14.4) : non obligatoire au lancement.

---

## 9. Risques identifiés

### R1 — Casse de l'archi méta-modèle Twenty par les migrations

Twenty utilise un système de workspace schema dynamique (chaque workspace a son propre Postgres schema avec ses tables custom). Les migrations Veridian touchent **uniquement le schema `core`** (table user, workspace, userWorkspace) et **ajoutent de nouvelles tables** (`veridian*`). Aucun risque de conflit avec le méta-modèle. **Risque : faible.**

### R2 — `WorkspaceService.deleteWorkspace` couple billing EE

`workspace.service.ts:476-492` appelle `billingService.isBillingEnabled()` et `billingSubscriptionService.cancelSubscription/assertSubscriptionCanceledOrNone`. Si on rip billing/, ces calls cassent. Solution : remplacer par des no-op (`isBillingEnabled() = false` toujours, méthodes stub). Mais c'est de la **modification de code AGPL existant**, donc à committer dans le fork. **Risque : moyen → mitigable, juste à coder proprement.**

### R3 — Conflit api_key Twenty (JWT) vs api_key Hub (opaque)

Twenty utilise un JWT signé comme api_key. Le Hub contract attend une string opaque hashée. Solution : table parallèle `hub_workspace_api_key { workspace_id, api_key_hash bcrypt, revoked_at }` qui ne sert qu'au contrat Hub. L'api_key Twenty native (JWT) continue d'exister pour les autres usages (Apps internes Twenty). **Risque : faible → 2 systèmes coexistent sans interférer.**

### R4 — Double Stripe customer si client paye sur Hub + check Twenty active billing

Si on garde le module billing Twenty (option B/C), un client qui paye le Hub aurait potentiellement aussi une row `BillingCustomer` Twenty créée par un trigger auto. **Mitigation** : Option A (rip) règle le problème définitivement. **Risque : éliminé avec option A.**

### R5 — Twenty upstream casse le contrat à un upgrade

Si Veridian sync régulièrement avec `twentyhq/twenty` (rebase fork), un upstream peut changer la signature de `WorkspaceService.suspendWorkspace`, casser `LoginTokenService`, ou bouger des fichiers. Solution : **freeze le fork** sur le commit `1188ea9c` (audit baseline) ou planifier un rebase mensuel avec tests E2E contractuels. **Risque : moyen sur 6 mois → à monitorer.**

### R6 — Format d'erreurs divergent côté front

Twenty front consomme du GraphQL. Les erreurs viennent en `errors[].extensions.code`. Les nouveaux endpoints REST `/api/tenants/*` retournent `{error, message, details}` (format Hub contract). **Pas de risque côté front** (le front n'appelle JAMAIS ces endpoints — ce sont des routes m2m Hub→CRM).

### R7 — Locale `fr` vs `fr-FR`

Twenty utilise `fr-FR` (clé `APP_LOCALES`), Hub contract veut `fr`. Mismatch silencieux possible si on ne mappe pas explicitement. **Risque : faible → fonction de mapping 5 lignes.**

### R8 — Performance HMAC sur raw body

NestJS doit buffer le raw body pour vérifier HMAC. Si un body est gros (sync-member en batch ?), le buffering peut augmenter latence + RAM. **Mitigation** : limiter `Content-Length` max 1MB sur les routes `/api/veridian/*` + tests perf. **Risque : faible — les payloads contractuels sont petits.**

### R9 — Workspace ≠ Tenant 1:1 vraiment ?

Twenty est **mono-workspace par compte** par défaut (sauf `IS_MULTIWORKSPACE_ENABLED`). Le contrat Hub considère 1 tenant = 1 workspace côté CRM (cf §5.22.5 "Notifuse mono-workspace"). Donc on est aligné. **Mais** : si Veridian CRM active multi-workspace plus tard (un user humain a plusieurs workspaces dans le CRM = plusieurs "tenants" Hub), le mapping devient 1 user Hub → N tenants CRM. **Décision** : démarrer mono-workspace (équivalent Notifuse), évaluer le passage multi quand un client le demande. **Risque : moyen long terme → à graver dans `08-questions-ouvertes.md` Q14.**

### R10 — `Workspace.subdomain` URL routing imposera DNS Veridian

Twenty calcule l'URL d'un workspace via `workspace-domains.service.ts:27-45` à partir de `workspace.subdomain` + `FRONTEND_URL`. En prod Veridian, on devra :
- Soit utiliser `IS_MULTIWORKSPACE_ENABLED=false` → workspace unique, accessible via `crm.veridian.site` (pas de subdomain par tenant)
- Soit DNS wildcard `*.crm.veridian.site → IP CRM` + Traefik route par `Host:` header.

**Décision Vague 11.2** : démarrer single-workspace (mode `IS_MULTIWORKSPACE_ENABLED=false`). Si plus tard plusieurs workspaces par tenant (multi-org pour le même user) → activer multi + wildcard DNS. **Risque : faible → param config existant.**

---

## 10. Synthèse pour Robert (TL;DR)

1. **Twenty respecte le contrat Hub à 10 % nativement** (workspace ≈ tenant, magic link via LoginToken, soft-delete, suspend, hard-delete cascade). C'est le bon socle.
2. **30 % à adapter** : wrapper REST HMAC autour de services Twenty existants (provision, attach-owner, generateMagicLink, etc.). Pas de réécriture — juste exposer en REST + Bearer/HMAC.
3. **50 % à créer from scratch** : HMAC m2m, identité `hub_user_id`, idempotency, lifecycle Veridian 5-états, paywall obfusqué, audit log, trial state machine, plan_source. Clean room AGPL, ~110h.
4. **10 % bloqué EE** : entièrement la stack billing Stripe (107/139 fichiers EE). **Reco : Option A — ripper.** Le Hub est seul maître Stripe (pattern Veridian standard). Effort suppression : ~20h.
5. **Effort total Vague 11.2** : **~168h-agent (~4 semaines plein régime / ~6 semaines réalistes)**. Dans le budget du sprint `07-sprint-decomposition.md`.
6. **Pas de showstopper** : aucun verrou architectural infranchissable. Twenty est compatible Veridian au prix d'un module `veridian-hub` à coder et d'un déshabillage billing.
7. **Risque légal** : zéro avec Option A (rip billing EE). Cf `AUDIT-LIMITE-EE-TWENTY.md` pour le cadre AGPL global.
8. **Action immédiate post-audit** : (a) trancher Option A billing avec Robert (recommandé), (b) ouvrir tickets Vague 11.2 par lot L1→L10, (c) freeze fork sur commit `1188ea9c` jusqu'à fin Vague 11.2.

---

## Annexes

### A. Fichiers Twenty AGPL clés pour Vague 11.2 (à wrapper ou étendre)

- `packages/twenty-server/src/engine/core-modules/workspace/services/workspace.service.ts` (869 lignes, AGPL)
- `packages/twenty-server/src/engine/core-modules/workspace/workspace.entity.ts` (workspace columns)
- `packages/twenty-server/src/engine/core-modules/user/user.entity.ts` (`passwordHash: nullable: true`, locale, deletedAt)
- `packages/twenty-server/src/engine/core-modules/user-workspace/user-workspace.entity.ts` (composite unique index, soft delete)
- `packages/twenty-server/src/engine/core-modules/auth/services/sign-in-up.service.ts` (signUpOnNewWorkspace ligne 479+)
- `packages/twenty-server/src/engine/core-modules/auth/services/auth.service.ts:761` (computeRedirectURI)
- `packages/twenty-server/src/engine/core-modules/auth/token/services/login-token.service.ts` (entire — 70 lignes AGPL)
- `packages/twenty-server/src/engine/core-modules/api-key/services/api-key.service.ts` (entire — AGPL)
- `packages/twenty-server/src/engine/core-modules/api-key/api-key.entity.ts` (entity simple, 43 lignes)
- `packages/twenty-server/src/engine/core-modules/app-token/app-token.entity.ts` (universal token, AGPL — `AppTokenType` enum extensible)
- `packages/twenty-server/src/engine/core-modules/workspace-invitation/services/workspace-invitation.service.ts` (généré tokens cryptographiques pour invitation)
- `packages/twenty-server/src/engine/core-modules/i18n/i18n.service.ts` (50+ locales)
- `packages/twenty-server/src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service.ts` (URL building par subdomain)
- `packages/twenty-shared/src/workspace/types/WorkspaceActivationStatus.ts` (`INACTIVE/PENDING_CREATION/ONGOING_CREATION/ACTIVE/SUSPENDED`)

### B. Fichiers EE à NE PAS toucher (référence)

- `packages/twenty-server/src/engine/core-modules/billing/**` (107 fichiers — rip en Vague 11.2 option A)
- `packages/twenty-server/src/engine/core-modules/sso/**`
- `packages/twenty-server/src/engine/core-modules/enterprise/**`
- `packages/twenty-server/src/engine/core-modules/cloudflare/**`
- `packages/twenty-server/src/engine/core-modules/dns-manager/**`
- `packages/twenty-server/src/engine/core-modules/event-logs/**`
- `packages/twenty-server/src/engine/core-modules/usage/**`
- `packages/twenty-server/src/engine/metadata-modules/row-level-permission-predicate/**`
- `packages/twenty-server/src/engine/metadata-modules/flat-row-level-permission-predicate/**`
- `packages/twenty-server/src/engine/core-modules/auth/controllers/sso-auth.controller.ts`
- `packages/twenty-server/src/engine/core-modules/auth/strategies/saml.auth.strategy.ts`
- `packages/twenty-server/src/engine/core-modules/auth/strategies/oidc.auth.strategy.ts`
- `packages/twenty-server/src/engine/core-modules/auth/guards/saml-auth.guard.ts`
- `packages/twenty-server/src/engine/core-modules/auth/guards/oidc-auth.guard.ts`
- `packages/twenty-server/src/engine/core-modules/auth/guards/enterprise-features-enabled.guard.ts`

### C. Lien tickets à ouvrir post-audit

- `veridian-crm/todo/2026-05-26-vague-11-2-L1-auth-hmac-idempotence.md`
- `veridian-crm/todo/2026-05-26-vague-11-2-L2-identity-migrations.md`
- `veridian-crm/todo/2026-05-26-vague-11-2-L3-rip-billing-twenty.md` (P0 — bloque L4+)
- `veridian-crm/todo/2026-05-26-vague-11-2-L4-provisioning-endpoints.md`
- `veridian-crm/todo/2026-05-26-vague-11-2-L5-lifecycle-endpoints.md`
- `veridian-crm/todo/2026-05-26-vague-11-2-L6-magic-link-endpoints.md`
- `veridian-crm/todo/2026-05-26-vague-11-2-L7-user-member-endpoints.md`
- `veridian-crm/todo/2026-05-26-vague-11-2-L8-webhooks-app-to-hub.md`
- `veridian-crm/todo/2026-05-26-vague-11-2-L9-paywall-obfuscation.md`
- `veridian-crm/todo/2026-05-26-vague-11-2-L10-audit-i18n-smoke.md`

Plus :
- `veridian-crm/todo/2026-05-26-decision-billing-option-A-rip.md` (P0 — décision business Robert avant L3)
- `veridian-crm/todo/2026-05-26-fork-freeze-1188ea9c.md` (P1 — gel upstream pendant Vague 11.2)

### D. Commandes de vérif EE rapides

```bash
# Compter EE par module
grep -rln "@license Enterprise" packages/twenty-server/src/engine/core-modules/billing/ | wc -l   # 107
grep -rln "@license Enterprise" packages/twenty-server/src/engine/core-modules/auth/ | wc -l     # 10 (SSO/SAML/OIDC)
grep -rln "@license Enterprise" packages/twenty-server/src/engine/core-modules/workspace/ | wc -l # 0
grep -rln "@license Enterprise" packages/twenty-server/src/engine/core-modules/user/ | wc -l     # 0
grep -rln "@license Enterprise" packages/twenty-server/src/engine/core-modules/user-workspace/ | wc -l # 0
grep -rln "@license Enterprise" packages/twenty-server/src/engine/core-modules/api-key/ | wc -l  # 0
grep -rln "@license Enterprise" packages/twenty-server/src/engine/core-modules/audit/ | wc -l    # 0 (mais !=audit GDPR Hub)
grep -rln "@license Enterprise" packages/twenty-server/src/engine/core-modules/i18n/ | wc -l     # 0
```

### E. Headers HTTP cibles pour le module `veridian-hub`

Request (Hub → CRM, HMAC) :
```
POST /api/tenants/provision HTTP/1.1
Host: crm.veridian.site
X-Veridian-Timestamp: 1747857600000
X-Veridian-Hub-Signature: 7d3a8b9c2e4f...
Idempotency-Key: 8f4a-2b3c-...
Content-Type: application/json
```

Response success (CRM → Hub) :
```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "tenant_id": "uuid",
  "workspace_id": "uuid",
  "owner_user_id": "uuid",
  ...
  "contract_version": "1.7"
}
```

Response error format §5.10 :
```
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "error": "unauthorized",
  "message": "HMAC signature invalid",
  "details": {}
}
```

---

**Fin du rapport. Bonne lecture, Robert. Prête à attaquer Vague 11.2 dès que tu valides Option A billing.**
