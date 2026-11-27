#!/usr/bin/env bash
# mutations-admin-plateforme.sh : éprouve admin-plateforme.veridian.spec.ts (CONTRAT-HUB §5.23, VER-263) : chaque retrait d'une garde de l'administrateur de plateforme doit la faire échouer.
# Sortie : 0 tous détectés (compte affiché) · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

P=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/services/veridian-hub-platform-admin.service.ts
R=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/services/veridian-hub-role.service.ts
LOG=$(mktemp /tmp/mutation-admin-plateforme.XXXXXX)
SAUVE=$(mktemp /tmp/mutation-admin-plateforme-sauve.XXXXXX)
FICHIER_EN_COURS=""
restaurer() { [ -n "$FICHIER_EN_COURS" ] && [ -s "$SAUVE" ] && cp "$SAUVE" "$FICHIER_EN_COURS"; rm -f "$LOG" "$SAUVE"; }
trap restaurer EXIT

jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'admin-plateforme' >"$LOG" 2>&1)
}
jouer || { tail -40 "$LOG"; echo "NON ABOUTI : spec rouge sans sabotage"; exit 2; }
echo "base verte"

total=0
detectes=0
rate=0
saboter() {
  local nom="$1" fichier="$2" avant="$3" apres="$4"
  total=$((total + 1))
  cp "$fichier" "$SAUVE"
  FICHIER_EN_COURS="$fichier"
  node -e '
    const fs = require("fs");
    const [p, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(p, "utf8");
    if (!s.includes(a)) process.exit(1);
    fs.writeFileSync(p, s.replace(a, () => b));
  ' "$fichier" "$avant" "$apres" || { cp "$SAUVE" "$fichier"; echo "NON ABOUTI : motif absent ($nom)"; exit 2; }
  if jouer; then
    echo "NON DÉTECTÉ : $nom"; rate=1
  elif grep -q 'Test suite failed to run' "$LOG"; then
    cp "$SAUVE" "$fichier"; echo "NON ABOUTI : la spec n'a pas tourné ($nom)"; exit 2
  else
    echo "détecté : $nom"; detectes=$((detectes + 1))
  fi
  cp "$SAUVE" "$fichier"
  FICHIER_EN_COURS=""
}

saboter "le propriétaire devient admin de plateforme" "$P" "    if (workspace.ownerHubUserId === hubUserId) {" "    if (false) {"
saboter "un retrait du client ignoré au grant" "$P" "      if (stored?.withdrawn && !reinstate) {" "      if (false) {"
saboter "retrait du client jamais constaté" "$P" "    if (row.value.granted && !row.value.withdrawn && !isAdmin) {" "    if (false) {"
saboter "reinstate sans effet" "$P" "        withdrawn: false,
        at: new Date().toISOString(),
        actor,
        reason,
      });
      log(applied, 'granted');" "        withdrawn: true,
        at: new Date().toISOString(),
        actor,
        reason,
      });
      log(applied, 'granted');"
saboter "revoke retire un Admin choisi par le client" "$P" "    if (!stored?.granted || !this.isAdmin(current)) {" "    if (!this.isAdmin(current)) {"
saboter "une poussée d'organisation rend Admin à un retiré" "$R" "    if (role === 'admin' && !isAdmin) {" "    if (false) {"
saboter "un non-membre créé ou accepté" "$P" "    if (!userWorkspace) {
      return { status: 404, error: 'not_a_member' };" "    if (!userWorkspace && false) {
      return { status: 404, error: 'not_a_member' };"

echo "$detectes sabotages détectés sur $total"
[ "$rate" -eq 0 ] && { echo "CONFORME"; exit 0; }
exit 1
