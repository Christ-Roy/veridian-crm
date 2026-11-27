#!/usr/bin/env bash
# motifs-sabotages.sh : vérifie sans jest que chaque sabotage s'applique encore au code commité (pre-push, quelques secondes).
# Le 25/11/2026 un motif périmé a rougi la CI 20 min après le push. Sortie : 0 tous applicables · 1 motif périmé · 2 non abouti
# --arbre <dossier> : le code commité déjà extrait (pre-push sur le bastion : extrait ici, vérifié ailleurs par lourd, sans .git).
set -uo pipefail
TMP=$(mktemp -d) || exit 2
trap 'rm -rf "$TMP"' EXIT
if [ "${1:-}" = --arbre ]; then
  [ -d "${2:-}/scripts/ci" ] || { echo "MOTIFS_NON_ABOUTI arbre absent : ${2:-}"; exit 2; }
  cp -a "$2/." "$TMP/" || { echo "MOTIFS_NON_ABOUTI copie impossible"; exit 2; }
else
  RACINE=$(git rev-parse --show-toplevel) || exit 2
  git -C "$RACINE" archive HEAD scripts/ci packages/twenty-server/src/engine packages/twenty-server/src/modules packages/twenty-front/src packages/twenty-shared/src 2>/dev/null | tar -x -C "$TMP" || { echo "MOTIFS_NON_ABOUTI copie impossible"; exit 2; }
fi
cd "$TMP" || exit 2
rate=0 vus=0
for f in scripts/ci/mutations-*.sh; do
  python3 - "$f" <<'P' || exit 2
import re, sys
p = sys.argv[1]; s = open(p).read()
faux = 'N_J=0; jouer() { N_J=$((N_J+1)); [ $N_J = 1 ]; }'
s, n = re.subn(r'^jouer\(\) \{.*\}$', faux, s, count=1, flags=re.M)
if not n:
    s, n = re.subn(r'^jouer\(\) \{\n.*?\n\}$', faux, s, count=1, flags=re.M | re.S)
open(p, 'w').write(s)
sys.exit(0 if n == 1 else 1)
P
  sortie=$(timeout "${MOTIFS_DELAI:-600}" bash "$f" 2>&1); c=$?
  vus=$((vus + $(grep -c '^détecté' <<<"$sortie")))
  [ "$c" = 0 ] || { echo "MOTIF PÉRIMÉ $(basename "$f") : $(grep -E 'motif absent|NON ABOUTI' <<<"$sortie" | head -1)"; rate=1; }
done
[ "$vus" -gt 100 ] || { echo "MOTIFS_NON_ABOUTI $vus sabotages vus"; exit 2; }
[ "$rate" = 0 ] && echo "MOTIFS_OK $vus sabotages applicables"
exit "$rate"
