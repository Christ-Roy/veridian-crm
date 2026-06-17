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
| `engine/metadata-modules/object-metadata/object-metadata.entity.ts` **et** `engine/metadata-modules/field-metadata/field-metadata.entity.ts` | décorateur `@WasRemovedInUpgrade({upgradeCommandName: RENAME_IS_UI_READ_ONLY_TO_IS_UI_EDITABLE})` ajouté sur `isUIReadOnly` (upstream l'avait volontairement omis pour un rolling-deploy ArgoCD inexistant chez nous). Sans ça, le rename 2.13 droppe la colonne mais l'ORM la SELECT encore → `column isUIReadOnly does not exist` → deadlock cross-version (cf `todo/2026-06-14-upgrade-ui-capability-flags-fail.md`). | `object-metadata/__tests__/is-ui-read-only-removed-decorator.veridian.spec.ts` (le décorateur + son upgradeCommandName présents sur les 2 entities) |
| `twenty-front/src/modules/object-record/record-show/components/PageLayoutRecordPageRenderer.tsx` | monte `<VeridianRecordOpenEffect objectNameSingular recordId>` (dérivé de `targetRecordIdentifier`) dans `StyledShowPageRightContainer` → mécanique "ouverture de fiche" **logique INVERSÉE (Robert 2026-06-17) : déclencheur = FERMETURE de la fiche**. L'Effect ne rend RIEN : il observe l'ouverture/fermeture ; à la FERMETURE (démontage / changement de recordId) il planifie dans le `recordOpenManager` (module-level) un décompte de **10s** → si non annulé par re-clic, horodate `ficheOuverteAt` + `ficheOuverteParId` + progression `statutColdCall` A_APPELER→FICHE_OUVERTE only, jamais de régression (cf VISION-INSTANCE-TWENTY-CUSTOM §4). **Monté ICI (et non dans `RecordShowPage`) car ce renderer est rendu DANS LES DEUX contextes record — pleine page (`isInSidePanel=false`) ET side-panel (`isInSidePanel=true`) → un seul point de montage couvre les deux.** Logique 100% dans le module neuf `veridian-record-open` ; patch upstream = 1 import + 1 balise JSX. (L'ancien `position: relative` — containing-block de l'overlay 5s — a été RETIRÉ : plus d'overlay panel, l'animation est sur la row.) | `PageLayoutRecordPageRenderer.veridian.spec.tsx` (l'effet est monté dans les 2 valeurs de `isInSidePanel` + reçoit objectNameSingular/recordId) |
| `twenty-front/src/modules/object-record/record-index/hooks/useOpenRecordFromIndexView.ts` | **CHOKEPOINT d'ouverture d'une fiche depuis un index (table/board/calendar y passent tous).** En tête de `openRecordFromIndexView`, si la fiche cliquée est EN DÉCOMPTE (`cancelRecordOpen(openKey)` renvoie `true`) → on ANNULE le décompte et on `return` SANS ouvrir : le re-clic sur une fiche qui scintille = fausse manip → la fiche ne se ré-ouvre pas, reste A_APPELER. C'est le point délicat "re-clic annule sans ré-ouvrir". Patch = 1 import + 4 lignes (build key + if-cancel-return). | `useOpenRecordFromIndexView.veridian.spec.tsx` (fiche en décompte → cancel + 0 navigate/0 side-panel ; fiche normale → ouvre) |
| `twenty-front/src/modules/object-record/record-table/record-table-row/components/RecordTableTr.tsx` | lit l'atom global `veridianPendingOpenKeysState` (un `Set`) et pose `data-veridian-record-opening` sur la row quand l'openKey `<objectNameSingular>:<recordId>` de cette row ∈ Set des décomptes en cours → SCINTILLEMENT de la LIGNE dans la vue table pendant le décompte de confirmation 10s (déclenché à la FERMETURE ; plusieurs fiches peuvent scintiller en parallèle après navigation). `RecordTableTr` est le chokepoint unique des rows de données visibles (Static/Draggable/FirstRowOfGroup délèguent toutes ici). Patch = 2 imports + 1 hook lecture + 1 test `.has()` + 1 `data-*`. | `RecordTableTr.veridian.spec.tsx` (data-attr posé ssi openKey ∈ Set pending, sinon non ; ok multi-clés) |
| `twenty-front/src/modules/object-record/record-table/record-table-row/components/RecordTableRowDiv.tsx` | bloc CSS `&[data-veridian-record-opening='true']` + `@keyframes veridian-row-open-pulse` (glow bleu pulsant sur les cellules) → rendu visuel du scintillement de la row pendant le décompte 10s (invite à re-cliquer pour annuler). Pure CSS additive, n'altère pas les états `focused`/`active` natifs. **Cosmétique — non testé en runtime** (Linaria n'extrait pas la CSS en jsdom ; le wiring qui PILOTE l'attribut est couvert par `RecordTableTr.veridian.spec.tsx`). Un sync qui réécrirait ce styled-component effacerait le glow silencieusement → à re-vérifier visuellement au sync. | cosmétique — non testé (wiring couvert côté `RecordTableTr`) |

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
| `veridian-record-open/components/VeridianRecordOpenEffect.tsx` | `useUpdateOneRecord` de `@/object-record/hooks` ; `currentWorkspaceMemberState` de `@/auth/states` ; `useAtomStateValue` de `@/ui/utilities/state/jotai/hooks` ; `useStore` de `jotai` + `recordStoreFamilySelector` de `@/object-record/record-store/states/selectors` (lecture one-shot du `statutColdCall` courant à la confirmation) ; `isDefined` de `twenty-shared/utils`. NE REND RIEN : observe l'ouverture/fermeture, planifie le décompte à la FERMETURE via `recordOpenManager`, et annule au (re)mount (garde Strict-Mode + réouverture hors index). Tout rename de ces chemins par un sync casse le typecheck/build front (révélé par CI + build Docker). | 2026-06-17 |
| `veridian-record-open/utils/recordOpenManager.ts` | ⚠️ `jotaiStore` de `@/ui/utilities/state/jotai/jotaiStore` — écrit le pending atom HORS React dans le store CUSTOM du `<Provider store={jotaiStore}>` de Twenty (cf `app/components/App.tsx`). **PAS `getDefaultStore()`** : Twenty enveloppe l'app d'un store custom, écrire dans le store par défaut = store fantôme que les rows ne lisent pas → aucune row ne scintille (bug live staging 2026-06-17). `jotaiStore` est un `let` réassigné au logout → lu en LIVE. Aussi : `veridianPendingOpenKeysState` + `VERIDIAN_RECORD_OPEN_DELAY_MS`. MANAGER module-level : Map de timers (décompte qui SURVIT au démontage), pending atom (scintillement row), garde d'idempotence (1 écriture/ouverture). Expose `scheduleRecordOpen` / `cancelRecordOpen` / `isRecordOpenPending` / `buildRecordOpenKey`. | 2026-06-17 |
| `veridian-record-open/states/veridianPendingOpenKeysState.ts` | `createAtomState` de `@/ui/utilities/state/jotai/utils/createAtomState`. Atom global réactif portant le `Set<openKey>` des décomptes en cours (plusieurs en parallèle possibles) → écrit par `recordOpenManager`, lu par `RecordTableTr` (scintillement). | 2026-06-17 |
| `Dockerfile.veridian` (fichier custom Veridian, hors arbre upstream) | doit lister TOUS les workspaces du front dans `yarn workspaces focus` + les `COPY package.json` + `COPY` répertoire. Sensible à tout ajout/rename/scission de package upstream. Au sync 2026-06-13 : ajout de `twenty-ui-deprecated` (focus L45 + COPY L38/L106). | 2026-06-13 |

## Procédure de sync upstream (quand on bumpe le marker)

1. `git merge <upstream-tag>` — résoudre les conflits.
2. `bash scripts/ci/check-ee-integrity.sh <nouveau-marker>` → 0 fichier EE modifié.
3. CI `veridian-patch-survival` vert → aucun patch inline écrasé.
4. Bump du marker = **changement structurel** (gate staging avant prod, cf
   `docs/spec/AUDIT-OUTBOUND-LEAKS.md` + NOTE-CI-FORK-TWENTY §5).
5. Mettre à jour le marker par défaut dans `check-ee-integrity.sh` + ce fichier.
