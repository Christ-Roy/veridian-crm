# VERIDIAN-PATCHES.md — registre des patchs inline du fork

> Twenty est un fork upstream (`twentyhq/twenty`, marker de base
> `1188ea9cd5`). La plupart de nos modifs vivent dans des fichiers neufs ou
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

## Procédure de sync upstream (quand on bumpe le marker)

1. `git merge <upstream-tag>` — résoudre les conflits.
2. `bash scripts/ci/check-ee-integrity.sh <nouveau-marker>` → 0 fichier EE modifié.
3. CI `veridian-patch-survival` vert → aucun patch inline écrasé.
4. Bump du marker = **changement structurel** (gate staging avant prod, cf
   `docs/spec/AUDIT-OUTBOUND-LEAKS.md` + NOTE-CI-FORK-TWENTY §5).
5. Mettre à jour le marker par défaut dans `check-ee-integrity.sh` + ce fichier.
