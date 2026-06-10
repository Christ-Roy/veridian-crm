# Journal IaC — structure "Tunnel de vente" (workspace Veridian prod)

> **Sévérité** : 🟢 P2 (journal de référence, pas un ticket d'action)
> **Owner** : agent twenty-crm (sprint tunnel-de-vente, TaskList #9)
> **Créé** : 2026-06-10
> **Pourquoi** : SPEC-IAC-TWENTY.md §5 exige un journal exact de tout ce qui
> est créé à la main par API, pour que l'`export` IaC soit diffé contre cette
> liste (zéro oubli). Noms camelCase = clés IaC stables, NE PAS renommer.

Workspace : `veridian` prod (`a8fe3bdf-8aa2-4e65-975b-98f57b61a1ae`),
`https://veridian.crm.app.veridian.site/`. Tout créé via REST
`/rest/metadata/*` le 2026-06-10 (Bearer Robert API_KEY).

## Fields ajoutés sur `person` (standard object)

| name (clé IaC) | type | label | id (workspace veridian) | Rôle contrat |
|---|---|---|---|---|
| `score` | NUMBER | Score tunnel | `638613e7-3aef-4853-a8f7-f27206ce5237` | score comportemental agrégé, poussé par le bridge (Analytics) |
| `providerClass` | SELECT | Provider | `f4ba9f29-4768-445d-9980-9d424bf83d3c` | classe canonique provider (contrat §1) |
| `auditSlug` | TEXT | Audit Slug | `cb557bc7-6af5-46ce-ae3a-288d635ad8ba` | jointure events Analytics ↔ Person (archi A2) — figé par audit-gen |
| `doNotContact` | BOOLEAN (default false) | Ne plus contacter | `8a9016d8-2eca-4f75-b139-56d416dbb83d` | registre de suppression (archi A4) |
| `mailingBatch` | RELATION MANY_TO_ONE → mailingBatch | Batch | `96f23a9e-9eec-46a5-80e3-6288b2b09bdc` | rattachement à la vague d'envoi |

### Options `providerClass` (⚠️ piège API)

**Twenty refuse les values SELECT non UPPER_SNAKE_CASE** (testé : PATCH avec
`google` → 400 `INVALID_FIELD_INPUT`). Les values canoniques lowercase du
contrat §1 sont donc mappées `upper()` côté Twenty, labels = forme canonique :

| value Twenty | label | contrat §1 |
|---|---|---|
| `GOOGLE` | google | google |
| `MICROSOFT` | microsoft | microsoft |
| `YAHOO_AOL` | yahoo_aol | yahoo_aol |
| `FREEMAIL_FR` | freemail_fr | freemail_fr |
| `CORPORATE` | corporate | corporate |

→ Règle producteur (batch/bridge) : `providerClass = provider_class.upper()`.
→ À encoder dans l'outil IaC (validation des values déclarées).

## Custom object `mailingBatch`

- `nameSingular: mailingBatch`, `namePlural: mailingBatches`,
  labels "Mailing Batch"/"Mailing", icon IconSend.
  id : `4f082510-a2fc-48f2-bfd3-a638dbf49a6b`
- Endpoints auto-générés : `/rest/mailingBatches`, `/rest/batch/mailingBatches`
- Fields :
  - `batchId` TEXT (id `8174babc-c00c-4ebb-b840-41e708b78a14`) — identifiant
    immuable de l'artefact batch JSON (contrat §2)
  - `statut` SELECT (id `0076dc70-33a2-47f8-ae8c-5dd732b9febf`) — options
    `PREPARE` / `ENVOI_EN_COURS` / `ENVOYE` / `TERMINE`
  - `prospects` (côté inverse de la relation person.mailingBatch, auto-créé)

## Pipeline `opportunity.stage` — labels renommés (values INTACTES)

fieldMetadata id `6bd6408b-abd6-45ea-8330-59dd1e402573`. Les crons phase 0
(`/opt/veridian/prospection-sender/` sur dev-pub) écrivent les VALUES — ne
jamais les changer :

| value (contrat, stable) | label UI (nouveau) | écrit par |
|---|---|---|
| `NEW` | À contacter | import batch |
| `SCREENING` | Contacté | sender (mail parti) |
| `MEETING` | Répondu — tiède | reply-checker IMAP |
| `PROPOSAL` | Chaud — RDV/négo | sales (manuel) |
| `CUSTOMER` | Client | sales (manuel) |

## Vue "Tunnel de vente" (TABLE sur person)

- viewId : `80626b7b-5436-469a-8d1a-453545178eb5`, icon IconFlame
- Colonnes (ordre) : name, score, providerClass, emails, phones, company,
  city, auditSlug, mailingBatch, doNotContact
- Tri : `score DESC` (viewSort `c77c3b87-…`)
- Filtre : `doNotContact IS false` (les 145 records existants ont `false`
  posé par le default Postgres, vérifié — aucun masqué)
- Visible par tous les membres du workspace (Robert + Guilhem aujourd'hui).

## Backfill

`providerClass` backfillé sur les ~145 Person existantes par suffixe domaine
(fallback contrat §1), script `/tmp/backfill_provider.py`, PATCH ~0.7s/req
(rate limit + piège 429 documenté skill admin-twenty).

## Non fait (volontairement)

- Pas de webhook sortant Twenty (`/rest/metadata/webhooks`) : le tunnel est
  un flux ENTRANT vers Twenty ; le webhook bridge attendra la décision A1
  (bridge dédié) et l'URL réelle du bridge.
- Pas de record mailingBatch pour la vague phase 0 : le batchId officiel
  naîtra du premier artefact batch JSON (contrat §2).
- Pas d'invitation sales : en attente liste Robert + arbitrage A5
  (workspace Robert vs workspace dédié). Structure 100 % rejouable par IaC
  si A5 = workspace dédié.

## YAML déclaratif (format SPEC-IAC-TWENTY §2 — diff cible pour l'export)

```yaml
# tunnel-de-vente.workspace.yaml — état CIBLE (capturé du travail manuel 2026-06-10)
version: 1
template: tunnel-de-vente

objects:
  - nameSingular: mailingBatch
    namePlural: mailingBatches
    labelSingular: Mailing Batch
    labelPlural: Mailing
    icon: IconSend
    description: Lot d envoi de campagne tunnel de vente (contrat batch §2)
    fields:
      - { name: batchId, type: TEXT, label: Batch ID, icon: IconHash }
      - name: statut
        type: SELECT
        label: Statut
        icon: IconMail
        options:
          - { value: PREPARE,        label: Préparé,             color: gray,      position: 0 }
          - { value: ENVOI_EN_COURS, label: Envoi en cours,      color: blue,      position: 1 }
          - { value: ENVOYE,         label: Envoyé,              color: green,     position: 2 }
          - { value: TERMINE,        label: Terminé (suivi clos), color: turquoise, position: 3 }

extendObjects:
  - nameSingular: person
    fields:
      - { name: score,     type: NUMBER,  label: Score tunnel,      icon: IconFlame }
      - { name: auditSlug, type: TEXT,    label: Audit Slug,        icon: IconLink }
      - { name: doNotContact, type: BOOLEAN, label: Ne plus contacter, icon: IconBan, defaultValue: false }
      - name: providerClass
        type: SELECT
        label: Provider
        icon: IconMailCog
        # ⚠️ values UPPER_SNAKE_CASE imposées par l'API (400 sinon) — labels = canonique contrat §1
        options:
          - { value: GOOGLE,      label: google,      color: red,    position: 0 }
          - { value: MICROSOFT,   label: microsoft,   color: blue,   position: 1 }
          - { value: YAHOO_AOL,   label: yahoo_aol,   color: purple, position: 2 }
          - { value: FREEMAIL_FR, label: freemail_fr, color: orange, position: 3 }
          - { value: CORPORATE,   label: corporate,   color: gray,   position: 4 }
  - nameSingular: opportunity
    fields:
      # field standard `stage` : seules les OPTIONS sont déclarées (labels FR, values stables)
      - name: stage
        type: SELECT
        options:
          - { value: NEW,       label: À contacter,       color: gray,   position: 0 }
          - { value: SCREENING, label: Contacté,          color: blue,   position: 1 }
          - { value: MEETING,   label: Répondu — tiède,   color: orange, position: 2 }
          - { value: PROPOSAL,  label: Chaud — RDV/négo,  color: red,    position: 3 }
          - { value: CUSTOMER,  label: Client,            color: green,  position: 4 }

relations:
  - from: { object: person, field: mailingBatch }
    to:   { object: mailingBatch }   # côté inverse auto-créé : mailingBatch.prospects
    type: MANY_TO_ONE
    label: Batch

views:
  - object: person
    name: Tunnel de vente
    type: TABLE
    icon: IconFlame
    fields: [ name, score, providerClass, emails, phones, company, city, auditSlug, mailingBatch, doNotContact ]
    sorts:  [ { field: score, direction: DESC } ]
    filters: [ { field: doNotContact, operand: IS, value: "false" } ]

webhooks: []   # volontaire — flux entrant uniquement ; le webhook bridge attendra l'URL réelle (A1)
```
