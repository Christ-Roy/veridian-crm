#!/usr/bin/env bash
# mutations-aide-en-ligne.sh : éprouve aide-en-ligne-hors-mcp.veridian.spec.ts, chaque retrait de la coupure de search_help_center doit la faire échouer.
# Sortie : 0 tous détectés (compte affiché) · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

G=packages/twenty-server/src/engine/core-modules/veridian-hub-mcp/services/veridian-help-center-gate.service.ts
LOG=$(mktemp /tmp/mutation-aide.XXXXXX)
SAUVE=$(mktemp /tmp/mutation-aide-sauve.XXXXXX)
FICHIER_EN_COURS=""
restaurer() { [ -n "$FICHIER_EN_COURS" ] && [ -s "$SAUVE" ] && cp "$SAUVE" "$FICHIER_EN_COURS"; rm -f "$LOG" "$SAUVE"; }
trap restaurer EXIT

jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'aide-en-ligne-hors-mcp' >"$LOG" 2>&1)
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

saboter "outil absent de l'ensemble d'exclusion" "$G" "  MCP_EXCLUDED_TOOL_NAMES.add(HELP_CENTER_TOOL_NAME);" "  void MCP_EXCLUDED_TOOL_NAMES;"
saboter "outil laissé dans la liste de préchargement" "$G" "      COMMON_PRELOAD_TOOLS.splice(index, 1);" "      void index;"
saboter "interrupteur inversé" "$G" "HELP_CENTER_SEARCH_ENABLED === 'true'" "HELP_CENTER_SEARCH_ENABLED !== 'true'"
saboter "mauvais nom d'outil" "$G" "const HELP_CENTER_TOOL_NAME = 'search_help_center';" "const HELP_CENTER_TOOL_NAME = 'search_help_centre';"
saboter "le crochet de démarrage ne ferme rien" "$G" "    closeHelpCenterToolForMcp();
  }" "  }"
saboter "préchargement : seule la première occurrence" "$G" "index >= 0; index--" "index >= 1; index--"

echo "$detectes sabotages détectés sur $total"
[ "$rate" -eq 0 ] && { echo "CONFORME"; exit 0; }
exit 1
