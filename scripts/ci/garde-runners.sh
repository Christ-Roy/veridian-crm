#!/usr/bin/env bash
# garde-runners.sh : un dépôt PRIVÉ ne doit utiliser aucun runner GitHub hébergé (loi 7).
# Un runner hébergé est gratuit sur un dépôt public, mais sur un dépôt privé un dépassement de
# facturation bloque tout le compte (14/09/2026). Plus personne ne doit avoir à s'en souvenir.
# Usage : garde-runners.sh [--prive oui|non]   (sans argument : lit la visibilité via gh api)
# Sortie : 0 ok (public, ou privé sans runner hébergé) · 1 privé avec runner hébergé · 2 visibilité illisible
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

prive=""
if [ "${1:-}" = "--prive" ]; then
  prive="${2:-}"
  case "$prive" in oui|non) ;; *) echo "NON ABOUTI : --prive attend oui|non"; exit 2 ;; esac
else
  [ -n "${GITHUB_REPOSITORY:-}" ] || { echo "NON ABOUTI : GITHUB_REPOSITORY absent"; exit 2; }
  val="$(gh api "repos/$GITHUB_REPOSITORY" -q .private 2>/dev/null)" || val=""
  case "$val" in true) prive=oui ;; false) prive=non ;; *) echo "NON ABOUTI : visibilité de $GITHUB_REPOSITORY illisible (gh api)"; exit 2 ;; esac
fi

if [ "$prive" = "non" ]; then
  echo "OK : dépôt public, runners hébergés gratuits"
  exit 0
fi

# Un runner hébergé : ubuntu-*, macos-*, windows-* (aussi en liste ou en matrice, ex. [ubuntu-latest]).
trouves="$(grep -nEH '^[[:space:]]*(-[[:space:]]*)?runs-on:.*(ubuntu|macos|windows)-' .github/workflows/*.y*ml 2>/dev/null || true)"
if [ -n "$trouves" ]; then
  echo "ÉCHEC : dépôt PRIVÉ avec runner hébergé (loi 7), à basculer sur [self-hosted, ...] :"
  echo "$trouves"
  exit 1
fi
echo "OK : dépôt privé, aucun runner hébergé"
exit 0
