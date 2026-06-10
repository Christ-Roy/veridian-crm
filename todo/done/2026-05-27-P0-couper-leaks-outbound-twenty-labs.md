# 🔴 P0 — Couper TOUS les leaks outbound vers Twenty Labs (et tiers)

> **Sévérité** : 🔴 P0
> **Owner** : agent veridian-crm
> **Créé** : 2026-05-27
> **Découvert pendant** : session migration Prospection → Twenty (2026-05-27, Robert + agent admin-twenty)

## TL;DR

Le fork Twenty contient **plusieurs canaux outbound non documentés** qui envoient de la data Veridian (et data des clients/prospects de Veridian) vers `twenty-telemetry.com`, `twenty-companies.com`, `unpkg.com`, `registry.npmjs.org`, `models.dev`, `twenty.com`. Audit fait fichier par fichier. Tout est listé ci-dessous avec le `file:line` exact.

**1 leak CRITIQUE encore actif au moment de l'écriture du ticket** :
- `twenty-companies.com` reçoit le **domaine de CHAQUE Company créée** dans Twenty (= ton lead/client). Les **57 domaines** des leads chauds migrés cet aprem ont déjà fuité. URL **hardcodée**, pas d'ENV flag pour la couper.

**1 leak ROUTINIER déjà coupé** :
- ✅ Télémétrie `user_signup` → `twenty-telemetry.com` : coupée 2026-05-27 16:48 via `TELEMETRY_ENABLED=false` sur Dokploy compose `veridian-crm-prod` (composeId `8zdqAAD1lkZFVAwuZ5USv`). Avant ça, 3 emails ont fuité (robert.brunon@veridian.site, guilhem.jacquet1@gmail.com, brunon5robert@gmail.com) + URL `crm.app.veridian.site`.

**Plusieurs autres leaks meta** dormants ou conditionnels (Sentry AI, npmjs, unpkg, models.dev, twenty.com EE validation).

---

## 🎯 Objectif

À la fin du ticket :
1. **Zéro requête sortante** vers `twenty-telemetry.com`, `twenty-companies.com`, `app.twenty.com`, `twenty.com/api/*`.
2. **Conditionnel** : couper aussi `unpkg.com`, `registry.npmjs.org`, `models.dev` SI Robert ne veut PAS la fonctionnalité marketplace/AI providers catalog (à confirmer avec lui — par défaut, couper).
3. **Test e2e** qui sniffe les sockets sortantes au boot + au signup + à la création d'une Company + à un init AI provider, et fail si une connexion vers les domaines blacklistés apparaît.
4. **Rebrand emails** : remplacer les images `app.twenty.com/images/...` par des assets Veridian self-hosted (sinon chaque mail envoyé ping Twenty Labs côté client mail = pixel tracking involontaire).
5. **Documentation** : tableau récap dans `docs/spec/AUDIT-OUTBOUND-LEAKS.md` (fichier nouveau à créer) avec chaque canal, état (coupé / actif / désactivé), fichier:ligne, ENV/patch utilisé.
6. **Patch upstreamable** : structure le code pour qu'on puisse facilement re-tirer les modifs si on veut un jour suivre upstream Twenty. Préfère ENV flags > guard conditionnels > suppression fichiers, dans cet ordre.

---

## 📋 Plan d'action par leak (ordre de priorité)

### 🔴 P0-A — Bloquer `twenty-companies.com` (leak active des domaines clients/prospects)

**Source du leak** :
- `packages/twenty-shared/src/constants/TwentyCompaniesBaseUrl.ts:1` → `export const TWENTY_COMPANIES_BASE_URL = 'https://twenty-companies.com';`
- Consommé dans `packages/twenty-server/src/modules/contact-creation-manager/services/create-company.service.ts:40-42` et `:253`
- Trigger : à **chaque** création de Company via Twenty (manuel UI, import calendar, import messaging, lead matching). Le service tape `GET https://twenty-companies.com/{domainName}` pour récupérer name + city + logo.
- **57 fuites confirmées** ce 2026-05-27 lors de la migration Prospection (domaines `avse-monetique.fr`, `technic-pro.fr`, `castan-sports.fr`, etc.)

**Patch suggéré** :
1. Lire `head -3` des 2 fichiers concernés — confirmer qu'ils sont AGPL (pas `@license Enterprise`).
2. Ajouter ENV `TWENTY_COMPANIES_ENRICHMENT_ENABLED=false` dans `packages/twenty-server/src/engine/core-modules/twenty-config/config-variables.ts` (chercher où sont déclarées les autres ENV de feature flag, type `IS_ANALYTICS_ENABLED`).
3. Dans `create-company.service.ts`, autour de `:40-42` et `:253`, wrap l'appel HTTP dans un `if (this.twentyConfigService.get('TWENTY_COMPANIES_ENRICHMENT_ENABLED'))` qui retourne `null` / stub si désactivé.
4. Poser `TWENTY_COMPANIES_ENRICHMENT_ENABLED=false` en ENV Dokploy compose prod (via API `compose.update` + `compose.deploy`).
5. Vérifier que le code en aval gère bien le cas "pas d'enrichissement" — la Company doit juste être créée avec les champs fournis par l'utilisateur, sans hydratation externe.

**Critère d'acceptance** :
- `tcpdump -i any host twenty-companies.com` sur le container `compose-parse-optical-array-lvh5md-crm-server-1` pendant qu'on crée 5 Companies de test → 0 paquet.

---

### 🔴 P0-B — Désactiver Sentry AI input/output recording

**Source** :
- `packages/twenty-server/src/instrument.ts:38-41` → `Sentry.vercelAIIntegration({ recordInputs: true, recordOutputs: true })`
- `packages/twenty-server/src/engine/metadata-modules/ai/ai-models/constants/ai-telemetry.const.ts` → `AI_TELEMETRY_CONFIG = { recordInputs: true, recordOutputs: true }`
- Utilisé dans 6 services AI : `chat-execution.service.ts`, `agent-async-executor.service.ts`, `agent-title-generation.service.ts`, `agent-turn-grader.service.ts`, `repair-tool-call.util.ts`, `ai-agent-monitor/services/agent-turn-grader.service.ts`
- Trigger : si `SENTRY_DSN` est défini (actuellement vide → no-op). **Mais si Robert active Sentry un jour, tous les prompts AI (input + output) fuitent.**

**Patch suggéré** :
1. Passer `recordInputs: false, recordOutputs: false` dans `instrument.ts:38-41`.
2. Idem dans `ai-telemetry.const.ts`.
3. Vérifier qu'aucun test ne teste la présence de ces champs (sinon updater le test).

**Critère d'acceptance** :
- Activer temporairement `SENTRY_DSN=https://dummy@sentry.io/dummy`, exécuter une requête AI chat, vérifier que les events Sentry ne contiennent **pas** le payload du prompt.
- Puis remettre `SENTRY_DSN=` vide.

---

### 🟡 P1-A — Couper le cron `MarketplaceCatalogSyncCronJob` (ping npmjs.org/h)

**Source** :
- `packages/twenty-server/src/engine/core-modules/application/application-marketplace/marketplace.service.ts:113` → `https://registry.npmjs.org/-/v1/search?text=keywords:twenty-app&size=250`
- Cron pattern `'0 * * * *'` (toutes les heures) dans `marketplace-catalog-sync.cron.job.ts`
- Default `APP_REGISTRY_URL` dans `config-variables.ts:1764`
- Trigger : cron silencieux, expose User-Agent `Twenty-Marketplace` + IP serveur Veridian à npm Inc.

**Patch suggéré** : 2 options selon ce que veut Robert :
- **Option A (recommandée)** : si Veridian ne veut pas exposer un marketplace d'apps à ses tenants → désactiver le cron complètement (commenter dans `core-engine.module.ts` ou poser `APP_REGISTRY_URL=`).
- **Option B** : si on veut garder la feature marketplace mais avec notre propre registry → fork un registry mirror sur `r2-veridian.cloudflare.com` et pointer `APP_REGISTRY_URL=https://r2-veridian.../`. (Gros chantier, à reporter.)

→ **À demander à Robert avant patch.**

---

### 🟡 P1-B — Couper le cron `ApplicationVersionCheckCronJob` (ping npmjs.org/6h)

**Source** :
- `packages/twenty-server/src/engine/core-modules/application/application-upgrade/application-upgrade.service.ts:51`
- Cron `'0 */6 * * *'`
- User-Agent `Twenty-AppUpgrade`
- **Pas de leak tant que la table `ApplicationRegistration` est vide.** Vérifier qu'elle l'est : `SELECT COUNT(*) FROM core."applicationRegistration"` dans Postgres prod.

**Patch suggéré** : idem P1-A, désactivation du cron en attendant qu'on prenne une décision marketplace.

---

### 🟡 P1-C — Couper `unpkg.com` CDN pour app manifests

**Source** :
- `marketplace.service.ts:57, 89` → `https://unpkg.com/...`
- Default `APP_REGISTRY_CDN_URL` dans `config-variables.ts:1774`

**Patch suggéré** : `APP_REGISTRY_CDN_URL=` vide ou pointer vers notre R2.

→ Lié à la décision marketplace (P1-A/B).

---

### 🟡 P1-D — Couper `models.dev` (AI providers catalog)

**Source** :
- `packages/twenty-server/src/engine/metadata-modules/ai/ai-models/services/models-dev-catalog.service.ts:113`
- Constante `models-dev.const.ts:1` → `https://models.dev/api.json`
- Trigger : ouverture settings AI providers (cache 24h)
- Leak : juste IP serveur + User-Agent (pas de PII)

**Patch suggéré** : ajouter ENV `AI_MODELS_CATALOG_URL=` (vide = catalog statique embedded fallback). Vérifier qu'il existe un fallback sinon en créer un avec la liste OpenAI/Anthropic/Mistral hardcodée à jour à fin 2026-05.

→ Faible priorité, leak meta uniquement.

---

### 🟢 P2 — Validation Enterprise key vers `twenty.com/api/enterprise/*`

**Source** :
- `enterprise-plan.service.ts:227, 281, 328, 388, 427` → 5 endpoints `twenty.com/api/enterprise/{validate,seats,status,portal,checkout}`
- Default `ENTERPRISE_API_URL` dans `config-variables.ts:1594`
- Trigger : **seulement si** `ENTERPRISE_KEY` est définie. Pour Veridian = **jamais** (on n'achète pas EE).
- Cron `enterprise-key-validation.cron.job.ts` qui gate sur `isValid()` → no-op sans clé.

**Patch suggéré** : **rien à faire**, c'est inactif tant qu'on n'a pas de clé EE. À documenter quand même pour traçabilité dans `AUDIT-OUTBOUND-LEAKS.md`.

---

### 📧 P2 — Rebrand images emails (leak pixel tracking côté destinataires)

**Source** :
- `packages/twenty-emails/src/components/Logo.tsx:10` → `https://app.twenty.com/images/icons/windows11/...`
- `packages/twenty-emails/src/utils/DefaultWorkspaceLogo.ts:2`
- Trigger : à chaque ouverture d'email envoyé par Twenty CRM côté destinataire. Twenty Labs reçoit l'IP du destinataire (≈ pixel tracking involontaire).

**Patch suggéré** :
1. Upload logo Veridian (déjà existant dans AssetBank — utiliser le skill `assets`) sur R2 → URL stable type `https://assets.veridian.site/email/veridian-logo.png`.
2. Remplacer les 2 fichiers ci-dessus pour pointer vers cette URL.
3. Vérifier qu'aucun autre template `*.email.tsx` dans `packages/twenty-emails/src/emails/` ne ping `app.twenty.com`.
4. Test : `mailpit` sur staging → ouvrir un email envoyé → inspecter le HTML → 0 occurence de `twenty.com` dans les `src="..."` d'images.

---

### ✅ Déjà fait

- ✅ `TELEMETRY_ENABLED=false` posée en ENV Dokploy compose `veridian-crm-prod` (composeId `8zdqAAD1lkZFVAwuZ5USv`) le 2026-05-27 vers 16:48 par Robert + agent admin-twenty.
- ✅ Audit complet réalisé par agent Opus, sorties détaillées disponibles dans la session admin-twenty 2026-05-27.

---

## 🔴 Deuxième passe audit (2026-05-27 — Robert a demandé "creuser pour de vrai")

Robert a relu et fait la nuance entre **appels légitimes pull-catalogue** (npm/unpkg/models.dev = ok-ish) et **POST/GET-with-data qui exfiltrent vraiment** (= les trucs à creuser). Spawn d'un 2e agent Opus avec mission ciblée "trouve les trucs tordus que le 1er audit a ratés". Résultat = 3 trouvailles nouvelles :

### 🔴 P0-C — Bloquer `twenty-help-search.com` (queries user en clair)

**Source** :
- `packages/twenty-server/src/engine/core-modules/tool/tools/search-help-center-tool/search-help-center-tool.ts:38-52`
```ts
const endpoint = useDirectApi
  ? `https://api-dsc.mintlify.com/v1/search/${MINTLIFY_SUBDOMAIN}`
  : 'https://twenty-help-search.com/search/twenty';
const response = await httpClient.post(endpoint, { query, pageSize: 10 }, { headers });
```
- Trigger : à chaque saisie dans la search "help center" du CRM côté user (composant front, déclenche un POST server-side qui forward vers Twenty Labs OU Mintlify selon config).
- Donnée : la **query texte en clair** saisie par le user. Risque réel : un commercial qui cherche "comment supprimer Christian Paris" → Twenty Labs sait que tu travailles avec un certain Christian Paris.

**Patch suggéré** :
1. Retirer `SearchHelpCenterTool` de la registry MCP/tool module → l'agent IA ne pourra plus l'utiliser.
2. Vérifier qu'il n'y a pas un composant React frontend qui appelle directement cet endpoint via un autre chemin.
3. ENV idéale : `HELP_CENTER_SEARCH_ENABLED=false` à câbler.

**Critère acceptance** : 0 paquet vers `twenty-help-search.com` ni `api-dsc.mintlify.com` sur 1 semaine d'usage prod.

---

### 🟡 P1-E — Supprimer iframe TradingView du dashboard par défaut

**Source** :
- `packages/twenty-server/src/engine/workspace-manager/twenty-standard-application/utils/page-layout-widget/compute-my-first-dashboard-widgets.util.ts:549`
```ts
url: 'https://www.tradingview.com/embed-widget/hotlists/?locale=en',
```
- Trigger : seed automatique du "premier dashboard" d'un nouveau workspace ou nouveau user → iframe TradingView chargée dans le navigateur du commercial Veridian.
- Donnée : IP + cookies + User-Agent du commercial leakés à TradingView (entreprise tierce non liée à Twenty Labs, mais c'est quand même un leak réseau côté client final).

**Patch suggéré** :
1. Trouver la fonction `createStockMarketIframe` dans `compute-my-first-dashboard-widgets.util.ts` (chercher entre lignes 542-595).
2. Soit la supprimer du tableau de widgets seed, soit remplacer l'URL par un widget interne Veridian (CA mensuel, pipeline value, etc.).
3. Pour les workspaces existants : pas d'action — les widgets sont déjà persistés en DB par user, ce patch n'affecte que les NOUVEAUX workspaces.

**Critère acceptance** : nouveau workspace → 0 chargement iframe `tradingview.com` dans le DevTools réseau du browser.

---

### 🔴 P0-D — Patcher Sentry `sendDefaultPii: false` + `recordInputs/Outputs: false`

**Source** :
- `packages/twenty-server/src/instrument.ts:38-46`
```ts
Sentry.vercelAIIntegration({
  recordInputs: true,
  recordOutputs: true,
}),
nodeProfilingIntegration(),
],
tracesSampleRate: 0.1,
profilesSampleRate: 0.3,
sendDefaultPii: true,  // ← AUSSI ÇA, pas juste les AI inputs
```

C'est encore PIRE que ce qu'on avait noté en P0-B :
- `sendDefaultPii: true` → Sentry reçoit **IP + email user + headers** sur **chaque erreur**, pas juste les AI calls
- `recordInputs/Outputs: true` → tous les prompts AI en bonus

**Trigger** : actif dès que `SENTRY_DSN` est posée. Actuellement vide → dormant. Mais si quelqu'un l'active un jour pour debug, **tout fuit**.

**Patch suggéré** :
1. `sendDefaultPii: false` (ligne ~46 de instrument.ts)
2. `recordInputs: false, recordOutputs: false` (lignes 39-40)
3. Idem dans `ai-telemetry.const.ts` (`AI_TELEMETRY_CONFIG`).
4. Test : poser `SENTRY_DSN=https://dummy@sentry.io/dummy`, déclencher une erreur volontaire, vérifier que le payload Sentry est **vide de PII**.

**Critère acceptance** : payload Sentry inspectable ne contient ni email, ni IP, ni prompt AI.

---

### Ce qui a été creusé et est PROPRE (à laisser tel quel)

L'agent 2 a passé en revue tous ces points et **n'a trouvé aucun autre leak** :

- ✅ Les 19 fichiers `*.cron.job.ts` : seuls les 2 connus (marketplace, app-upgrade) sortent
- ✅ Tous les `@OnEvent / @OnCustomBatchEvent / @OnDatabaseBatchEvent` : seul `TelemetryListener` exfiltre, les autres servent la queue webhook user-définie (légitime)
- ✅ MCP server custom : pas de phone-home, juste serve les requêtes entrantes
- ✅ AdminPanel version check vers `hub.docker.com/v2/repositories/twentycrm/twenty/tags` : GET catalog, juste IP serveur leak, **garder ou court-circuiter selon goût** (proposé P3)
- ✅ E2B CodeInterpreter : dormant tant que `E2B_API_KEY` absente. À documenter en runbook si jamais activé un jour (code + fichiers uploadés iraient chez e2b.dev).
- ✅ OTLP exporter : opt-in via `METER_DRIVER=OpenTelemetry`, pas de défaut Twenty
- ✅ AWS SNS confirm : filtré par regex `sns.*.amazonaws.com`, légitime
- ✅ Pas de Datadog, NewRelic, Posthog, Mixpanel, Amplitude, Segment, Honeybadger, Bugsnag, Rollbar
- ✅ Pas de pixel-tracking ni heartbeat ni installationId au-delà de la télémétrie connue
- ✅ Pas d'autre POST que ceux listés

### P3 — Cosmétique rebrand (pas privacy mais à faire)

`packages/twenty-server/src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-workflows.util.ts:465,472` contient des valeurs par défaut `https://twenty.com` et `twenty.com` dans un workflow demo. Remplacer par `veridian.site` quand on fera la passe rebrand globale.

---

## 🛠️ Méthodologie de patch (à respecter)

### Règle d'or AGPL

**Avant chaque `Edit` sur un fichier Twenty existant** : `head -3 <file>` pour vérifier que ce n'est **PAS** un fichier `/* @license Enterprise */`. Si tu vois ce header → **ne modifie pas**, cherche un autre angle (overrider via NestJS module decorator, intercepter via middleware, ou ENV gate côté caller).

Les fichiers cités dans ce ticket sont tous AGPL d'après l'audit. À reconfirmer par toi.

### Préférence patchs ENV > guard > suppression

1. **Préférer ENV flag** (`FEATURE_X_ENABLED=false`) à un patch dur — ça reste rebasable sur upstream Twenty.
2. **Si pas de flag possible**, ajouter un guard early-return dans la méthode concernée avec un commentaire `// Veridian: disabled outbound to twenty-companies.com (see todo/2026-05-27-P0-...)`.
3. **Ne jamais supprimer un fichier entier** sauf si vraiment inutilisé. Préfère désactiver le module dans `core-engine.module.ts`.

### Test e2e à câbler

Créer `packages/twenty-server/test/integration/no-outbound-leaks.e2e-spec.ts` qui :
1. Boot l'app.
2. Démarre un `nock.disableNetConnect()` avec `nock.enableNetConnect((host) => allowlist(host))`.
3. Allowlist : seulement `localhost`, `127.0.0.1`, `postgres` (DB), `redis`, et les domaines de tes vrais providers OAuth/email (Brevo, Lark, Google APIs si activé).
4. Trigger des actions : signup, créer Company, créer Person, init AI provider.
5. **Fail** si une requête vers `twenty-telemetry.com`, `twenty-companies.com`, `app.twenty.com`, `twenty.com`, `unpkg.com`, `npmjs.org`, `models.dev` est tentée.

### Documenter

Créer `docs/spec/AUDIT-OUTBOUND-LEAKS.md` avec :

```markdown
# Audit canaux outbound — Veridian CRM

| Domain                    | Status        | File:Line                          | Kill-switch                        | Note                       |
|---------------------------|---------------|------------------------------------|------------------------------------|-----------------------------|
| twenty-telemetry.com      | ✅ blocked    | telemetry.service.ts:29            | TELEMETRY_ENABLED=false            | user_signup events leaked  |
| twenty-companies.com      | ✅ blocked    | create-company.service.ts:253      | TWENTY_COMPANIES_ENRICHMENT_ENABLED=false | domain lookup leaked|
| registry.npmjs.org        | ⏸ paused      | marketplace.service.ts:113         | cron disabled in module            | Marketplace catalog        |
| unpkg.com                 | ⏸ paused      | marketplace.service.ts:57          | APP_REGISTRY_CDN_URL=              | App manifests CDN          |
| models.dev                | 🟡 active     | models-dev-catalog.service.ts:113  | TBD                                | AI providers catalog       |
| twenty.com/api/enterprise | 💤 dormant    | enterprise-plan.service.ts         | inactive sans ENTERPRISE_KEY       | EE validation, jamais nous |
| app.twenty.com/images/    | 🟡 active     | Logo.tsx:10, DefaultWorkspaceLogo  | rebrand emails Veridian            | Pixel tracking emails      |
```

---

## 🚨 Hors scope (mais à NOTER quelque part)

- L'agent qui prend ce ticket **ne doit pas** s'occuper de :
  - Remplacer le branding UI ("Twenty" → "Veridian") dans le frontend → c'est un autre ticket (voir `todo/2026-05-26-faire-sauter-verrous-twenty.md` ou similaire)
  - Toucher au flow OAuth Google/Microsoft (légitime, c'est notre user qui consent)
  - Toucher au flow Stripe (légitime, billing)
- Mais **doit** ouvrir des sous-tickets dans `todo/` si tu découvres pendant le patch d'AUTRES canaux outbound non listés ici. La liste ci-dessus est exhaustive selon l'audit 2026-05-27 mais l'audit a pu rater des trucs.

---

## ✅ Checklist de fin de ticket (état 2026-06-10, commit `16925b7`)

- [x] P0-A : flag `COMPANIES_ENRICHMENT_ENABLED` (default **false** dans le code — pas besoin d'ENV prod, fail-safe) + test unitaire "0 appel HTTP". Précision d'audit : le vecteur est l'auto-création contacts calendar/messaging (ConnectedAccount), PAS le POST REST direct — l'import batch tunnel n'empruntait pas ce chemin, le patch protège le jour où une boîte Gmail/Outlook est connectée.
- [x] P0-B : `recordInputs/Outputs: false` + `sendDefaultPii: false` dans `instrument.ts` (en dur)
- [x] P0-C : guard `HELP_CENTER_SEARCH_ENABLED` (default false) dans `execute()` + spec
- [x] P0-D : regroupé P0-B + `AI_TELEMETRY_CONFIG.record* = false`
- [x] P1-A à P1-C : coupés par `MARKETPLACE_REGISTRY_SYNC_ENABLED` (default false) — guards dans marketplace.service + application-upgrade.service ("par défaut couper" du ticket appliqué)
- [x] P1-D : `AI_MODELS_CATALOG_FETCH_ENABLED` (default false) dans models-dev-catalog.service
- [x] P1-E : iframe TradingView supprimée du dashboard seed
- [x] P2 emails : logo self-hosted `crm.app.veridian.site` (pas R2 — l'instance sert déjà l'asset ; rebrandé visuellement à la passe rebrand)
- [x] P3 : `twenty.com` → `veridian.site` dans `prefill-workflows.util.ts`
- [ ] Test e2e `no-outbound-leaks.e2e-spec.ts` (nock allowlist) — **DETTE assumée** : remplacé ce sprint par specs unitaires "0 HTTP" (CI) + capture réseau réelle staging (0 paquet pendant créations Company) + vérif tcpdump prod post-deploy
- [x] Doc `docs/spec/AUDIT-OUTBOUND-LEAKS.md`
- [ ] Vérification réseau prod post-deploy (tcpdump) — en cours, après le build `:latest` + compose.deploy
- [x] Skill `admin-twenty` mis à jour (flags + piège UPPER_SNAKE_CASE)
- [x] Push staging + smoke staging réel (healthz + /metadata + signup 6 étapes + créations Company sous tcpdump : 0 paquet) + promote main `16925b7`

---

## Annexe — Contexte complet de la session de découverte (2026-05-27)

Pendant la migration des 57 leads chauds Robert depuis Prospection vers Twenty CRM, Robert a demandé "la télémetry est allumé tu peux voir ce qui remonte chez twenty ?". Lecture du code → découverte télémétrie signup → coupure live → Robert demande "continue à chercher dans le code au cas où même si il faut chercher des trucs tordus" → spawn agent Opus audit complet → découverte des leaks ci-dessus, dont le **plus grave** (`twenty-companies.com`) qui avait déjà leaké les 57 domaines de prospects pendant la migration en cours.

**Décision Robert** : "il faut un giga ticket on peut pas continuer comme ça" → création de ce ticket comme source de vérité pour le sprint de durcissement privacy outbound.
