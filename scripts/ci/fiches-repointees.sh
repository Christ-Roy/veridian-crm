#!/usr/bin/env bash
# fiches-repointees.sh [crm|crm-staging] : une fiche de membre vise-t-elle un autre compte que celui qui a l'accès (VER-245) ?
# Sortie : 0 aucune · 1 au moins une · 2 mesure non aboutie
set -uo pipefail
JOB=${1:-crm}
JS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/fiches-repointees.js
A=$(nomad-v raw job status "$JOB" 2>/dev/null | awk '/^Allocations/{f=1;next} f&&/stack/&&/ run +running/{print $1; exit}')
[ -n "$A" ] || { echo "FICHES_NON_ABOUTI aucune allocation $JOB en service"; exit 2; }
B64=$(base64 -w0 "$JS")
sortie=$(timeout 90 nomad-v raw alloc exec -task crm-server "$A" sh -c \
  "echo $B64 | base64 -d > /tmp/fiches-repointees.js; timeout 60 node /tmp/fiches-repointees.js; rm -f /tmp/fiches-repointees.js" </dev/null 2>&1)
lignes=$(echo "$sortie" | grep -E '^(FICHES_|  )')
[ -n "$lignes" ] || { echo "FICHES_NON_ABOUTI exec sans réponse"; exit 2; }
echo "$lignes"
case "$lignes" in FICHES_OK*) exit 0 ;; FICHES_KO*) exit 1 ;; *) exit 2 ;; esac
