#!/usr/bin/env bash
# adresses-personnes.sh : ce dépôt est public, aucune adresse de personne dedans (identité = hub_user_id, exemples = exemple@veridian.site,
# jetables e2e-...@veridian.site). Ne nomme jamais l'adresse trouvée : fichier:ligne seulement.
# Portée : deploy scripts docs todo .github .githooks CLAUDE*.md VERIDIAN-PATCHES.md (les paquets amont de twentyhq sont hors portée).
# Sortie : 0 conforme · 1 adresse de personne trouvée · 2 non abouti (dont l'autotest raté)
set -uo pipefail

# Liste blanche : adresses techniques, exemples, et deux boîtes de rôle de l'amont.
BLANC='^(e2e-[^@]*|exemple|noreply|no-reply)@veridian\.site$|^[^@]*@(example\.com|example\.org|[a-z0-9-]+\.example|users\.noreply\.github\.com)$|^jean@ancienne\.fr$|^(security|founders)@twenty\.com$|^noreply@github\.com$'
ADRESSE='([A-Za-z0-9._%+-]|\{[^}]*\})+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
CIBLES=(deploy scripts docs todo .github .githooks CLAUDE.md CLAUDE-TWENTY.md VERIDIAN-PATCHES.md)

# scanner <racine> : imprime fichier:ligne par adresse de personne
scanner() {
  local racine=$1 c
  local -a presentes=()
  for c in "${CIBLES[@]}"; do [ -e "$racine/$c" ] && presentes+=("$c"); done
  [ "${#presentes[@]}" -gt 0 ] || return 2
  (cd "$racine" && grep -rInoE --exclude-dir=oss-scanner --exclude=adresses-personnes.sh "$ADRESSE" "${presentes[@]}"; [ $? -le 1 ]) \
    | BLANC="$BLANC" awk -F: '{ f=$1; l=$2; a=$0; sub(/^[^:]*:[^:]*:/, "", a); a=tolower(a); if (a !~ ENVIRON["BLANC"]) print f ":" l }'
  return "${PIPESTATUS[0]}"
}

# Autotest : un cas connu posé dans un dossier temporaire doit être vu, un cas blanc ne doit pas l'être.
autotest() {
  local t; t=$(mktemp -d) || return 2
  mkdir -p "$t/deploy"
  local arobase=@
  printf 'X=e2e-test%sveridian.site\nY=une.personne%sgmail.com\nZ=quelqu.un%sveridian.site\n' "$arobase" "$arobase" "$arobase" > "$t/deploy/essai.hcl"
  local vus; vus=$(scanner "$t" | tr '\n' ' ')
  rm -rf "$t"
  [ "$vus" = "deploy/essai.hcl:2 deploy/essai.hcl:3 " ]
}

racine=${1:-$(git rev-parse --show-toplevel 2>/dev/null)} || exit 2
[ -n "$racine" ] || { echo "ADRESSES_NON_ABOUTI racine introuvable"; exit 2; }
autotest || { echo "ADRESSES_NON_ABOUTI l'autotest ne voit pas le cas connu"; exit 2; }
trouvees=$(scanner "$racine"); rc=$?
[ "$rc" -eq 0 ] || { echo "ADRESSES_NON_ABOUTI lecture impossible"; exit 2; }
if [ -n "$trouvees" ]; then
  echo "ADRESSES_FAUX adresse de personne à ces endroits (variable, hub_user_id ou exemple@veridian.site à la place) :"
  echo "$trouvees" | sort -u | sed 's/^/  /'
  exit 1
fi
echo "ADRESSES_OK aucune adresse de personne"
