# VERIDIAN-PATCHES.md — registre des patchs inline du fork

> Twenty est un fork upstream (`twentyhq/twenty`, marker de base
> `e70776f705`, sync upstream 2026-06-15 ; précédent marker `76f69efb43`,
> 2026-06-13 ; marker d'origine `1188ea9cd5`,
> 2026-05-25). La plupart de nos modifs vivent dans des fichiers neufs ou
> des ENV. Mais quelques patchs sont **inline dans des fichiers upstream
> AGPL** — un merge de sync upstream peut les écraser silencieusement.
>
> **Chaque ligne ci-dessous = un comportement verrouillé par un test
> "patch-survival"** (job CI `veridian-patch-survival`). Si un sync upstream
> efface le patch, le test casse — pas la prod.
>
> ⚠️ **Aucun fichier `/* @license Enterprise */` n'apparaît ici** (les
> modifier = contrefaçon ; vérifié par `scripts/ci/check-ee-integrity.sh`).
> Tous les fichiers listés sont AGPL.

## Patchs inline AGPL

| Fichier upstream (AGPL) | Nature du patch | Test patch-survival |
|---|---|---|
| `engine/core-modules/auth/constants/max-workspaces-without-enterprise-key.constants.ts` | `MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY = Number.MAX_SAFE_INTEGER` (lève la limite 5 workspaces) | `auth/services/__tests__/sign-in-up.service.spec.ts` (cap effectif illimité) |
| `engine/core-modules/twenty-config/config-variables.ts` | 4 flags privacy default OFF : `COMPANIES_ENRICHMENT_ENABLED`, `HELP_CENTER_SEARCH_ENABLED`, `MARKETPLACE_REGISTRY_SYNC_ENABLED`, `AI_MODELS_CATALOG_FETCH_ENABLED` | spec ci-dessous (defaults restent `false`) |
| `modules/contact-creation-manager/services/create-company.service.ts` | guard `COMPANIES_ENRICHMENT_ENABLED` autour de l'appel `twenty-companies.com` | `create-company.service.spec.ts` (0 HTTP quand flag off) |
| `engine/core-modules/tool/tools/search-help-center-tool/search-help-center-tool.ts` | guard `HELP_CENTER_SEARCH_ENABLED` (early-return) | `search-help-center-tool.veridian.spec.ts` |
| `engine/core-modules/application/application-marketplace/marketplace.service.ts` | guard `MARKETPLACE_REGISTRY_SYNC_ENABLED` sur les 3 fetch registry | `marketplace.service.veridian.spec.ts` |
| `engine/core-modules/application/application-upgrade/application-upgrade.service.ts` | guard `MARKETPLACE_REGISTRY_SYNC_ENABLED` dans `checkForUpdates` | couvert par le check réseau staging/prod |
| `engine/metadata-modules/ai/ai-models/services/models-dev-catalog.service.ts` | guard `AI_MODELS_CATALOG_FETCH_ENABLED` dans `getCachedData` | couvert par le check réseau |
| `engine/metadata-modules/ai/ai-models/constants/ai-telemetry.const.ts` | `recordInputs/Outputs: false` | `ai-telemetry.const.veridian.spec.ts` |
| `instrument.ts` | Sentry `sendDefaultPii: false`, vercelAI `recordInputs/Outputs: false` | (statique — couvert par check-ee + revue ; pas de runtime testable sans DSN) |
| `engine/workspace-manager/twenty-standard-application/utils/page-layout-widget/compute-my-first-dashboard-widgets.util.ts` | iframe TradingView retirée du seed | `compute-my-first-dashboard-widgets.veridian.spec.ts` (pas de widget IFRAME) |
| `engine/workspace-manager/standard-objects-prefill-data/utils/prefill-workflows.util.ts` | `twenty.com` → `veridian.site` (workflow demo) | cosmétique — non testé |
| `packages/twenty-emails/src/components/Logo.tsx` | logo self-hosted `crm.app.veridian.site` | cosmétique — non testé |
| `twenty-front/.../timeline-activities/rows/components/EventRowDynamicComponent.tsx` | early-check `isVeridianTunnelEvent(event.name)` AVANT le switch → délègue le rendu de ligne au module `veridian-tunnel-timeline` (events `email.*`/`audit.*`/`score.*`, sinon ligne vide native) | `EventRowDynamicComponent.veridian.spec.tsx` (route les events tunnel, pas les natifs) |
| `twenty-front/.../timeline-activities/rows/components/EventIconDynamicComponent.tsx` | early-check symétrique → icône parlante du module tunnel (sinon `Icon123`) | `EventIconDynamicComponent.veridian.spec.tsx` (icône tunnel, natifs intacts) |
| `twenty-front/.../timeline-activities/utils/filterOutInvalidTimelineActivities.ts` | early-filter `isVeridianBridgeScoreNoise` → masque les `person.updated{score}` écrits par le bridge (API key), garde les updates humaines | `filterVeridianBridgeNoise.veridian.spec.ts` (bruit masqué, humain conservé) |

## Dépendances de nos modules `veridian-*` sur l'UI upstream (à re-vérifier à chaque sync)

> Ce ne sont PAS des patchs inline (fichiers neufs Veridian), mais ils
> **dépendent de la structure des packages upstream** qui peut être
> renommée/scindée par un sync — et là aucun test patch-survival ne les couvre.
> Le typecheck/build front les révèle pour le code ; **le build Docker** les
> révèle pour `Dockerfile.veridian` (CI étage build-image, PAS l'étage CI unit).
>
> **Sync 2026-06-13** : upstream a **scindé** l'ancien design-system. Le
> package `twenty-ui` existe toujours (nouvelle UI), et un **nouveau package
> `packages/twenty-ui-deprecated/`** (name `twenty-ui-deprecated`) a été créé ;
> l'essentiel du front (1735 fichiers) importe désormais `twenty-ui-deprecated`.
> `twenty-front` dépend des **deux** workspaces (`twenty-ui` + `twenty-ui-deprecated`).
> On a migré nos imports ET ajouté le 2e workspace au `Dockerfile.veridian`
> (sinon `yarn workspaces focus` → `twenty-ui-deprecated: Workspace not found`,
> build Docker exit 1).

| Fichier Veridian (neuf) | Dépendance upstream consommée | Migré le |
|---|---|---|
| `veridian-tunnel-timeline/components/EventIconVeridianTunnel.tsx` | icons `twenty-ui-deprecated/display` | 2026-06-13 |
| `veridian-tunnel-timeline/components/EventRowVeridianTunnel.tsx` | `MOBILE_VIEWPORT`, `themeCssVariables` de `twenty-ui-deprecated/theme-constants` ; `EventRowItem` de `@/activities/timeline-activities/rows/components` | 2026-06-13 |
| `Dockerfile.veridian` (fichier custom Veridian, hors arbre upstream) | doit lister TOUS les workspaces du front dans `yarn workspaces focus` + les `COPY package.json` + `COPY` répertoire. Sensible à tout ajout/rename/scission de package upstream. Au sync 2026-06-13 : ajout de `twenty-ui-deprecated` (focus L45 + COPY L38/L106). | 2026-06-13 |

## Procédure de sync upstream (quand on bumpe le marker)

1. `git merge <upstream-tag>` — résoudre les conflits.
2. `bash scripts/ci/check-ee-integrity.sh <nouveau-marker>` → 0 fichier EE modifié.
3. CI `veridian-patch-survival` vert → aucun patch inline écrasé.
4. Bump du marker = **changement structurel** (gate staging avant prod, cf
   `docs/spec/AUDIT-OUTBOUND-LEAKS.md` + NOTE-CI-FORK-TWENTY §5).
5. Mettre à jour le marker par défaut dans `check-ee-integrity.sh` + ce fichier.
