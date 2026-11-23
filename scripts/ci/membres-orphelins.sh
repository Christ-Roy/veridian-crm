#!/usr/bin/env bash
# membres-orphelins.sh [crm|crm-staging] : des fiches de membre survivent-elles à leur appartenance ?
# Une seule suffit à casser le chargement de l'utilisateur pour tout l'espace (VER-203, 23/11/2026).
# Sortie : 0 aucune · 1 au moins une · 2 mesure non aboutie
set -uo pipefail
JOB=${1:-crm}
JS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/membres-orphelins.js
A=$(nomad job status "$JOB" 2>/dev/null | awk '/^Allocations/{f=1;next} f&&/stack/&&/ run +running/{print $1; exit}')
[ -n "$A" ] || { echo "MEMBRES_NON_ABOUTI aucune allocation $JOB en service"; exit 2; }
B64=$(base64 -w0 "$JS")
sortie=$(timeout 120 nomad-v raw alloc exec -task crm-server "$A" sh -c \
  "export PGMOD=/app/node_modules/pg; echo $B64 | base64 -d > /tmp/membres-orphelins.js; node /tmp/membres-orphelins.js; c=\$?; rm -f /tmp/membres-orphelins.js; exit \$c" 2>&1)
lignes=$(echo "$sortie" | grep -E '^(MEMBRES_|  )')
[ -n "$lignes" ] || { echo "MEMBRES_NON_ABOUTI exec sans réponse"; exit 2; }
echo "$lignes"
case "$lignes" in MEMBRES_OK*) exit 0 ;; MEMBRES_KO*) exit 1 ;; *) exit 2 ;; esac
