#!/usr/bin/env bash
# check-ee-integrity.sh — garde-fou LÉGAL bloquant (fork Twenty).
#
# Les ~300 fichiers `/* @license Enterprise */` sont sous licence commerciale
# Twenty Labs. On a le droit de les LIRE, JAMAIS de les modifier (= contrefaçon,
# cf docs/spec/AUDIT-LIMITE-EE-TWENTY.md). Seule opération tolérée : suppression
# pure (décision explicite, pas une modif inline).
#
# Ce script échoue si un fichier EE a été MODIFIÉ (contenu changé) depuis le
# marker de fork. Il tourne en CI (étage 1, bloquant) ET en pre-push.
#
# Usage : check-ee-integrity.sh [<fork-marker-ref>]
#   défaut marker = SHA du commit Twenty de base du fork.

set -euo pipefail

FORK_MARKER="${1:-1188ea9cd5}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

red()   { printf '\033[31m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }

# Le marker peut manquer en CI shallow clone → on tente de le fetch.
if ! git cat-file -e "${FORK_MARKER}^{commit}" 2>/dev/null; then
  git fetch --quiet --depth=1 origin "$FORK_MARKER" 2>/dev/null || true
fi
if ! git cat-file -e "${FORK_MARKER}^{commit}" 2>/dev/null; then
  red "check-ee-integrity: marker '$FORK_MARKER' introuvable (clone shallow ?). Fetch --unshallow ou passer un ref valide."
  exit 2
fi

# Fichiers porteurs du HEADER EE dans l'arbre courant.
# Le marker légal est `/* @license Enterprise */` placé EN TÊTE de fichier
# (1re ligne). On ne matche QUE ça : une simple mention de la chaîne dans un
# commentaire AGPL (ex : notre patch workspace-cap qui dit "we don't touch any
# @license Enterprise file") n'est PAS un fichier EE.
mapfile -t ee_files < <(
  grep -rIl --include='*.ts' --include='*.tsx' \
    -E '^/\* @license Enterprise \*/' packages 2>/dev/null | sort
)

if [ "${#ee_files[@]}" -eq 0 ]; then
  red "check-ee-integrity: 0 fichier EE trouvé — suspect (la convention attend ~300). Abort."
  exit 2
fi

violations=0

# (b) un fichier EE modifié (contenu) depuis le marker = interdit.
# La suppression pure (absent de HEAD) est tolérée → on ne teste que les
# fichiers EE encore présents.
while IFS= read -r f; do
  # Existe au marker ? Si non, c'est un nouveau fichier upstream arrivé par
  # un sync — pas une modif Veridian, on l'ignore (il sera couvert au prochain
  # bump du marker).
  if git cat-file -e "${FORK_MARKER}:${f}" 2>/dev/null; then
    if ! git diff --quiet "${FORK_MARKER}" HEAD -- "$f" 2>/dev/null; then
      red "  ✗ MODIFIÉ (interdit, @license Enterprise) : $f"
      violations=$((violations + 1))
    fi
  fi
done < <(printf '%s\n' "${ee_files[@]}")

# (c) un module veridian-* qui importe un chemin EE = dépendance toxique
# (casse le jour où on prune EE). On grep les imports veridian-* vers les
# modules EE connus.
ee_module_globs='core-modules/(sso|enterprise|billing-webhook|dns-manager|cloudflare|usage|event-logs)|(flat-)?row-level-permission-predicate'
if grep -rIn --include='*.ts' --include='*.tsx' \
     -E "from ['\"].*(${ee_module_globs})" \
     packages/twenty-server/src/modules/veridian-* \
     packages/twenty-front/src/modules/veridian-* 2>/dev/null; then
  red "  ✗ un module veridian-* importe un chemin EE (dépendance toxique)"
  violations=$((violations + 1))
fi

if [ "$violations" -gt 0 ]; then
  red "check-ee-integrity: $violations violation(s) — push refusé (cf docs/spec/AUDIT-LIMITE-EE-TWENTY.md)"
  exit 1
fi

green "check-ee-integrity: ${#ee_files[@]} fichiers EE intacts depuis $FORK_MARKER, aucune dépendance toxique ✓"
