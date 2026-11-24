#!/usr/bin/env bash
# Retour arrière : pose les sources de l'app d'un ancien commit, pour les reconstruire avec un versionCode supérieur
# (Android refuse une version inférieure). Ne construit ni ne publie rien.
#   retour.sh <commit>            CI seulement (checkout complet) ; l'arbre est rendu à la fin du job
#   retour.sh --verifier <commit> dit seulement si ce commit peut servir
# Refuse : un commit hors de staging (dépôt public : jamais le code d'un fork signé avec notre clé), et un commit d'avant
# la mise à jour à distance (les téléphones qui l'installeraient ne se mettraient plus jamais à jour).
# Codes : 0 posé, 1 refusé, 2 non abouti.
set -euo pipefail
VERIFIER=0; if [ "${1:-}" = --verifier ]; then VERIFIER=1; shift; fi
COMMIT="${1:-}"
[[ "$COMMIT" =~ ^[0-9a-f]{7,40}$ ]] || { echo "REFUSÉ : commit attendu (7 à 40 chiffres hexadécimaux)" >&2; exit 1; }
git rev-parse -q --verify "$COMMIT^{commit}" >/dev/null || { echo "REFUSÉ : commit inconnu" >&2; exit 1; }
BRANCHE="${BRANCHE:-origin/staging}"
git rev-parse -q --verify "$BRANCHE" >/dev/null || { echo "NON ABOUTI : $BRANCHE absente de ce checkout" >&2; exit 2; }
git merge-base --is-ancestor "$COMMIT" "$BRANCHE" || { echo "REFUSÉ : $COMMIT n'est pas dans $BRANCHE" >&2; exit 1; }
PREFIXE="$(git rev-parse --show-prefix)"; PREFIXE="${PREFIXE%outils/}"
git cat-file -e "$COMMIT:${PREFIXE}app/src/main/java/site/veridian/telephonie/MiseAJourApp.kt" 2>/dev/null || {
  echo "REFUSÉ : $COMMIT est d'avant la mise à jour à distance, les téléphones n'en reviendraient plus" >&2; exit 1; }
if [ "$VERIFIER" = 1 ]; then echo "utilisable : $(git log -1 --format='%h %cs' "$COMMIT")"; exit 0; fi
git checkout -q --detach "$COMMIT"
echo "sources du $(git log -1 --format='%h %cs')"
