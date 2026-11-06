# Audit sync upstream Twenty — 2026-06-13

> **Auditeur** : agent `upstream-audit` (Opus), team `crm-vague-juin13`.
> **Mode** : lecture seule stricte. Aucun merge, aucun commit, aucun push, aucune
> édition de code. Ce fichier est le SEUL artefact produit (doc).
> **Repo** : `Christ-Roy/veridian-crm` (fork `twentyhq/twenty`).
> **Range audité** : marker de fork `1188ea9cd5` (2026-05-25) → `upstream/main` HEAD
> `036d9a2bcf` (2026-06-13, **v2.9.0+229**). Tag stable intermédiaire `v2.9.0`
> = `b53f1832d8` (2026-06-04).
> **Sources croisées** : `VERIDIAN-PATCHES.md`, `docs/spec/AUDIT-OUTBOUND-LEAKS.md`,
> `docs/spec/AUDIT-LIMITE-EE-TWENTY.md`.

---

## TL;DR (synthèse décision)

| Question | Réponse |
|---|---|
| **Nouveaux leaks outbound introduits depuis le 25 mai ?** | **0 nouveau leak actif.** Les domaines déjà listés (twenty-companies, models.dev, npm/unpkg, etc.) sont textuellement inchangés. Aucune nouvelle lib d'analytics tierce (posthog/segment/mixpanel/etc.). 2 nouveaux canaux à connaître mais **non-Twenty et dormants** : ClickHouse event-sink (gated `CLICKHOUSE_URL`, vide chez nous) et emailing-domain AWS SES (gated, credentials AWS à nous). 1 alerte FUTURE : migration `#21171` prépare une "People Data Labs enrichment app" (pas encore de fetch). |
| **Nouveaux fichiers `@license Enterprise` ?** | **5 nouveaux fichiers EE**, tous dans des modules **déjà connus comme EE** (`billing/`, `event-logs/`, `usage/`). Aucune surface EE inédite. Le compte EE global **baisse** (300 → 295). |
| **Risque global du merge** | **MOYEN.** Pas de piège légal/privacy nouveau. Le risque vient de (a) le rename massif `twenty-ui → twenty-ui-deprecated` (1735 fichiers, touche 2 de nos composants Veridian + 1 de nos patches), (b) le refactor complet de `filterOutInvalidTimelineActivities.ts`, (c) les migrations DB de schéma (champs standard Company/Person, rename dir migrations). Conflits attendus : **3 fichiers patchés sur 13** + le travail post-merge sur nos modules `veridian-tunnel-timeline`. |
| **HEAD vs tag v2.9.0 ?** | **Merger `upstream/main` HEAD, PAS v2.9.0.** Raison décisive : **47 commits de sécurité (CVE/Dependabot) sont POST-v2.9.0** (4→13 juin) contre seulement 2 dans le tag. Se caler sur v2.9.0 = renoncer volontairement à 47 correctifs de sécu. |
| **Chemin de ce rapport** | `docs/spec/AUDIT-SYNC-UPSTREAM-2026-06-13.md` (non poussé). |

---

## 0. Cadrage chiffré

```
marker 1188ea9cd5 (2026-05-25) ──── 189 commits ──── v2.9.0 (2026-06-04) ──── 229 commits ──── HEAD (2026-06-13)
                                                                                              = upstream/main 036d9a2bcf
```

- Retard total : **418 commits** (`git rev-list --count 1188ea9cd5..upstream/main`).
- Diffstat brut : `6645 files changed, 237851 insertions(+), 101972 deletions(-)`
  (gonflé par lockfiles, snapshots de test, migrations UI générées — le code
  source TS/TSX réellement nouveau = ~1661 fichiers).
- Répartition v2.9.0 (dans le tag) : 21 feat, 62 fix, 2 perf, 15 chore.

---

## 1. Nouveautés upstream qui valent le coup pour Veridian

Triage gros grain par thème. On ne retient que ce qui touche les packages
**actifs** Veridian (`twenty-server`, `twenty-front`, `twenty-shared`, `twenty-ui`,
`twenty-emails`). Tout le bruit `twenty-partners` / `twenty-website` / `twenty-apps` /
`twenty-sdk` (≈ 30 % des commits du range) est **ignoré** — packages supprimables.

### 🔒 Sécurité — la VRAIE raison de syncer (priorité #1)

Gros sweep CVE/Dependabot upstream, **concentré après v2.9.0** :

- `esbuild` → 0.28.1 (GHSA-g7r4-m6w7-qqqr, path-traversal dev-server) — #21515
- `typeorm` → 0.3.26 (**CVE-2025-60542**) — #21456
- `lodash` CVEs (#824/#823/#385) — #21414
- `postcss` CVE (styled-components + next resolution) — #21438
- `express` 4.22.2 + `qs` 6.15.2 (CVE) — #21434
- `uuid` CVE (bullmq/msal/blocknote) — #21441
- `koa`, `minimatch`, `ws`, `file-type`, `picomatch`, `serialize-javascript`,
  `happy-dom`, `immutable`, `fast-uri`/`fast-xml-parser`, `yeoman-environment`,
  `webpack-dev-server`, `ajv`, `wait-on/joi` — ≈ 20 alertes Dependabot soldées.
- Drop `apollo-server-core` EOL — #21418
- `@nestjs/graphql` 12→13, `@ptc-org/nestjs-query` 4→9, `@nestjs/config` 4 — #21402
- **App-level** : `fix(sdk): avoid shell command injection in CLI exec calls` (#21508),
  `fix(front): sanitize optimistic input when creating a record` (#21076).

→ **C'est l'argument central du sync.** Notre fork accumule sinon une dette CVE
qui finira en alerte GitHub bloquante (cf. réflexe #1 standards Robert : `npm audit`
critical = bloquant).

### Backend / ORM / perf

- `WorkspaceScopedRepository` pour entités core/metadata workspace-scoped (#20953,
  #20987 : 23 entités migrées) — refactor ORM de fond, perf + isolation.
- `feat: allow many-to-one relations as advanced filter leaves` (#21147).
- `feat: raise FILES field max number of values from 10 to 60` (#20950).
- `feat: expose CURRENCY field settings (format/decimals) in shared types` (#21090).
- `feat(server): opt-in FRONT_AUTO_BASE_URL` (#20504) — URL API relative au hostname
  (utile pour notre déploiement multi-subdomain par workspace).
- Workflow : idempotent stop + retry (#21458), validation layer (#21422),
  pagination Find Records (#21484).
- `feat(server): in-app server-level admin management` (#21321) — pertinent vu notre
  ticket setup admin Robert (`canAccessFullAdminPanel`).
- `feat: gate record creation on isUICreatable only, decoupled from isSystem` (#21527).

### Frontend / UI

- 🚩 **Rename `twenty-ui` → `twenty-ui-deprecated`** (massif, cf §4/§5) — le design
  system est en cours de remplacement par une nouvelle UI. Pas un cadeau : c'est la
  principale source de friction du merge côté front.
- Redesign settings (carte arrondie unique #21131, page Email dédiée #21008,
  onglet Logs #21180, primary/secondary bars flat #21308).
- MCP : optimisation du prompt + masquage `get_tool_catalog` (#21183).

### Observabilité / events (à comprendre, pas forcément à activer)

- **Pipeline EventSink unifié** (#21197) + ClickHouse (`event-logs/ingest/`) — voir
  §2 (dormant sans `CLICKHOUSE_URL`, et `event-logs` est EE).

**Verdict #1** : la valeur du sync est à **80 % la sécurité**, à 20 % des
améliorations ORM/champs/workflow. Aucune feature ne justifierait à elle seule le
sync ; le paquet CVE oui.

---

## 2. 🔴 CRITIQUE — Nouveaux leaks outbound introduits depuis le marker

**Méthode** : (a) diff textuel des lignes contenant les patterns connus de
`AUDIT-OUTBOUND-LEAKS.md` (twenty-companies.com, twenty-telemetry.com,
twenty-help-search.com, api-dsc.mintlify.com, models.dev, registry.npmjs.org,
unpkg.com, app.twenty.com, tradingview.com, sendDefaultPii, recordInputs/Outputs,
posthog/segment/sentry.io) entre marker et HEAD ; (b) chasse large des nouvelles
URLs `https://` ajoutées dans le diff serveur+front ; (c) grep des libs analytics
tierces ajoutées dans les `package.json` ; (d) inspection des nouveaux modules
réseau (event-logs, emailing-domain, sns-confirm).

### Résultat : **0 nouveau leak actif vers Twenty Labs ou un tiers.**

- **Patterns connus** : `comm -13` entre marker et HEAD sur les lignes contenant ces
  domaines = **vide des deux côtés** (49 occurrences identiques, aucune ajoutée,
  aucune retirée). Les canaux qu'on a déjà coupés n'ont pas été déplacés ni dupliqués.
- **Aucune lib analytics tierce ajoutée** : grep posthog/mixpanel/amplitude/segment/
  datadog/fullstory/hotjar/gtag/intercom/hubspot/launchdarkly/bugsnag/logrocket/
  clarity dans les lignes `+` du diff = aucun hit réel (faux positifs sur le mot
  "segment" = parsing de strings).

### Canaux NOUVEAUX à connaître (non-leaks, mais à documenter)

| Canal nouveau | Verdict | Détail |
|---|---|---|
| **ClickHouse event-sink** (`engine/core-modules/event-logs/ingest/clickhouse-event.sink.ts`, `database/clickHouse/*`, `EVENT_SINKS=['clickhouse']`) | ✅ **Pas un leak.** Dormant chez nous. | Pointe **exclusivement** vers `CLICKHOUSE_URL` (config, vide chez nous → no-op). Aucun endpoint Twenty/tiers hardcodé (`grep https?:// event-logs/ clickHouse/` = vide hors AWS). C'est ton propre ClickHouse si tu en montes un. ⚠️ Mais le module `event-logs` est **EE** (cf §3) → à laisser dormant. |
| **emailing-domain AWS SES** (`engine/core-modules/emailing-domain/drivers/aws-ses/`, `EMAILING_DOMAIN_DRIVER=AWS_SES`) | ✅ **Pas un leak.** Dormant sans creds AWS. | Envoi via **tes** credentials AWS SES, pas un canal vers Twenty. Driver `LOG` ajouté pour le dev local (#21286). |
| **SNS subscribe confirm** (`messaging-webhooks/services/sns-subscription-confirmer.service.ts`, `fetch(subscribeUrl)`) | ✅ **Pas un leak — amélioration sécu.** | Nouveau fichier, mais c'est l'AWS SNS confirm **déjà listé "légitime conservé"**. Upstream l'a durci avec une regex `^https://sns\.[a-z0-9-]+\.amazonaws\.com/` (refuse toute URL non-AWS). C'est mieux qu'avant. |
| **Vimeo embed** (`SettingsCustomizeVideoModal.tsx`, `player.vimeo.com`) | 🟡 P3 cosmétique. | iframe vidéo dans un nouveau modal settings. IP user à l'ouverture du modal. À neutraliser au rebrand UI si on garde la feature (faible priorité, geste user explicite). |
| **SettingsCommunity.tsx** (liens `twenty.com/partners/list`, `twenty.com/releases`) | 🟡 Rebrand. | Nouvelle page "Community" avec des liens cliquables vers twenty.com (pas un fetch auto). À rebrand/retirer (réflexe trademark). |

### 🚩 ALERTE FUTURE (pas un leak aujourd'hui, mais à tracer)

`Migrate Company and Person standard fields in preparation for the enrichment app`
(**#21171**, commit `41d5d80a65`) : la PR migre les champs standard `Company`/`Person`
**"in preparation for a follow-up PR that introduces a People Data Labs enrichment
app"**. Aujourd'hui = simple migration de schéma, **aucun fetch PDL**. Mais ça annonce
un nouveau canal d'enrichissement externe (type twenty-companies.com, via People Data
Labs). **À surveiller au prochain sync** : si un service `people-data-labs`/`pdl`
apparaît, il faudra le gater comme on a gaté `COMPANIES_ENRICHMENT_ENABLED`.

---

## 3. 🔴 CRITIQUE — Nouveaux fichiers `@license Enterprise`

**Méthode** : `git grep -l "@license Enterprise"` aux 3 refs + `comm` pour le delta
exact (capture aussi les fichiers existants devenus EE, pas seulement les `diff-filter=A`).

| Ref | Nb fichiers EE (.ts/.tsx) |
|---|---|
| marker `1188ea9cd5` | **300** |
| `v2.9.0` | 293 |
| `upstream/main` HEAD | **295** |

→ Le compte EE **baisse** globalement (300 → 295). Aucune explosion de surface EE.

### 5 NOUVEAUX fichiers EE (présents HEAD, absents marker)

Tous dans des **modules déjà classés EE** par `AUDIT-LIMITE-EE-TWENTY.md`
(`billing/`, `event-logs/`, `usage/`) — **aucune nouvelle catégorie EE inédite** :

```
packages/twenty-server/src/engine/core-modules/billing/constants/no-billing-subscription.constant.ts
packages/twenty-server/src/engine/core-modules/billing/services/workspace-current-billing-subscription-cache.service.ts
packages/twenty-server/src/engine/core-modules/event-logs/event-logs-viewer.module.ts
packages/twenty-server/src/engine/core-modules/event-logs/registry/event-log-registry.ts
packages/twenty-server/src/engine/core-modules/usage/utils/build-usage-event-envelopes.ts
```

(Header `/* @license Enterprise */` vérifié sur chacun.)

### 10 fichiers EE DISPARUS (refactor interne upstream)

`billing/dtos/billing-price.dto.ts`, `billing/dtos/inputs/billing-product.input.ts`,
`billing/enums/billing-available-product.enum.ts`,
`billing/services/workspace-billing-subscription-cache.service.ts`,
`enterprise/constants/...default-expiration-days...`, `enterprise/dtos/set-enterprise-key.input.ts`,
`event-logs/event-logs.module.ts`, `usage/services/usage-event-writer.service.ts`,
2× `flat-row-level-permission-predicate/constants/...`.

**Verdict #3** : la surface EE est **stable et bornée** aux modules déjà connus.
Le merge n'introduit aucun module EE entier nouveau (pas de "nouveau SSO bis").
`scripts/ci/check-ee-integrity.sh` (marker par défaut `1188ea9cd5`) restera
pertinent — il faudra juste **bumper son marker** après le merge (cf §6 étape 9).

⚠️ **Point de vigilance lié à §2** : le pipeline ClickHouse event-sink est AGPL
(`clickhouse-event.sink.ts`) mais consomme le module `event-logs` qui est **EE**.
Le laisser **dormant** (pas de `CLICKHOUSE_URL`) ne déclenche aucun code EE → conforme.
Ne PAS activer l'audit-log/event-logs viewer en prod (= surface EE).

---

## 4. Conflits attendus — stratégie de résolution fichier par fichier

Sur les **13 fichiers patchés inline** (`VERIDIAN-PATCHES.md`), upstream n'en a
touché que **3** (vérifié `git diff --name-status 1188ea9cd5..upstream/main`).
Les 10 autres sont **inchangés** → leurs patches survivent sans conflit.

> Les 4 fichiers annoncés par le ticket : EventRow était listé mais est en réalité
> **inchangé upstream** (0 modif) ; le vrai trio de conflits = EventIcon, filterOut,
> config-variables + le add/add sur create-company.service.spec.ts.

### 4.1 `config-variables.ts` — 🔴 CRITIQUE (kill-switches privacy)

- **Côté upstream** : `M`, **+71 / -23 lignes** (nouvelles config vars : `EVENT_SINKS`,
  `AI_MODELS_DEFAULT_FAST/SMART/RECOMMENDED/DISABLED`, `EMAILING_DOMAIN_DRIVER`, etc.).
- **Côté nous** : nos 4 flags privacy (`COMPANIES_ENRICHMENT_ENABLED`,
  `HELP_CENTER_SEARCH_ENABLED`, `MARKETPLACE_REGISTRY_SYNC_ENABLED`,
  `AI_MODELS_CATALOG_FETCH_ENABLED`) sont des **ajouts purement Veridian** :
  count = 0 au marker, **0 à HEAD upstream**, 1 sur staging. Upstream ne les connaît
  pas → il ne peut PAS les écraser textuellement.
- **Conflit attendu** : merge à 3 voies. Upstream a inséré 71 lignes de nouvelles vars
  dans le même fichier où nous avons inséré nos 4 blocs `@ConfigVariable`. Le conflit
  sera **positionnel** (zones d'insertion qui se chevauchent), pas sémantique.
- **Stratégie** : **garder nos 4 flags ET adopter toutes les nouvelles vars upstream.**
  Aucun choix exclusif — c'est de l'union. Après résolution, vérifier que les 4 flags
  ont toujours `default = false` (fail-safe). Le test patch-survival
  (`config-variables` defaults restent `false`) gardera le filet.

### 4.2 `filterOutInvalidTimelineActivities.ts` — 🟠 conflit sérieux (refactor)

- **Côté upstream** : `M`, **+54 / -41 lignes**. **Réécriture complète** : passage de
  `.filter()` à `.map(...).filter(isDefined)`, extraction d'une fonction
  `keepActivityWithReadableDiff`, nouveau helper `findFieldMetadataItemByDiffKey`,
  suppression de `noteObjectMetadataItem` (gestion `linked-*` générique), nouvelle
  branche `action === 'updated'`.
- **Côté nous** : un **early-return** au tout début de la lambda :
  `if (isVeridianBridgeScoreNoise(timelineActivity)) return false;` (masque le bruit
  `person.updated{score}` du bridge API-key).
- **Conflit attendu** : quasi tout le corps de la fonction est en conflit (la structure
  a changé). Notre `.filter()` host n'existe plus.
- **Stratégie** : **adopter intégralement la nouvelle structure upstream**, puis
  **réinjecter notre early-filter** au début du `.map()` :
  ```ts
  return timelineActivities
    .map((timelineActivity) => {
      // Veridian patch (AGPL inline, cf VERIDIAN-PATCHES.md)
      if (isVeridianBridgeScoreNoise(timelineActivity)) return undefined;
      // ... logique upstream inchangée ...
    })
    .filter(isDefined);
  ```
  (Dans le nouveau monde, "exclure" = `return undefined` car le `.filter(isDefined)`
  final s'en charge — adapter notre `return false` → `return undefined`.)
- **Filet** : le test `filterVeridianBridgeNoise.veridian.spec.ts` doit rester vert.
  ⚠️ Vérifier que `isVeridianBridgeScoreNoise` matche toujours (la forme de
  `timelineActivity.name`/`.properties.diff` est inchangée → OK a priori).

### 4.3 `EventIconDynamicComponent.tsx` — 🟢 conflit trivial

- **Côté upstream** : `M`, **1 ligne** : import migré
  `from 'twenty-ui/display'` → `from 'twenty-ui-deprecated/display'`.
- **Côté nous** : early-check `isVeridianTunnelEvent(event.name)` + import de
  `EventIconVeridianTunnel`, et notre fichier importe encore `twenty-ui/display`.
- **Stratégie** : **garder notre early-check + adopter le nouveau chemin d'import**
  (`twenty-ui-deprecated/display`). 1 ligne. Le test
  `EventIconDynamicComponent.veridian.spec.tsx` garde le filet.

### 4.4 `create-company.service.spec.ts` — 🟡 conflit add/add

- **Côté upstream** : ce spec est **NOUVEAU** (n'existait pas au marker — upstream l'a
  ajouté de son côté).
- **Côté nous** : on a notre propre `create-company.service.spec.ts` (test
  patch-survival : 0 HTTP quand `COMPANIES_ENRICHMENT_ENABLED` off).
- **Conflit attendu** : add/add sur le même chemin → git signalera un conflit de
  fichier entier.
- **Stratégie** : **fusionner les deux suites de tests** (garder nos `describe` Veridian
  + intégrer les cas de test upstream). Ne PAS écraser notre test (c'est notre garde
  patch-survival). Si la signature de `create-company.service.ts` a changé côté
  upstream (vérifier : le service est `unchanged` marker..HEAD → faible risque), aligner.

### Récap conflits

| Fichier | Type | Sévérité | Stratégie |
|---|---|---|---|
| `config-variables.ts` | M / +71-23 | 🔴 | Union : nos 4 flags + toutes vars upstream. Garder defaults `false`. |
| `filterOutInvalidTimelineActivities.ts` | M / refactor | 🟠 | Adopter structure upstream + réinjecter early-filter (`return undefined`). |
| `EventIconDynamicComponent.tsx` | M / 1 ligne | 🟢 | Garder early-check + import `twenty-ui-deprecated`. |
| `create-company.service.spec.ts` | add/add | 🟡 | Fusionner les deux suites de tests. |

---

## 5. Survie des patches inline — qui risque d'être écrasé/déplacé ?

**Méthode** : pour chaque fichier de `VERIDIAN-PATCHES.md`, vérifier (a) existe-t-il
encore à HEAD upstream, (b) a-t-il été modifié/renommé entre marker et HEAD.

| Fichier patché | Existe HEAD | Touché upstream | Risque |
|---|---|---|---|
| `auth/constants/max-workspaces-without-enterprise-key.constants.ts` | ✅ | non | 🟢 nul |
| `twenty-config/config-variables.ts` | ✅ | **M (+71-23)** | 🔴 conflit (cf §4.1) |
| `contact-creation-manager/services/create-company.service.ts` | ✅ | non | 🟢 nul (mais son **spec** a un add/add, cf §4.4) |
| `tool/.../search-help-center-tool.ts` | ✅ | non | 🟢 nul |
| `application-marketplace/marketplace.service.ts` | ✅ | non | 🟢 nul |
| `application-upgrade/application-upgrade.service.ts` | ✅ | non | 🟢 nul |
| `ai-models/services/models-dev-catalog.service.ts` | ✅ | non | 🟢 nul (le nouveau `admin-panel.resolver` consomme ce service gated, pas de fetch direct → kill-switch toujours actif) |
| `ai-models/constants/ai-telemetry.const.ts` | ✅ | non | 🟢 nul |
| `compute-my-first-dashboard-widgets.util.ts` | ✅ | non | 🟢 nul |
| `prefill-workflows.util.ts` | ✅ | non | 🟢 nul |
| `twenty-emails/src/components/Logo.tsx` | ✅ | non | 🟢 nul |
| `timeline-activities/rows/.../EventRowDynamicComponent.tsx` | ✅ | non (0 modif) | 🟢 nul |
| `timeline-activities/rows/.../EventIconDynamicComponent.tsx` | ✅ | **M (import)** | 🟢 trivial (cf §4.3) |
| `timeline-activities/utils/filterOutInvalidTimelineActivities.ts` | ✅ | **M (refactor)** | 🟠 conflit (cf §4.2) |

**Aucun renommage / suppression** de fichier patché (tous au même chemin à HEAD).
**Aucun fichier EE dans la liste** (conforme — vérifié, tous AGPL).

### ⚠️ Risque indirect non-listé dans VERIDIAN-PATCHES.md : nos modules `veridian-*`

Le rename `twenty-ui → twenty-ui-deprecated` est **massif** : à HEAD upstream, 1735
fichiers front importent `twenty-ui-deprecated` contre 15 encore `twenty-ui`. **Nos
propres composants Veridian** importent l'ancien chemin et **casseront le build front**
après merge tant qu'ils ne sont pas migrés :

- `veridian-tunnel-timeline/components/EventIconVeridianTunnel.tsx:12` → `from 'twenty-ui/display'`
- `veridian-tunnel-timeline/components/EventRowVeridianTunnel.tsx:6` → `from 'twenty-ui/theme-constants'`

→ **Travail post-merge obligatoire** (au-delà de la résolution de conflit) : migrer ces
imports vers `twenty-ui-deprecated/*` (ou la nouvelle API `twenty-ui` si elle expose les
mêmes symboles). À ajouter au plan §6. Ce n'est pas couvert par les tests patch-survival
existants — le `pnpm build`/typecheck front le révélera.

---

## 6. Plan de merge step-by-step + reco HEAD vs v2.9.0

### Reco cible : **`upstream/main` HEAD `036d9a2bcf`, PAS le tag v2.9.0**

| Critère | v2.9.0 (2026-06-04) | HEAD (2026-06-13) |
|---|---|---|
| Commits sécurité dans le range | **2** | **49** (+47 post-tag) |
| CVE notables manquées si v2.9.0 | esbuild, typeorm CVE-2025-60542, lodash, postcss, express/qs, uuid, koa, minimatch… (≈ 47) | toutes incluses |
| Stabilité "tag" | tag officiel | HEAD de main (non taggé) |
| Distance à rattraper plus tard | re-merge 229 commits ensuite | à jour |

Le seul avantage de v2.9.0 (un tag "stable") ne compense pas l'abandon de 47
correctifs de sécu — qui est précisément la motivation #1 du sync. **On merge HEAD.**
(Si on voulait absolument un point taggé, il n'y a pas de tag v2.9.x intermédiaire
entre v2.9.0 et HEAD dans le range — donc HEAD est de toute façon le seul moyen
d'avoir le sweep CVE.)

### Procédure (affine la "Procédure de sync upstream" de VERIDIAN-PATCHES.md)

> Tier **💀/🔴** (migrations DB + lib partagée + surface API) → gate staging
> obligatoire, backup DB avant, E2E lourd avant promo main, monitoring post-deploy.
> **Ce merge n'est PAS un `[risk:low]`.** À faire APRÈS les autres agents de la vague
> (sinon on leur écrase le terrain).

1. **Pré-flight (lecture seule)** : confirmer aucun agent en cours sur les 4 fichiers
   en conflit + nos modules `veridian-tunnel-timeline`. Snapshot `git log origin/staging`.
2. **Backup DB staging** (les migrations #21171 rename dir + champs Company/Person
   s'appliqueront). `pg_dump` staging avant tout.
3. **Branche de merge sur staging** : depuis `staging` à jour, `git merge 036d9a2bcf`
   (HEAD upstream). Ne PAS rebaser (history fork à préserver).
4. **Résoudre les 4 conflits** selon §4 (config-variables = union ; filterOut =
   structure upstream + early-filter `undefined` ; EventIcon = early-check + import
   deprecated ; create-company.spec = fusion des suites).
5. **Migrer les imports `twenty-ui` de nos modules Veridian** vers
   `twenty-ui-deprecated/*` (§5) — sinon build front KO.
6. **Intégrité EE** : `bash scripts/ci/check-ee-integrity.sh 1188ea9cd5`
   (encore l'ancien marker à ce stade) → 0 fichier EE modifié. Vérifier qu'on n'a
   PAS touché aux 5 nouveaux fichiers EE ni activé `event-logs`/ClickHouse en prod.
7. **Patch-survival + build** : job CI `veridian-patch-survival` vert + `pnpm build`
   server & front + typecheck. Vérifier les 4 flags privacy toujours `default false`.
8. **Vérif outbound post-merge** : confirmer `EVENT_SINKS`/`CLICKHOUSE_URL` non
   configurés (no-op), pas de `EMAILING_DOMAIN_DRIVER` actif sans creds, tracer le
   TODO "People Data Labs enrichment" (#21171) pour le gater au prochain sync.
9. **Bumper le marker** : `1188ea9cd5` → `036d9a2bcf` dans `check-ee-integrity.sh`
   (défaut ligne 17) **et** dans `VERIDIAN-PATCHES.md` (en-tête + procédure). Mettre à
   jour `AUDIT-OUTBOUND-LEAKS.md` si on neutralise vimeo/SettingsCommunity.
10. **Gate staging** : push staging → `veridian-crm-ci.yaml` vert + healthcheck +
    E2E lourd (les migrations DB doivent passer sur la DB staging réelle, état vérifié
    à la main : workspaces existants intacts après migration champs Company/Person).
11. **Capture réseau staging** (réflexe AUDIT-OUTBOUND-LEAKS) : `tcpdump` sur le
    container staging pendant création de Companies/Persons + ouverture settings AI →
    **0 paquet** vers twenty-companies.com / models.dev / twenty-help-search.
12. **Promo prod** seulement après staging parfaitement vert + E2E lourd + capture
    réseau OK. Tag `:rollback` posé. Monitoring 30 min post-deploy (migrations =
    tier élevé). Postmortem si rollback.

### Estimation friction

- **Résolution conflits** : ~1-2 h (3 fichiers + 1 add/add ; filterOut est le seul
  non-trivial).
- **Migration imports `twenty-ui` Veridian** : ~30 min (2 fichiers, mécanique).
- **Validation** (build + patch-survival + migrations staging + capture réseau + E2E) :
  le gros du temps. Compter une demi-journée sérieuse, migrations DB obligent.
- **Risque résiduel #1** : une migration DB qui se passe mal sur les workspaces
  existants (#21171) → d'où backup + test staging avant prod, non négociable.

---

## Annexe — commandes de vérification reproductibles

```bash
# Range & dates
git rev-list --count 1188ea9cd5..upstream/main   # 418
git rev-list --count v2.9.0..upstream/main        # 229 (HEAD devant le tag)

# Nouveaux fichiers EE (delta exact)
git grep -l "@license Enterprise" 1188ea9cd5 -- 'packages/*.ts' 'packages/*.tsx' | sed 's/^1188ea9cd5://' | sort > /tmp/ee-marker.txt
git grep -l "@license Enterprise" upstream/main -- 'packages/*.ts' 'packages/*.tsx' | sed 's#^upstream/main:##' | sort > /tmp/ee-head.txt
comm -13 /tmp/ee-marker.txt /tmp/ee-head.txt       # 5 nouveaux (billing/event-logs/usage)

# Leaks : diff textuel des patterns connus (vide = rien de nouveau)
PAT='twenty-companies\.com|models\.dev|registry\.npmjs\.org|unpkg\.com|app\.twenty\.com|tradingview\.com|sendDefaultPii|recordInputs'
git grep -hE "$PAT" 1188ea9cd5 -- packages/twenty-server/src/ packages/twenty-front/src/ | sort -u > /tmp/leak-marker.txt
git grep -hE "$PAT" upstream/main -- packages/twenty-server/src/ packages/twenty-front/src/ | sort -u > /tmp/leak-head.txt
comm -13 /tmp/leak-marker.txt /tmp/leak-head.txt   # vide

# Sécu : avant vs après v2.9.0
git log --oneline --no-merges 1188ea9cd5..v2.9.0 | grep -ciE 'security|cve|GHSA|Dependabot'   # 2
git log --oneline --no-merges v2.9.0..upstream/main | grep -ciE 'security|cve|GHSA|Dependabot' # 47

# Statut des fichiers patchés
git diff --name-status 1188ea9cd5..upstream/main -- <chaque fichier de VERIDIAN-PATCHES.md>
```
