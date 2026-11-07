#!/usr/bin/env bash
# marque.sh — remet le logo Veridian (icône du Hub) sur toutes les images de marque de twenty-front,
# à nom et taille identiques : à rejouer après un sync amont. Usage : marque.sh <icon.svg du Hub>
# Sortie : 0 fait · 2 outil ou source absents
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
SOURCE="${1:-}"
[ -f "$SOURCE" ] || { echo "NON ABOUTI : icône source absente"; exit 2; }
rsvg-convert --version >/dev/null || { echo "NON ABOUTI : rsvg-convert absent"; exit 2; }
cp "$SOURCE" packages/twenty-front/public/images/integrations/twenty-logo.svg
find packages/twenty-front/public/images/icons -name '*.png' | while read -r image; do
  taille=$(identify -format '%wx%h' "$image") || exit 2
  largeur=${taille%x*}; hauteur=${taille#*x}
  cote=$(( largeur < hauteur ? largeur : hauteur ))
  rsvg-convert -w "$cote" -h "$cote" "$SOURCE" | convert - -background none -gravity center -extent "$taille" -strip "PNG32:$image" || exit 2
done
