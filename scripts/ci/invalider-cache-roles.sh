#!/usr/bin/env bash
# invalider-cache-roles.sh <job crm|crm-staging> : retire du Redis du job le cache des permissions de rôle
# (engine:workspace:rolesPermissions:*), recalculé depuis la base au prochain accès. Données dérivées : rien n'est perdu.
# Pourquoi (23/11/2026, VER-203) : ce cache survit aux redémarrages. Calculé quand VERIDIAN_AI_DISABLED=true, il refuse
# les fils du chat IA (agentChatThread) même à l'Admin après avoir rallumé l'IA, et inversement il garderait l'IA
# accordée après un retour arrière. À jouer après CHAQUE changement de VERIDIAN_AI_DISABLED.
# Sortie : 0 invalidé · 2 non abouti
set -uo pipefail
JOB=${1:?job crm ou crm-staging}
case "$JOB" in crm) TACHE=crm-redis ;; crm-staging) TACHE=crm-redis ;; *) echo "NON ABOUTI : job inconnu $JOB"; exit 2 ;; esac
GROUPE=$([ "$JOB" = crm ] && echo redis || echo stack)
A=$(nomad job status "$JOB" 2>/dev/null | awk -v g="$GROUPE" '/^Allocations/{f=1;next} f && $3==g && / run +running/{print $1; exit}')
[ -n "$A" ] || { echo "NON ABOUTI : aucune allocation $GROUPE en service pour $JOB"; exit 2; }
for _ in $(seq 1 20); do
  sortie=$(timeout 60 nomad-v raw alloc exec -task "$TACHE" "$A" sh -c \
    'r() { if [ -n "${REDIS_PASSWORD:-}" ]; then REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli "$@"; else redis-cli "$@"; fi; }; n=0; for k in $(r --scan --pattern "engine:workspace:rolesPermissions:*"); do r del "$k" >/dev/null; n=$((n+1)); done; echo "INVALIDE $n"' 2>&1)
  echo "$sortie" | grep -q "ressource occupee" || break
  sleep 15
done
ligne=$(echo "$sortie" | grep -E '^INVALIDE [0-9]+$')
[ -n "$ligne" ] || { echo "NON ABOUTI : $(echo "$sortie" | tail -1)"; exit 2; }
echo "$JOB : $ligne clé(s) rolesPermissions retirée(s), recalcul au prochain accès"
