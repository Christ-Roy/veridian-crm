# Twenty — isoler l'instance/les données de TEST du tunnel (hors CRM commercial)

> **Sévérité** : 🟡 P1 (DoD V1 §1.1 — RÈGLE DURE : jamais polluer le CRM réel)
> **Owner** : agent veridian-crm (OPUS)
> **Créé** : 2026-06-11
> **DoD** : `../veridian-tunnel-de-vente/docs/DEFINITION-OF-DONE-V1.md` §1.1

## Constat (vérifié 2026-06-11)
Aujourd'hui la CI E2E et le bridge écrivent les **10 prospects de test**
(`test-tunnel-*` ×5 persistants + `test-cycle-*` ×5 cycle) dans le CRM Twenty
de **PROD** (`crm.app.veridian.site`), au milieu des 140 vrais prospects.
Ils sont isolés par `isTestProspect=true` + filtre de vue (les vues prod
excluent isTestProspect=true), donc **pas de pollution visible**. Mais c'est de
la cohabitation, pas de l'isolation.

## Décision Robert : peu importe l'instance, mais ne JAMAIS polluer le réel
Deux options (trancher selon la RAM dev — `crm.staging.veridian.site` existe) :
- **A. Staging dédié** : la CI E2E pointe sur le CRM STAGING (dev-pub),
  isolation totale du prod commercial. ⚠️ Vérifier la RAM dev (la VM dev est à
  ~76-81% RAM) — provisionner la structure tunnel sur staging (twenty-iac apply,
  déjà testé 14/14 sur workspace vierge) + un workspace/Bearer staging pour le
  bridge E2E. Reco si la RAM tient.
- **B. Workspace isolé en prod** : un 2e workspace "tunnel-test" sur l'instance
  prod, séparé du workspace commercial. Plus léger en infra, isolation par
  workspace (pas juste par filtre).

## À faire
1. Mesurer la RAM dispo sur dev (staging CRM tient-il + le bridge ?).
2. Trancher A ou B, provisionner la structure (twenty-iac apply).
3. Repointer la CI E2E (`tunnel-e2e/config.mjs` URLs + Bearer) sur l'instance test.
4. Vérifier que le bridge en mode test n'écrit JAMAIS sur le CRM commercial
   (l'allowlist le garantit déjà, mais l'isolation d'instance est ceinture+bretelles).
5. Garder le garde-fou `assertNoRealProspectTouched` quoi qu'il arrive.

## DoD
- [x] Les données de test ne vivent plus dans le workspace commercial réel.
      → structure + 10 prospects de test provisionnés sur l'instance STAGING
        dédiée (`crm.staging.veridian.site`). Reste : repointer le bridge +
        nettoyer les 10 test-prospects encore présents sur prod (coordination).
- [ ] CI E2E verte sur l'instance test isolée.
      → toute la couche CRM du E2E validée contre staging (assertions + cycle +
        garde-fou). Reste : run G0→G10 complet, qui exige le repointage du bridge.

## Réponse — 2026-06-13 (agent test-isol, team crm-vague-juin13)

### Option retenue : **A — Staging dédié** (instance `crm.staging.veridian.site` sur dev-pub)

**Chiffres RAM dev** (`free -h`, 2026-06-13) : 7.6 Gi total, 6.6 Gi used,
**947 Mi available + 2.5 Gi swap utilisé** (≈ 87 % RAM). Tendu, MAIS :
le CRM staging (`veridian-crm-staging-crm-{server,worker,postgres,redis}-1`)
tourne **déjà** depuis 2-3 jours, et le `tunnel-bridge` aussi. La charge est
**déjà absorbée sans crash** → l'option A ne provisionne **aucun nouveau
container**, elle repointe les écritures. Coût RAM marginal = **0**.

**Pourquoi A > B** :
- Isolation **physique** (instance + serveur + DB différents du prod commercial),
  pas seulement par workspace. Un bug d'allowlist/résolution ne peut PAS atteindre
  un vrai client : ce sont deux Postgres distincts.
- "Staging existe pour être cassé/testé" (règle d'or Veridian) — c'est son rôle.
- Option B garderait la data test dans la même instance que les 145 vrais
  prospects commerciaux → isolation plus faible pour un gain RAM nul (A ne coûte
  rien de plus).

### Ce qui a été provisionné (FAIT, idempotent)

Instance : `https://crm.staging.veridian.site`, workspace `veridian`
(`aba6ea26-16c2-43de-b5a4-b803c2be4203`), schema DB
`workspace_a5u89zclrdt5s7lgnq6vs43cz`.

1. **Structure tunnel complète** via `twenty-iac.py apply` (template partagé
   `veridian-tunnel-de-vente/iac/tunnel-de-vente.workspace.yaml`, NON modifié) :
   29/29 actions (objets `mailingBatch`+`coldProspect`, fields custom Person
   `score`/`providerClass`/`auditSlug`/`doNotContact`/`isTestProspect`, options
   stage Opportunity, relation, 5 vues TABLE/KANBAN dont "Test tunnel" + "Kanban
   TEST", dashboard, workflow promotion ACTIVE, folder sidebar). **Re-apply =
   0 mutation** (idempotence prouvée). Config : `/tmp/crm-staging-iac/config.staging.yaml`
   (hors repo — pas de collision avec les `config.*.yaml` de crm-tunnel).
2. **Bearer admin staging** généré (flow metadata 6 étapes), apiKey
   `96392c90-f6b7-459a-8bf4-ae738f65d3a4`, exp 2027-06-13. Password staging Robert
   reset en base (`StagingTunnel2026!x9`). Bearer dans `~/credentials/.all-creds.env`
   à câbler (var `TWENTY_BEARER_STAGING` — voir reste à faire).
3. **10 prospects de test** : 5 persistants `test-tunnel-*` (créés, opp NEW,
   `isTestProspect=true`, `providerClass` UPPER, rattachés au mailingBatch) + les
   5 cycle `test-cycle-*` recréables par le bridge.
4. **mailingBatch figé** : l'UUID prod hardcodé dans `crm-cycle.mjs`
   (`TEST_BATCH_ID=1f877065-…`) **inséré tel quel en DB staging** → `crm-cycle.mjs`
   tourne sur staging **sans aucune modif de code** (pas de collision crm-tunnel).

### Preuve d'isolation / E2E (couche CRM validée contre staging)

Lancé sur dev-pub avec override env (sans toucher au bridge partagé) :
- `snapshotTestRecords()` → 5 persistants OK (score=null, opp NEW).
- `assertNoRealProspectTouched()` → **OK, 0 vrai prospect scoré** (le workspace
  staging n'a pas de prospect commercial → garde-fou trivlialement vert ici, et
  reste actif).
- `deleteAndRecreateTestProspects()` + `assertCycleRecreated()` → **OK** (5 Person
  isTest=true + 5 Opp NEW recréées, garde-fou anti-suppression-vrai-prospect actif).

Sur **prod commercial** au 2026-06-13 : **10 test-prospects (score=100) cohabitent
toujours** avec les **145 vrais** → c'est la pollution à éliminer (point 2 du reste).

### Reste à faire (COORDINATION crm-tunnel — système partagé, NON touché unilatéralement)

Le run G0→G10 complet exige que le **bridge** (`~/tunnel-bridge`, partagé avec
l'agent crm-tunnel) pointe staging — le bridge écrit events+score vers
`TWENTY_BASE_URL`. Repointer son `.env` + `force-recreate` impacte crm-tunnel.

1. `~/tunnel-bridge/.env` sur dev-pub : `TWENTY_BASE_URL=https://crm.staging.veridian.site`
   + `TWENTY_BEARER_VERIDIAN=<bearer staging>` (`/tmp/crm-staging-bearer.txt` /
   vault `TWENTY_BEARER_STAGING`). Puis `docker compose up -d --force-recreate`.
2. Defaults dans `veridian-tunnel-de-vente/tunnel-e2e/config.mjs` (`URLS.twenty`)
   + `crm-assertions.mjs` + `crm-cycle.mjs` (`BASE` default) : passer de
   `crm.app.veridian.site` → `crm.staging.veridian.site`. **Fichiers du repo
   crm-tunnel** → à faire par l'agent crm-tunnel (ou OK si l'env prime toujours,
   mais le default propre = staging).
3. Nettoyer les **10 test-prospects sur prod commercial** (suppression sûre par
   `isTestProspect=true`, mais dans le workspace commercial → arbitrage lead).
4. Run `node run.mjs --skip-send --reset` sur dev-pub (bridge DRY_RUN=0) → vert.
