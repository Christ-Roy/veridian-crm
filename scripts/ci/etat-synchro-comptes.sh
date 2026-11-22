#!/usr/bin/env bash
# etat-synchro-comptes.sh : les boîtes et agendas connectés au CRM de prod synchronisent-ils encore ?
# Twenty n'envoie aucun mail quand un compte lâche (EMAIL_DRIVER=logger) : seule une bannière dans l'espace le dit.
# Ce contrôle le rend visible : rejoué chaque jour par ~/.claude/contexte-verifiable.tsv.
# KO = compte en échec d'authentification, canal FAILED_*, ou canal actif sans synchro depuis 24 h.
# QUOI FAIRE si KO : le propriétaire du compte reconnecte dans Paramètres > Comptes (jamais un agent à sa place) ;
# un compte Google qui lâche tous les 7 jours = client OAuth Google resté en mode « Test » (voir CLAUDE.md du fork).
# Sortie : 0 tout synchronise · 1 au moins un écart · 2 mesure non aboutie
set -uo pipefail
ICI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
JS=${ETAT_SYNCHRO_JS:-$ICI/etat-synchro-comptes.js}
[ -f "$JS" ] || { echo "SYNCHRO_NON_ABOUTI script $JS absent"; exit 2; }
A=$(nomad job status crm 2>/dev/null | awk '/^Allocations/{f=1;next} f&&/stack/&&/ run +running/{print $1; exit}')
[ -n "$A" ] || { echo "SYNCHRO_NON_ABOUTI aucune allocation crm en service"; exit 2; }
B64=$(base64 -w0 "$JS")
for _ in $(seq 1 20); do
  sortie=$(timeout 120 nomad-v raw alloc exec -task crm-server "$A" sh -c \
    "export PGMOD=/app/node_modules/pg; echo $B64 | base64 -d > /tmp/etat-synchro.js; node /tmp/etat-synchro.js; c=\$?; rm -f /tmp/etat-synchro.js; exit \$c" 2>&1)
  code=$?
  echo "$sortie" | grep -q "ressource occupee" || break
  sleep 15
done
ligne=$(echo "$sortie" | grep -E '^(SYNCHRO_|  )')
[ -n "$ligne" ] || { echo "SYNCHRO_NON_ABOUTI exec sans réponse (code $code)"; exit 2; }
echo "$ligne"
case "$ligne" in SYNCHRO_OK*) exit 0 ;; SYNCHRO_KO*) exit 1 ;; *) exit 2 ;; esac
