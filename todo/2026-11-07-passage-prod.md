# Passage de Twenty en prod : ce qui reste, chiffres à l'appui

Décisions tranchées (parente, 07/11/2026) : pas de migration, archive intacte, base neuve ; « Veridian CRM » ;
`crm.app.veridian.site` ; double authentification au Hub seul. Nœud retenu par `infra` : `ovh-prod`.
Jobs prêts, non déployés : `deploy/crm-db.nomad.hcl` (Postgres, Redis, pgBackRest) et `deploy/crm-prod.nomad.hcl` (serveur, worker).

## Ce qui bloque, dans l'ordre

1. **`infra` donne le signal** après la bascule Hub de 23h, même nœud : rien avant.
2. **`infra` déclare** `@job crm-db prod` dans `nodes/fusibles-io.conf` (seul ✗ de `nomad-v preflight deploy/crm-db.nomad.hcl`) et ajoute `crm-db` à `jobs/SOURCES.tsv`.
3. **La parente fait rendre public le code du fork** par Robert (AGPL) : le lien du pied de page mène sinon à un 404 pour un client. Bloque l'ouverture aux clients, pas le déploiement.

## Passage

1. Secrets neufs, jamais ceux du staging, en hexadécimal car ils entrent dans des URL :
   `nomad/jobs/crm-db` : `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, plus `SFTP_REPO_*` et `PGBACKREST_CIPHER_PASS` posés par `infra` ;
   `nomad/jobs/crm` : les mêmes `POSTGRES_PASSWORD` et `REDIS_PASSWORD`, `APP_SECRET`, `HUB_API_SECRET`.
2. Volumes sur `ovh-prod`, commandes en tête de chaque job. DNS `crm.app` et `*.crm.app` : vérifier qu'ils pointent sur l'ingress du nœud.
3. Promouvoir `staging` sur `main`, ou laisser `jobs/SOURCES.tsv` sur `origin/staging` tant que `main` n'existe pas : à décider avec `infra`.
4. `echo oui | timeout 280 nomad-v deploy deploy/crm-db.nomad.hcl`, puis `deploy/crm-prod.nomad.hcl`. La base doit être saine avant le serveur : pas de tâche d'attente, le `restart` couvre.
5. Épreuves sur ce qui est servi : `capture-sortante.sh` lancée dès le démarrage (elle vise un conteneur du job, à adapter : `crm-db` ne redémarre plus avec l'app), `parcours-staging.py https://crm.app.veridian.site`, `charge-staging.py` hors heures de bureau sur ce nœud partagé, comparer les variables au staging, `pnpm test:systeme` avec `TWENTY_URL=https://crm.app.veridian.site`.
6. Écrire à `infra` dès que le service répond : blackbox, `sonde-prod.sh`, stanza, dépôt et drill pgBackRest, volume `storage`.
7. Pointer le Hub de prod sur `CRM_*` : URL et secret, à faire avec la session Hub.

## Limites d'infra à garder en tête

Disque d'`ovh-prod` : 40 Go libres et alerte à 20 Go. Twenty en prend moins de 1 Go sans client : à signaler à `infra` si la croissance dépasse 15 Go.

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
- Mettre à jour l'image coupe le serveur le temps de son démarrage, environ 2 min. Base et file de tâches restent up.
- `crm-db` et le lien par `nomadService` n'ont jamais tourné : le premier déploiement est leur première épreuve.
- Pas de volume réel testé au-delà de 5 000 sociétés. Fonctions Veridian retirées : `VERIDIAN-PATCHES.md`, « Retiré ou reporté ».
