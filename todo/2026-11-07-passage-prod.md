# Passage de Twenty en prod : ce qui reste, chiffres à l'appui

Décisions tranchées (parente, 07/11/2026) : pas de migration, archive intacte, base neuve ; « Veridian CRM » ;
`crm.app.veridian.site`. Job prêt, non déployé : `deploy/crm-prod.nomad.hcl`. `nomad-v preflight` refuse pour les seuls
manques listés ici.

## Prérequis hors de ce dépôt

| Qui | Quoi | Mesure de fin |
|---|---|---|
| infra | nœud : 2 cœurs réservés, 4 Go, 20 Go de disque (`noeud_provider`) | `nomad-v plan` place le job |
| infra | `jobs/WORKLOAD-CONTRACTS.tsv` : `crm saas-prod B growth availability-99.9 5 15 local-state local-gap false`, `jobs/SOURCES.tsv` : `deploy/crm-prod.nomad.hcl` sur `origin/main` | `nomad-v preflight` vert |
| infra | sauvegarde : ligne `crm\|twenty\|twenty\|10` dans `backups/prod-r2-backup-remote.sh`, plus le volume `storage` | restauration relue |
| infra | surveillance : cible blackbox `crm.app.veridian.site/healthz` dans `mon-prometheus`, ligne dans `monitoring/sonde-prod.sh`, `alertes-grafana.py` | alerte vue sur un arrêt |
| infra | `trivy` absent du runner de build : la CI sort « non abouti » ; `nomad-v preflight` échoue sur nos images faute de `--image-src remote` | scan rendu dans la CI et le preflight |
| Robert, par la parente | rendre public le code du fork (AGPL) : le lien du pied de page mène sinon à un 404 pour un client | lien ouvert hors session |
| Nous | secrets neufs `nomad/jobs/crm`, DNS `crm.app` et `*.crm.app`, volumes, promotion de l'image sur `main`, Hub de prod pointé sur `CRM_*` | parcours sur `crm.app` |

Au jour J : capture réseau sur le démarrage et le parcours (`capture-sortante.sh`), comparer les variables au staging, `parcours-staging.py`.

## Chiffres (staging, bastion partagé, 6 cœurs, 07/11/2026, image `staging-f427e79`)

- Charge `charge-staging.py`, 5 000 sociétés, 60 % liste, 30 % filtre, 10 % création, sans temps de réflexion, 0 erreur :
  1 client 12,6 req/s p95 95 ms · 5 clients 46,6 req/s p95 146 ms · 20 clients 47 req/s p95 784 ms · 50 clients 53 req/s p95 2 271 ms.
  Plafond autour de 50 req/s, un seul processus Node. Rejouer sur le nœud retenu : ce relevé dépend de la charge du bastion.
- Insertion : 400 sociétés/s. Provisioning : 12 s au calme, jusqu'à 137 s sur nœud saturé.
- Mémoire de pointe (`memory.peak`) : serveur 1 160 Mo, worker 1 034 Mo, Postgres 308 Mo, Redis 140 Mo, soit 2,6 Go.
- Démarrage : 215 s pendant cette mesure, 110 s sur nœud libre, plus de 20 min saturé.
- Sauvegarde et restauration exercées (`pg_dump -Fc`, `pg_restore` dans une base temporaire) : 1 s et 6 s, 6 schémas, 40 comptes, 42 liens identiques.
  Base de 70 Mo qui se restaure en 21 Mo : créer et retirer des espaces laisse de l'espace mort.
- Sur l'image servie `staging-e0376ab` : trivy par le registre, 0 HIGH et 0 CRITICAL ; capture réseau de 660 s, démarrage et parcours compris, silence et témoin vu ;
  parcours 61 contrôles OK, 0 échec ; 24 sabotages détectés sur 24 (CI). `user=1000`, `cap_drop=ALL`, capacités effectives à zéro.

## Limites connues

- `EMAIL_DRIVER=logger` : aucun email ne part, envois de workflow compris, et le rebrand des gabarits (`twenty-emails`) reste à faire si on branche un relais.
- Un seul groupe Nomad : mettre à jour l'image redémarre aussi Postgres et Redis, coupure égale au démarrage.
- Pas de volume réel testé au-delà de 5 000 sociétés. Fonctions Veridian retirées : `VERIDIAN-PATCHES.md`, « Retiré ou reporté ».
