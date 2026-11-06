# Twenty — vue KANBAN tunnel V1 + prospects test supprimé/relancé + instance test

> **Sévérité** : 🔴 P0 (V1 DoD)
> **Owner** : agent veridian-crm (OPUS)
> **Créé** : 2026-06-10 (par lead tunnel-de-vente)
> **DoD** : `../veridian-tunnel-de-vente/docs/DEFINITION-OF-DONE-V1.md` §1.1
> **Skill** : `admin-twenty` (provisioning, structure, API)

## Contexte
La structure tunnel existe (fields Person score/providerClass/auditSlug/
doNotContact/mailingBatch/isTestProspect, vue "Tunnel de vente" TABLE triée
score DESC, vue "Test tunnel" filtre isTestProspect=true). Il MANQUE pour la V1 :

## À faire
1. **Vue KANBAN d'avancée** dans le tunnel (pas juste une table triée). Colonnes
   = stages du funnel (NEW/SCREENING/MEETING/PROPOSAL/CUSTOMER ou un découpage
   "froid/tiède/chaud" selon score). Le commercial regarde le kanban et sait
   **qui appeler en priorité**. Via API metadata Twenty (skill admin-twenty,
   kanban = view type KANBAN sur Opportunity ou Person). Onglet "Tunnel de vente
   — TEST" dédié pour la CI.
2. **Timeline par prospect** : vérifier que chaque prospect affiche bien sa
   timeline avec les events tunnel (email.sent/opened/clicked, audit.*, etc.).
   La structure timelineActivities existe — valider le rendu et l'ordre.
3. **Prospects test "supprimé/relancé"** : exposer/documenter le cycle complet
   création→suppression→recréation de Person de test via API, pour que la CI
   E2E le rejoue (pas juste un reset de champs). Fonction propre dans le skill
   ou un script du repo CRM. Garde-fou : jamais un vrai prospect.
4. **Instance test** : trancher (peu importe pour Robert, contrainte RAM dev) :
   - vérifier la RAM dispo sur dev (`crm.staging.veridian.site` existe) ;
   - SI staging tient → la CI E2E écrit en STAGING (isolation totale du CRM
     commercial). SINON → workspace/onglet isolé en prod, records
     isTestProspect=true filtrés hors de la vue prod.
   - RÈGLE DURE : jamais polluer le CRM commercial réel.

## Garde-fous
- OPUS. Zéro contournement — API/DB Twenty natives, pas de store maison.
- Cadre AGPL/EE : kanban/views = AGPL natif (déjà vérifié), pas de RLS EE.
- Tout en template/IaC rejouable (cf ticket template-iac, §1.4 DoD).

---

## ✅ Réalisé — 2026-06-11 (agent crm-tunnel OPUS)

### 1. Timeline UI lisible (finding bloquant du lead) — FAIT
Module front neuf `packages/twenty-front/src/modules/veridian-tunnel-timeline/`
(rendu riche des events `email.*`/`audit.*`/`score.*`) + 3 patchs inline AGPL
(EventRowDynamicComponent, EventIconDynamicComponent early-checks ; filtre du
bruit `person.updated{score}` du bridge dans filterOutInvalidTimelineActivities).
Libellés FR commerciaux (« Email envoyé », « A cliqué le lien », « A visité sa
page audit », « A pris rendez-vous », « Palier de score franchi »…), icônes
parlantes (toutes présentes dans la liste curée twenty-ui, zéro patch
TablerIcons), heure = `happensAt` (heure réelle de l'event, pas l'écriture),
détails discrets (batchId/messageId/url/eventId). Patchs tracés
`VERIDIAN-PATCHES.md` + 4 specs patch-survival `*.veridian.spec.(ts|tsx)`.
**Dette CI corrigée** : nouveau job `veridian-front-unit` dans
`veridian-crm-ci.yaml` (les tests front ne tournaient nulle part).

### 2. Vue KANBAN tunnel — FAIT
2 vues KANBAN natives (AGPL, `type:KANBAN` + `mainGroupByFieldMetadataId` sur
`opportunity.stage`, 5 colonnes NEW→CUSTOMER labels FR) créées via
`/rest/metadata/views` :
- `Tunnel — Kanban` (`7a22576e-…`) — vue commerciale (qui rappeler).
- `Tunnel — Kanban TEST` (`ac39bbeb-…`, filtre `name CONTAINS TEST`) — pour la CI.
Payloads exacts documentés dans le journal IaC
(`todo/2026-06-10-journal-structure-tunnel.md` §Ajouts 2026-06-11).

### 3. Cycle supprimé/recréé — FAIT
`veridian-tunnel-de-vente/tunnel-e2e/crm-cycle.mjs` :
`deleteAndRecreateTestProspects()` (2e famille `test-cycle-*@veridian.site`,
isTestProspect=true + opportunities) DELETE puis recrée via REST batch.
Garde-fou : ne supprime QUE des records isTestProspect=true résolus par email
(lève sinon). `assertCycleRecreated` + `teardownCycleRecords` fournis.
**Validé en réel 2026-06-11** : 2 cycles delete→recreate, 0 vrai prospect touché
(`assertNoRealProspectTouched` vert).

### 4. Instance test — DÉCISION APPLIQUÉE (tranchée lead)
La CI E2E écrit en **PROD** sur les records `isTestProspect=true` : staging
dev-pub est trop juste en RAM (1.9G dispo, disque 92%). Les garde-fous existants
sont le rempart : allowlist bridge (5+5 identités test) + `assertNoRealProspectTouched`
+ vues filtrées (`isTestProspect=true` côté Test tunnel, `name CONTAINS TEST`
côté KANBAN TEST). Les 5 `test-cycle-*` + 5 `test-tunnel-*` sont 100% isolés des
vrais prospects (filtres `isTestProspect=false` sur la vue commerciale).
**Règle dure respectée : zéro pollution du CRM commercial réel.**
