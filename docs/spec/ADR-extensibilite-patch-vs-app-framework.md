# ADR — Extensibilité Veridian CRM : patch front AGPL vs framework Apps (twenty-sdk)

> **Statut** : ACTÉ 2026-06-17 (Robert + agent veridian-crm). Décision tranchée
> APRÈS test du code réel du fork, pas sur lecture de doc.
> **Portée** : toute extension de comportement de notre instance Twenty.
> **À lire AVANT** de proposer de migrer une feature vers le framework Apps ou
> de patcher le front. Cet ADR existe pour qu'on ne re-pose pas la question.

## Contexte

Twenty (≥ 2.x) expose un **framework Apps officiel** (`twenty-sdk`,
`create-twenty-app`) qui permet d'étendre une instance SANS patcher le code du
fork, en packages TypeScript installables (potentiellement revendables — aligné
avec notre objectif "instance templatée"). Trois capacités :

1. **`defineObject` / fields / views / page-layouts** — la STRUCTURE (objets
   custom, champs, vues) en code packagé.
2. **`logic-function`** — fonctions SERVERLESS. Triggers disponibles (vérifié
   dans `packages/twenty-sdk/src/sdk/logic-function/index.ts`) :
   **cron**, **database-event** (create/update/delete/upsert/restore/destroy),
   **route** (endpoint HTTP custom). RIEN d'autre.
3. **`front-component`** (dont `isHeadless`) — composants UI injectables.

La question posée (Robert, 2026-06-17) : **le framework Apps est-il la bonne
approche pour notre mécanique "ouverture de fiche"** (et features du même style),
plutôt qu'un patch du front ?

## Investigation (terrain, pas théorie)

Vérifié dans le code du fork (`packages/twenty-front` + `packages/twenty-sdk`) :

- Les `logic-function` ne s'exécutent QUE sur cron / database-event / route HTTP.
  **Aucun événement « record opened / viewed ».** (Identique aux webhooks natifs,
  cf `developers/extend/webhooks.mdx` : created/updated/deleted only.)
- Les `front-component`, même `isHeadless`, sont rendus dans DEUX contextes
  seulement :
  - **commande** : `HeadlessFrontComponentRendererEngineCommand.tsx` →
    déclenché par `useMountCommand` (action utilisateur via le command menu).
  - **widget visible** : `SidePanelFrontComponentPage.tsx` → rendu seulement si
    `viewableFrontComponentId` est défini (= l'user a ouvert ce panneau/onglet).
  `isHeadless` = « composant sans UI propre déclenché par une commande », **PAS**
  « effet qui s'auto-monte à l'ouverture passive de chaque fiche ».

## Décision

**Le framework Apps NE PEUT PAS, par conception, détecter l'ouverture passive
d'une fiche.** Ni ses triggers serveur (cron/db-event/route), ni ses modes front
(commande/widget visible) ne correspondent à « un effet qui tourne en fond dès
qu'un commercial ouvre une fiche ».

→ **Pour tout comportement qui doit réagir au CYCLE DE RENDU d'une page record
(ouverture, montage, présence), la SEULE voie est un patch front du fork** :
un module `veridian-*` neuf (AGPL) + patch inline minimal dans le composant de
page record (`RecordShowPage.tsx`), couvert par un test patch-survival. C'est
exactement le pattern `veridian-record-open` (cf `VERIDIAN-PATCHES.md`).

→ **Pour la STRUCTURE et la logique événementielle (create/update/delete, cron,
endpoints), le framework Apps EST la bonne cible** quand on voudra packager
l'instance en produit revendable. Notre structure actuelle (objets/champs/vues
via API MCP + IaC `tunnel-de-vente.workspace.yaml`) est l'équivalent fonctionnel ;
une migration vers `defineObject` packagé est une amélioration de portabilité,
pas une correction — à planifier, non urgente.

## Règle pour les agents (gravée)

| Besoin | Approche |
|---|---|
| Réagir à l'OUVERTURE / présence sur une fiche, au rendu d'une page | **Patch front AGPL** (module `veridian-*` + inline `RecordShowPage`). Seule voie. |
| Réagir à create/update/delete d'un record | logic-function (db-event) OU workflow natif OU webhook |
| Tâche planifiée | logic-function (cron) OU `all-cron` côté infra |
| Endpoint custom | logic-function (route) |
| Objets/champs/vues | API MCP + IaC (actuel) ; `defineObject` packagé (cible revendable) |
| Widget UI dans un panneau/onglet | front-component (widget) |
| Action UI déclenchée par clic/commande | front-component (commande) |

**Ne PAS** tenter de réimplémenter `veridian-record-open` en front-component :
testé, ça ne peut pas se monter automatiquement à l'ouverture. Le patch reste.

## Conséquence sur l'existant

- `veridian-record-open` (module patch front, branche staging) = **conservé**,
  c'est la bonne et seule approche. Rien à revert.
- Vision produit : `veridian-tunnel-de-vente/docs/VISION-INSTANCE-TWENTY-CUSTOM.md`
  §4 mis à jour pour pointer cet ADR.
