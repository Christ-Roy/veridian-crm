# Passage de Twenty en prod : ce qui reste, chiffres à l'appui

Décisions tranchées (parente, 07/11/2026) : pas de migration, archive intacte, base neuve ; « Veridian CRM » ;
`crm.app.veridian.site` ; double authentification au Hub seul. Nœud : `ovh-prod`, confirmé par `infra` le 08/11.
Jobs prêts, non déployés : `deploy/crm-db.nomad.hcl` (Postgres, Redis, pgBackRest) et `deploy/crm-prod.nomad.hcl` (serveur, worker).

## État au 08/11/2026, 11 h

- Nœud `ovh-prod` confirmé par `infra` pour `crm` et `crm-db`. Fenêtre : nuit du 08/11, après Notifuse, CMS et
  Prospection (à partir de 23 h). `infra` réveille la session ; rien en prod avant son message.
- Réservations d'`infra` posées, worker hors canari, `nomad-v preflight` vert sur les deux jobs (commit `0eaaaece8a`).
- Secrets neufs posés (hex) : `nomad/jobs/crm` (APP_SECRET, POSTGRES_PASSWORD, REDIS_PASSWORD, HUB_API_SECRET) et
  `nomad/jobs/crm-db` (mêmes mots de passe). `infra` y remplace SFTP_REPO_* et PGBACKREST_CIPHER_PASS par un dépôt neuf.
  Côté bastion : `CRM_HUB_API_SECRET_PROD` dans `.all-creds.env`.
- DNS : `crm.app` et `*.crm.app` résolvent déjà par le joker `*.app.veridian.site` (`infra`).
- Image candidate : `staging-d7f9354` (IA coupée), parcours staging 68 OK, preuve agent verte, le 08/11.

## AGPL : à chaque image de prod

`scripts/agpl/publier-source.sh` publie sur https://github.com/Christ-Roy/veridian-crm-source le code exact de l'image,
sans `deploy/`, `docs/`, `todo/`, `scripts/`, `.github`, environnements de test ni manifestes k8s. `publication.patch`
reprend les marqueurs anti-fuite de la première publication (07/11, `7a319d05b4`) : s'il ne s'applique plus, le refaire.

## Passage (cette nuit)

1. `scripts/agpl/publier-source.sh <commit de l'image>` ; vérifier le lien du pied de page.
2. Tag de l'image dans `deploy/crm-prod.nomad.hcl`, push `staging`, promotion `staging` sur `main` ; prévenir `infra`
   (SOURCES.tsv sur `main`).
3. Volumes sur `ovh-prod` (commandes en tête des jobs). `echo oui | timeout 280 nomad-v deploy deploy/crm-db.nomad.hcl`,
   base saine, puis `deploy/crm-prod.nomad.hcl`.
4. Épreuves sur ce qui est servi : `capture-sortante.sh` dès le démarrage (vise `crm-db`), `parcours-staging.py
   https://crm.app.veridian.site`, `twenty-admin --env prod agent:preuve`, comparer les variables au staging.
5. Hub prod : `CRM_API_URL=https://crm.app.veridian.site` dans `deploy/hub.nomad.hcl` (dépôt veridian-hub, `main`),
   `CRM_HUB_API_SECRET` dans `nomad/jobs/hub/stack` (modèle de hub-staging), égal à `HUB_API_SECRET` de `nomad/jobs/crm`.
6. Parcours réel depuis le Hub de prod : compte prouvé, `hub app-access <email> --app twenty --enabled true`, ouvrir
   la carte, arriver à son nom ; puis `pnpm test:systeme` (cas Twenty de `01-arrivee` et `08`) à zéro échec.
7. Écrire à `infra` : blackbox, `sonde-prod.sh`, stanza et drill pgBackRest, volume `storage`. `charge-staging.py`
   hors heures de bureau.

## Limites d'infra à garder en tête

Si `ovh-prod` est confirmé : disque : 40 Go libres et alerte à 20 Go. Twenty en prend moins de 1 Go sans client : à signaler à `infra` si la croissance dépasse 15 Go.

## Chiffres (staging, bastion partagé, 6 cœurs, 07/11/2026, image `staging-f427e79`)

- Charge `charge-staging.py`, 5 000 sociétés, 60 % liste, 30 % filtre, 10 % création, sans temps de réflexion, 0 erreur :
  1 client 12,6 req/s p95 95 ms · 5 clients 46,6 req/s p95 146 ms · 20 clients 47 req/s p95 784 ms · 50 clients 53 req/s p95 2 271 ms.
  Plafond autour de 50 req/s, un seul processus Node. Rejouer sur le nœud retenu : ce relevé dépend de la charge du bastion.
- Insertion : 400 sociétés/s. Provisioning : 12 s au calme, jusqu'à 137 s sur nœud saturé.
- Mémoire de pointe (`memory.peak`) : serveur 1 160 Mo, worker 1 034 Mo, Postgres 308 Mo, Redis 140 Mo, soit 2,6 Go.
- Démarrage : 215 s pendant cette mesure, 110 s sur nœud libre, plus de 20 min saturé.
- Sauvegarde et restauration exercées (`pg_dump -Fc`, `pg_restore` dans une base temporaire) : 1 s et 6 s, 6 schémas, 40 comptes, 42 liens identiques.
  Base de 70 Mo qui se restaure en 21 Mo : créer et retirer des espaces laisse de l'espace mort.
- Image finale servie `staging-b640a15` (07/11/2026, 22 h) : trivy par le registre 0 HIGH et 0 CRITICAL ; parcours 63 OK, 0 échec, aucun hôte tiers ;
  capture réseau de 780 s sur `staging-7a319d0`, démarrage compris, silence et témoin vu (`b640a15` ne change que le lien du pied de page) ;
  36 sabotages détectés en CI ; `user=1000`, `cap_drop=ALL`, capacités effectives à zéro.
- Batterie du Hub (`pnpm test:systeme 00- 08- 99-`, Hub de staging, `ADMIN_SECRET=$ADMIN_SECRET_STAGING`) : Twenty 4 sur 4
  (session ouverte, sans session, session expirée, déconnexion sans boucle), 21 passent, 0 échec, 0 reste.
  Non abouti : « se déconnecter partout », faute de session Twenty ouverte avant la coupure. À écrire côté Hub, puis à rejouer en prod.

## Limites connues

- `EMAIL_DRIVER=logger` : aucun email ne part, envois de workflow compris, et le rebrand des gabarits (`twenty-emails`) reste à faire si on branche un relais.
- Mettre à jour l'image coupe le serveur le temps de son démarrage, environ 2 min. Base et file de tâches restent up.
- `crm-db` et le lien par `nomadService` n'ont jamais tourné : le premier déploiement est leur première épreuve.
- Pas de volume réel testé au-delà de 5 000 sociétés. Fonctions Veridian retirées : `VERIDIAN-PATCHES.md`, « Retiré ou reporté ».
