#!/usr/bin/env bash
# Chemin standard du parcours de prod (parente, 10/11/2026) : Chromium sur node02, le bastion étant saturé.
# Le secret du Hub passe par stdin, jamais en argument ni dans un fichier copié. Le venv est créé s'il manque
# (Playwright Python seul : Chromium et ses dépendances système sont déjà sur node02).
# Usage : parcours-node02.sh <dossier-local> [secondes-avant-SIGTERM]
# Codes : celui du parcours (0 vrai, 1 faux, 2 non abouti) ; 2 aussi si node02 est injoignable.
set -u
D=${1:?dossier de sortie}; ARRET=${2:-0}
mkdir -p "$D"
PLAYWRIGHT_VERSION=1.62.0
VENV='$HOME/.cache/veridian-parcours-venv'

ssh -o ConnectTimeout=10 node02 "
  [ -x $VENV/bin/python ] || python3 -m venv $VENV
  $VENV/bin/python -c 'import playwright' 2>/dev/null || nice -n 19 $VENV/bin/pip install -q playwright==$PLAYWRIGHT_VERSION
" > "$D/preparation.txt" 2>&1 || { echo "node02 injoignable ou venv impossible : $D/preparation.txt"; exit 2; }
scp -q "$(dirname "$0")/parcours-staging.py" node02:/tmp/parcours-staging.py || exit 2

set -a; source ~/credentials/.all-creds.env >/dev/null 2>&1; set +a
printf '%s\n' "$CRM_HUB_API_SECRET_PROD" | ssh -o ConnectTimeout=10 node02 "
  IFS= read -r HUB_API_SECRET; export HUB_API_SECRET
  rm -rf /tmp/parcours-out; mkdir -p /tmp/parcours-out
  nice -n 10 $VENV/bin/python -u /tmp/parcours-staging.py https://crm.app.veridian.site /tmp/parcours-out 1 &
  P=\$!
  if [ $ARRET -gt 0 ]; then sleep $ARRET; kill -TERM \$P; fi
  wait \$P; echo code=\$?" > "$D/sortie.txt" 2>&1
CODE=$(sed -n 's/^code=//p' "$D/sortie.txt" | tail -1)
grep -E "^ECHEC|VERDICT" "$D/sortie.txt"
exit "${CODE:-2}"
