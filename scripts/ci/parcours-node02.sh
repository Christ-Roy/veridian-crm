#!/usr/bin/env bash
# Parcours prod lancé sur node02 (le bastion est saturé) ; le secret passe par stdin, jamais en argument.
# Prérequis node02 : venv ~/.cache/veridian-parcours-venv avec playwright==1.62.0 (Chromium déjà présent).
# Usage : parcours-node02.sh <dossier-local> [secondes-avant-SIGTERM]
scp -q "$(dirname "$0")/parcours-staging.py" node02:/tmp/parcours-staging.py
set -a; source ~/credentials/.all-creds.env >/dev/null 2>&1; set +a
D=$1; mkdir -p "$D"; ARRET=${2:-0}
printf '%s\n' "$CRM_HUB_API_SECRET_PROD" | ssh -o ConnectTimeout=10 node02 "
  IFS= read -r HUB_API_SECRET; export HUB_API_SECRET
  rm -rf /tmp/parcours-out; mkdir -p /tmp/parcours-out
  nice -n 10 \$HOME/.cache/veridian-parcours-venv/bin/python -u /tmp/parcours-staging.py https://crm.app.veridian.site /tmp/parcours-out 1 &
  P=\$!
  if [ $ARRET -gt 0 ]; then sleep $ARRET; kill -TERM \$P; fi
  wait \$P; echo code=\$?" > "$D/sortie.txt" 2>&1
