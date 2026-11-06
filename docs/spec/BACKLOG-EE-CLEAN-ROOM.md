# Backlog features EE — arbitrage clean room (critère revente)

> **Créé** : 2026-06-10 (mandat Robert via team-lead, TaskList #20).
> **Critère qui décide tout, feature par feature** : *"un hack temporaire ici
> nous forcera-t-il à tout réécrire le jour où on REVEND la création de
> tunnels de vente à des tiers ?"* — OUI → clean room maintenant ; NON → on
> triche/ignore, on documente, backlog.
>
> ⚖️ **Cadre légal clean room (pré-requis bloquant)** : réimplémenter le
> COMPORTEMENT observable sans JAMAIS lire/copier/dériver un fichier
> `/* @license Enterprise */`. Sources autorisées : doc publique Twenty,
> comportement UI, nos propres besoins. Un sous-agent qui ouvre un fichier
> EE = mission invalidée. Réf : `AUDIT-LIMITE-EE-TWENTY.md`.

## Verdict sprint 2026-06 (validé lead) : RIEN à réimplémenter

L'audit du fork a montré que la candidate n°1 (permissions multi-sales) est
couverte **nativement en AGPL** : `role`, `object-permission`,
`field-permission`, `view-permissions`, `permission-flag` = 0 fichier EE.
→ rôle "Sales tunnel" natif (cf `todo/2026-06-10-role-sales-tunnel.md`),
zéro clean room, zéro sous-agent Opus ce sprint.

## Backlog par feature (à réviser à chaque jalon revente)

| Feature EE | Sert à | Effort clean room | Risque légal | Critère revente : hack = dette de refactor ? | Verdict |
|---|---|---|---|---|---|
| **RLS (row-level)** | cloisonner les LIGNES par rôle/client dans UN workspace | 3-5 j-agent (query-builder TwentyORM + guards + caches), risque régression élevé, douleur rebase permanente | Moyen (la frontière comportement/implémentation est fine — consigne stricte requise) | **NON tant que** le modèle de vente = 1 workspace par client (l'isolation native schema-per-workspace fait le cloisonnement). OUI seulement si on vend du multi-équipe DANS un même workspace | Backlog. Déclencheur : 1er client qui exige des équipes cloisonnées intra-workspace |
| **SSO / SAML** | login entreprise des clients tiers | 2-4 j (lib passport-saml/oidc en module veridian-*, AGPL propre) | Faible (protocoles standards, zéro besoin de lire l'EE) | **NON** : OAuth Google/Microsoft natif couvre les PME cibles ; le SSO s'ajoute en module sans toucher l'existant | Backlog. Déclencheur : 1er client avec IdP d'entreprise |
| **Custom domains** (crm.client.com) | white-label revente | 1-2 j (Traefik labels + cert DNS-01, on le fait DÉJÀ à la main pour nos wildcards — hors code Twenty) | Nul (notre infra, pas une réécriture de l'EE Cloudflare) | **NON** : le subdomain `<client>.crm.app.veridian.site` suffit au lancement ; le custom domain est additif côté infra | Backlog. Déclencheur : exigence white-label d'un client payant |
| **JWT key rotation** | hygiène sécu long terme | 1-2 j (cron + double clé active) | Moyen | **NON** : rotation manuelle documentée possible ; aucun refactor induit | Backlog sécu |
| **Audit logs** | compliance (RGPD, SOC2-light) revente | 2-3 j (interceptor NestJS → table append-only, module veridian-*) | Faible | **À SURVEILLER** : si on vend à des entreprises avec exigence de traçabilité, l'absence d'audit trail historique ne se rattrape PAS rétroactivement (les events passés sont perdus) — c'est le seul cas où "attendre" a un coût irréversible | Backlog prioritaire au 1er signal compliance d'un prospect |
| **Billing v2** | facturer dans le CRM | — | — | **NON** : on facture hors CRM (décision Robert), aucun couplage | Jamais (sauf pivot) |
| **Usage tracking** | métriques par tenant | 1 j (queries SQL/groupBy sur nos propres tables) | Nul | **NON** : nos métriques = SQL direct | Jamais en clean room (besoin couvert autrement) |

## Règle de revue

À chaque jalon revente (1er client tiers signé, exigence white-label,
demande compliance), re-passer ce tableau : un "NON" peut devenir "OUI".
Le lead arbitre, AUCUN sous-agent clean room lancé sans son go explicite +
consigne légale écrite dans le prompt du sous-agent.
