#!/usr/bin/env bash
# poser-marque.sh : pose la marque Veridian (deploy/marque) sur l'arbre, juste avant de construire l'image. Les fichiers de l'amont
# restent intacts dans le dépôt. Chaque fichier remplacé doit être celui que l'on connaît (deploy/marque.sha256) : un amont qui change
# une icône ou index.html se voit ici, au lieu d'être écrasé par une vieille copie.
# Usage : poser-marque.sh [--verifier]   Sortie : 0 posée (ou posable) · 1 amont changé ou liste fausse · 2 non abouti
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
[ -s deploy/marque.sha256 ] && [ -d deploy/marque ] || { echo "NON ABOUTI : deploy/marque absent"; exit 2; }
attendus=$(awk '{print $2}' deploy/marque.sha256 | sort)
poses=$(cd deploy/marque && find . -type f | sed 's|^\./||' | sort)
[ "$attendus" = "$poses" ] || { echo "ÉCHEC : deploy/marque et marque.sha256 ne listent pas les mêmes fichiers"; diff <(echo "$attendus") <(echo "$poses") | head -5; exit 1; }
sortie=$(sha256sum --quiet -c deploy/marque.sha256 2>&1) || { echo "ÉCHEC : l'amont a changé ces fichiers, rejouer scripts/ci/marque.sh et relire la marque :"; echo "$sortie" | head -10; exit 1; }
n=$(wc -l < deploy/marque.sha256)
[ "${1:-}" = "--verifier" ] && { echo "OK : marque posable, $n fichiers"; exit 0; }
cp -a deploy/marque/. . || { echo "NON ABOUTI : copie"; exit 2; }
while read -r _ f; do cmp -s "$f" "deploy/marque/$f" || { echo "ÉCHEC : $f non posé"; exit 1; }; done < deploy/marque.sha256
echo "OK : marque posée, $n fichiers"
