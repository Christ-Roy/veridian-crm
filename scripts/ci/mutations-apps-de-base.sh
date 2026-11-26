#!/usr/bin/env bash
# mutations-apps-de-base.sh : éprouve apps-de-base.veridian.spec.ts, chaque affaiblissement de l'ouverture des apps de base (éditeur, exclusions, source) doit la faire échouer.
# Sortie : 0 tous détectés (compte affiché) · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

G=packages/twenty-server/src/engine/core-modules/veridian-coupures/is-application-install-allowed-by-veridian.util.ts
F=packages/twenty-server/src/engine/core-modules/veridian-coupures/is-logic-function-allowed-by-veridian.util.ts
LOG=$(mktemp /tmp/mutation-apps-base.XXXXXX)
SAUVE=$(mktemp /tmp/mutation-apps-base-sauve.XXXXXX)
FICHIER_EN_COURS=""
restaurer() { [ -n "$FICHIER_EN_COURS" ] && [ -s "$SAUVE" ] && cp "$SAUVE" "$FICHIER_EN_COURS"; rm -f "$LOG" "$SAUVE"; }
trap restaurer EXIT

jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'apps-de-base' >"$LOG" 2>&1)
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

saboter "exclusions ignorées" "$G" "  !parseIds(process.env.VERIDIAN_BASE_APPS_EXCLUDE).has(workspaceId.toLowerCase());" "  true;"
saboter "éditeur non vérifié" "$G" "applicationRegistration.ownerWorkspaceId ?? ''" "process.env.VERIDIAN_BASE_APPS?.slice(0, 36) ?? ''"
saboter "toute source acceptée" "$G" "  applicationRegistration?.sourceType ===
    ApplicationRegistrationSourceType.TARBALL &&" "  applicationRegistration !== undefined &&"
saboter "apps de base absentes de la garde d'installation" "$G" "    isInstanceCatalogApplication(applicationRegistration)) ||
  isVeridianBaseApplication({ workspaceId, applicationRegistration });" "    isInstanceCatalogApplication(applicationRegistration));"
saboter "fonctions refusées aux apps de base" "$F" "      (workspaceId !== undefined &&
        isVeridianBaseApplication({" "      (false &&
        isVeridianBaseApplication({"
saboter "fonctions permises sans espace connu" "$F" "      (workspaceId !== undefined &&" "      (true &&"
echo "$detectes sabotages détectés sur $total"
[ "$rate" -eq 0 ] && { echo "CONFORME"; exit 0; }
exit 1
