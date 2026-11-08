# Passage de Twenty en prod : ce qui reste, chiffres à l'appui

Décisions tranchées (parente, 07/11/2026) : pas de migration, archive intacte, base neuve ; « Veridian CRM » ;
`crm.app.veridian.site` ; double authentification au Hub seul. Nœud : `ovh-prod`, confirmé par `infra` le 08/11.
Jobs prêts, non déployés : `deploy/crm-db.nomad.hcl` (Postgres, Redis, pgBackRest) et `deploy/crm-prod.nomad.hcl` (serveur, worker).

## Fait le 08/11/2026 (prod servie)

- `crm-db` puis `crm` sur `ovh-prod`, image `staging-d7f9354`, code publié (`veridian-crm-source` 839eb85). Connexion par
  mot de passe à la base testée depuis le bastion avant l'app. `main` = `staging`, SOURCES.tsv sur `main` (`infra`).
- Corrigé en prod : `TRUST_PROXY` (voir CLAUDE.md §5). Canari éprouvé : 100 réponses 200, 1 délai > 5 s pendant la promotion.
- Épreuves sur la prod : parcours 68 OK / 0 échec, aucun hôte tiers ; captures 900 s serveur et worker : silence,
  témoin vu ; `twenty-admin --env prod agent:preuve` vert.
- Hub de prod branché (`fee7dfe`) : `CRM_API_URL`, `CRM_HUB_API_SECRET` dans `nomad/jobs/hub/stack`.
- `infra` : stanza `crm-db`, première sauvegarde complète, audit horaire ; reste chez elle le drill et la sonde blackbox.
- Même jour, soir : `update-plan` (CONTRAT-BILLING v2 §3) puis `trial_status` en prod (`staging-ba4577a`, 143/143 sondes
  pendant la bascule) ; plans réels posés par le Hub (Robert en `pro`), relus par `by-email`.

## AGPL : à chaque image de prod

`scripts/agpl/publier-source.sh` publie sur https://github.com/Christ-Roy/veridian-crm-source le code exact de l'image,
sans `deploy/`, `docs/`, `todo/`, `scripts/`, `.github`, environnements de test ni manifestes k8s. `publication.patch`
reprend les marqueurs anti-fuite de la première publication (07/11, `7a319d05b4`) : s'il ne s'applique plus, le refaire.

## Reste

- `charge-staging.py` contre la prod, hors heures de bureau (chiffres du staging seulement à ce jour).
- Promotion suivante : publier le code, tag, push `staging` puis `main`, `nomad-v deploy`, parcours et preuve agent.

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
