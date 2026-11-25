#!/usr/bin/env bash
# marque.sh : refait le calque de marque (deploy/marque) depuis l'icône du Hub, aux noms et tailles de l'amont : à rejouer après un
# sync amont. index.html et manifest.json s'y relisent à la main. Usage : marque.sh <icon.svg du Hub>
# Sortie : 0 fait · 2 outil ou source absents
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
SOURCE="${1:-}"
[ -f "$SOURCE" ] || { echo "NON ABOUTI : icône source absente"; exit 2; }
rsvg-convert --version >/dev/null || { echo "NON ABOUTI : rsvg-convert absent"; exit 2; }
F=packages/twenty-front
mkdir -p "deploy/marque/$F/public/images/integrations"
cp "$SOURCE" "deploy/marque/$F/public/images/integrations/twenty-logo.svg"
find $F/public/images/icons -name '*.png' | while read -r image; do
  mkdir -p "deploy/marque/$(dirname "$image")"
  taille=$(identify -format '%wx%h' "$image") || exit 2
  largeur=${taille%x*}; hauteur=${taille#*x}
  cote=$(( largeur < hauteur ? largeur : hauteur ))
  rsvg-convert -w "$cote" -h "$cote" "$SOURCE" | convert - -background none -gravity center -extent "$taille" -strip "PNG32:deploy/marque/$image" || exit 2
done
(cd deploy/marque && find . -type f | sed "s|^\./||" | sort) | xargs sha256sum > deploy/marque.sha256
[ "$(wc -l < deploy/marque.sha256)" -gt 100 ] || { echo "NON ABOUTI : calque incomplet"; exit 2; }
