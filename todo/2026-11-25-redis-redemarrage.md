# Redis du CRM : 192/384 Mo en prod, par un redémarrage répété en staging

Changement : groupe `redis`, `memory` 64 vers 192, `memory_max` 256 vers 384 (valeurs d'infra, 25/11/2026). Rien d'autre ne bouge.

Retour arrière, écrit avant :
1. Redis ne repart pas ou ses files sont vides : remettre 64/256 dans `deploy/crm-prod.nomad.hcl`, commit, `staging` puis `main`,
   `echo oui | timeout 280 nomad-v deploy deploy/crm-prod.nomad.hcl`. Même volume `/opt/veridian-prod/crm/redis`, même AOF : aucune copie.
2. Le déploiement refuse ou reste en attente de place : `nomad-v raw job revert crm 40` (version 40 = avant). Le serveur et le worker
   ne changent pas, ils se reconnectent seuls (ioredis, reprise sans limite).
3. AOF abîmé (Redis boucle au démarrage) : il dit lui-même la commande `redis-check-aof --fix` ; arrêter le groupe avant, ne rien effacer.
Staging : REDIS_URL peut revenir à `redis://127.0.0.1:6379` (l'ancienne tâche tourne encore dans `stack`).

Condition de la parente : coupure de 10 s ou moins et 0 perte en staging, sinon pas de prod.
