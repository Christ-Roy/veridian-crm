# Kanban « Engagement tunnel » — les events font avancer le prospect de colonne

> **Sévérité** : 🟡 P1 (vision Robert 2026-06-14 — le commercial doit VOIR l'avancement, pas lire un score)
> **Owner** : agent CRM (structure Twenty) + agent tunnel (writer bridge, ticket miroir ci-dessous)
> **Créé** : 2026-06-14
> **Déposé par** : agent tunnel-de-vente (via Robert)
> **DoD parent** : `veridian-tunnel-de-vente/docs/DEFINITION-OF-DONE-V1.md` §1.1 (kanban) + §1.3 (capture événementielle)
> **Contrat** : `veridian-tunnel-de-vente/docs/CONTRATS-TUNNEL.md` §4b / §4c (mapping stages)

## Vision Robert (verbatim structuré, 2026-06-14)

> « Il faut que les événements principaux du tunnel de vente engendrent de
> changer de colonne les prospects dans le tunnel pour avancer d'un cran : genre
> ouverture de mail, atterrissage sur la page audit (avec score de complétude et
> de visite du reste), éventuellement si le cookie a été accepté, puis création
> de compte Veridian, et enfin prise de rendez-vous Cal.com. »

**Décisions tranchées avec Robert (2026-06-14) :**
1. **Axe = NOUVEAU kanban d'engagement DÉDIÉ**, séparé du pipeline commercial
   Opportunity (NEW→SCREENING→MEETING→PROPOSAL→CUSTOMER reste intact pour les sales).
2. **Déclenchement = présence de l'event suffit** (pas de seuil de score pour
   avancer). Le **score affine le tri DANS la colonne** (chaud→froid), il ne
   décide jamais du déplacement.

## Les colonnes (ordre figé, values UPPER_SNAKE car le bridge les écrit)

| Ordre | Value | Label FR | Event déclencheur (source) |
|---|---|---|---|
| 0 | `ENVOYE` | Mail envoyé | `email.sent` (Notifuse → bridge) |
| 1 | `MAIL_OUVERT` | Mail ouvert | `email.opened` (Notifuse → bridge) |
| 2 | `PAGE_VISITEE` | Page audit visitée | `audit.page_view` (Analytics → bridge) |
| 3 | `COOKIE_ACCEPTE` | Cookie accepté | `consent_granted` (Analytics → bridge) |
| 4 | `COMPTE_CREE` | Compte Veridian créé | `signup` (Hub → Analytics → bridge) |
| 5 | `RDV_PRIS` | RDV pris | `audit.rdv` / `rdv_booked` (Cal.com → Analytics → bridge) |

**Note Robert "score de complétude et de visite"** : ce n'est PAS un seuil
d'avancement (tranché : présence suffit). C'est le **tri intra-colonne** —
dans `PAGE_VISITEE`, les prospects qui ont scrollé loin / passé du temps
remontent en haut (score DESC). Le commercial appelle d'abord le haut de pile.

## Règle d'avancement (INVARIANT)

- **On n'avance JAMAIS en arrière.** Ordre strict `ENVOYE < MAIL_OUVERT <
  PAGE_VISITEE < COOKIE_ACCEPTE < COMPTE_CREE < RDV_PRIS`. Un event d'un cran
  inférieur à l'état courant = ignoré pour le stage (compté quand même au score
  + timeline). Même logique que §4c.6 du contrat (« un stage ne recule jamais »).
- **`COOKIE_ACCEPTE` est un cran optionnel** : un prospect peut sauter de
  `PAGE_VISITEE` à `COMPTE_CREE` sans passer par cookie (s'il refuse les
  cookies). On avance au **max** atteint, on ne bloque pas sur les crans sautés.
- Le **field engagement est sur la Person** (le prospect EST le sujet du tunnel),
  pas sur l'Opportunity. Le pipeline Opportunity commercial reste indépendant.

## 🔴 QUI écrit le stage = le BRIDGE, pas un workflow Twenty

**Invariant contrat §4c.5 : le bridge est la SEULE voie d'écriture automatisée
vers Twenty.** Donc :
- L'avancement de colonne est posé par le **writer du bridge** (`pushScores` /
  équivalent), en même temps qu'il pose le score, au moment où il traite l'event.
  → ticket miroir côté `veridian-tunnel-de-vente` (le bridge est dans MON repo).
- **PAS de workflow natif Twenty** sur DATABASE_EVENT pour ça : ça créerait un
  second écrivain → casse l'idempotence et la dédup `(message_id, type)`. Le
  workflow natif Twenty reste réservé à la **promotion cold→Person** (déclenchée
  par action HUMAINE = déplacement kanban coldProspect), pas à l'engagement.

### Ce que l'agent CRM doit livrer (CE ticket)

1. **Field Person `engagementStage`** : SELECT, values = les 6 ci-dessus,
   default `ENVOYE`, ordre/labels FR comme la table. Via twenty-iac (additif).
2. **Vue KANBAN « Tunnel — Engagement »** : type KANBAN sur Person,
   `mainGroupByFieldName = engagementStage`, tri secondaire score DESC dans
   chaque colonne, filtre `isTestProspect=false` + `doNotContact=false`.
3. **Item sidebar** sous le FOLDER « Tunnel de vente » : 🎯 Engagement
   (item VIEW → la vue kanban ci-dessus). Cf giga-ticket cold-call §B sidebar.
4. **Versionner dans `iac/tunnel-de-vente.workspace.yaml`** (le field + la vue +
   l'item sidebar) → rejouable client en 1 `apply`. Re-apply = 0 mutation.
5. **Appliquer sur le workspace STAGING d'abord** (`crm.staging`, schema
   `workspace_a5u89zclrdt5s7lgnq6vs43cz`), validation visuelle Chrome, PUIS prod
   commercial en additif (zéro suppression).

### Ce que l'agent CRM NE fait PAS

- Il n'écrit pas la logique d'avancement (c'est le bridge → ticket miroir).
- Il ne touche pas au pipeline Opportunity existant.
- Il ne crée pas de workflow natif pour l'engagement.

## Tests d'acceptation

1. Le field `engagementStage` existe sur Person, 6 values, default `ENVOYE`.
2. La vue kanban « Tunnel — Engagement » s'affiche (Chrome), 6 colonnes ordonnées,
   prospects triés score DESC dans chaque colonne.
3. Item sidebar 🎯 Engagement ouvre la vue.
4. `twenty-iac.py apply` sur workspace vierge reproduit field+vue+sidebar ;
   re-apply = 0 mutation.
5. (Gate joint avec le ticket bridge) un event `email.opened` simulé déplace le
   prospect test de `ENVOYE` → `MAIL_OUVERT` dans le kanban, un `audit.page_view`
   le pousse à `PAGE_VISITEE`, etc. — vérifié par le tunnel-e2e.

## Références

- Stages actuels : `CONTRATS-TUNNEL.md` §4b/§4c.6
- Events disponibles : `CONTRATS-TUNNEL.md` §4a (site), §4a-bis (Hub signup/app_started)
- Structure Person existante : §4c (score, providerClass, auditSlug, doNotContact, mailingBatch)
- Sidebar/IaC : `veridian-tunnel-de-vente/todo/2026-06-11-espace-cold-call-...md` §B/§E
