#!/usr/bin/env bash
# mutations-naissance.sh : éprouve naissance-natif.veridian.spec.ts (27/11/2026). Chaque sabotage (drapeaux non posés,
# IA / MCP / code Enterprise allumés à la naissance, échec rendu bloquant) doit faire tomber la spec.
# Sortie : 0 tous détectés (compte affiché) · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

S=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service.ts
C=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/constants/veridian-native-feature-flags.constant.ts
LOG=$(mktemp "${TMPDIR:-/tmp}/mutation-naissance.XXXXXX")
SAUVE=$(mktemp "${TMPDIR:-/tmp}/mutation-naissance-sauve.XXXXXX")
FICHIER_EN_COURS=""
restaurer() { [ -n "$FICHIER_EN_COURS" ] && [ -s "$SAUVE" ] && cp "$SAUVE" "$FICHIER_EN_COURS"; rm -f "$LOG" "$SAUVE"; }
trap restaurer EXIT

jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'naissance-natif' >"$LOG" 2>&1)
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

saboter "drapeaux non posés à la création" "$S" "      await this.enableNativeFeatureFlags(workspace.id);" ""
saboter "IA allumée à la naissance" "$C" "  FeatureFlagKey.IS_GETTING_STARTED_ENABLED," "  FeatureFlagKey.IS_GETTING_STARTED_ENABLED,
  FeatureFlagKey.IS_AI_CHAT_INBOX_ENABLED,"
saboter "serveurs MCP tiers allumés à la naissance" "$C" "  FeatureFlagKey.IS_GETTING_STARTED_ENABLED," "  FeatureFlagKey.IS_GETTING_STARTED_ENABLED,
  FeatureFlagKey.IS_MCP_SERVERS_ENABLED,"
saboter "code Enterprise allumé à la naissance" "$C" "  FeatureFlagKey.IS_GETTING_STARTED_ENABLED," "  FeatureFlagKey.IS_GETTING_STARTED_ENABLED,
  FeatureFlagKey.IS_RECORD_LEVEL_SHARING_ENABLED,"
saboter "échec des drapeaux bloquant la création" "$S" "    } catch (error) {
      this.logger.error(
        \`veridian_drapeaux_naissance_non_abouti" "    } catch (error) {
      if (error) throw error;
      this.logger.error(
        \`veridian_drapeaux_naissance_non_abouti"
echo "$detectes sabotages détectés sur $total"
[ "$rate" -eq 0 ] && { echo "CONFORME"; exit 0; }
exit 1
