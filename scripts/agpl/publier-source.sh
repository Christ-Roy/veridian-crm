#!/usr/bin/env bash
# publier-source.sh : publie sur github.com/Christ-Roy/veridian-crm-source le code exact d'une image de prod (AGPL).
# À lancer avant chaque déploiement de prod, avec le commit de l'image : le lien du pied de page mène à ce dépôt.
#
# Usage : scripts/agpl/publier-source.sh [<commit>] [--essai]
#   --essai : prépare l'arbre et l'affiche, ne pousse rien.
# Retire ce qui n'est pas du code (déploiement, notes, CI, fichiers d'environnement de test, manifestes k8s
# d'exemple), puis applique publication.patch : chaînes de test qui ressemblent à des secrets, marquées ou
# reconstruites pour passer le garde anti-fuite. Si le patch ne s'applique plus, le reprendre sur les fichiers.
# Sortie : 0 publié (ou déjà à jour) · 1 échec · 2 mesure non aboutie
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

COMMIT=HEAD; ESSAI=0
for a in "$@"; do case "$a" in --essai) ESSAI=1 ;; *) COMMIT="$a" ;; esac; done
SHA=$(git rev-parse --short=10 "$COMMIT^{commit}") || exit 2
DEPOT=https://github.com/Christ-Roy/veridian-crm-source.git
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/arbre" && git archive "$SHA" | tar -x -C "$TMP/arbre" || exit 2
cd "$TMP/arbre"
rm -rf .claude .githooks .github .mcp.json AGENTS.md CLAUDE-TWENTY.md CLAUDE.md deploy docs scripts todo \
  packages/twenty-docker/k8s packages/twenty-server/.env.test packages/twenty-server/.env.e2e-testing-server
patch -p1 --quiet --forward < "$OLDPWD/scripts/agpl/publication.patch" || { echo "ECHEC : publication.patch ne s'applique plus sur $SHA"; exit 1; }
find . -name '*.orig' -delete
DATE_FR=$(LC_ALL=fr_FR.UTF-8 date -d "@$(git -C "$OLDPWD" log -1 --format=%ct "$SHA")" '+%-d %B %Y' 2>/dev/null)
DATE_EN=$(LC_ALL=C date -d "@$(git -C "$OLDPWD" log -1 --format=%ct "$SHA")" '+%-d %B %Y')
sed "s/@COMMIT@/$SHA/g; s/@DATE_FR@/${DATE_FR:-$DATE_EN}/; s/@DATE_EN@/$DATE_EN/" "$OLDPWD/scripts/agpl/README.modele.md" > README.md

[ -f LICENSE ] && [ -f VERIDIAN-PATCHES.md ] || { echo "ECHEC : LICENSE ou VERIDIAN-PATCHES.md absent de l'arbre publié"; exit 1; }
if [ "$ESSAI" = 1 ]; then
  echo "essai : $(find . -type f | wc -l) fichiers prêts pour $SHA dans $TMP/arbre (rien poussé)"
  trap - EXIT; exit 0
fi

git clone -q --depth 1 "$DEPOT" "$TMP/publie" || exit 2
rsync -a --delete --exclude=.git ./ "$TMP/publie/" || exit 2
cd "$TMP/publie"
git add -A
if git diff --cached --quiet; then echo "déjà à jour : $SHA"; exit 0; fi
git commit -q -F - <<EOF
Publication du code source du Veridian CRM : commit $SHA

Instantané du commit $SHA du fork (branche staging), servi en production.
Modifications Veridian : VERIDIAN-PATCHES.md.
EOF
git push -q origin HEAD:main || { echo "ECHEC : push refusé"; exit 1; }
echo "publié : $SHA -> $(git rev-parse --short HEAD) sur $DEPOT"
