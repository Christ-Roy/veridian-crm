#!/usr/bin/env bash
# mutations-suspension.sh — éprouve la suspension Veridian (CONTRAT-HUB §5.4) : chaque comportement retiré doit faire échouer la spec.
# Sabotages : suspendedAt posé à la suspension · reprise qui ne réactive pas · événement natif non émis ·
# cron natif qui agit sur un espace sans suspendedAt.
# Sortie : 0 tous détectés · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

SERVICE=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/services/veridian-hub-suspension.service.ts
CLEANER=packages/twenty-server/src/engine/workspace-manager/workspace-cleaner/services/cleaner.workspace-service.ts
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'suspension' >"$TMP/jest.log" 2>&1)
}
jouer || { tail -40 "$TMP/jest.log"; echo "NON ABOUTI : spec rouge sans sabotage"; exit 2; }
echo "base verte"

rate=0
saboter() {
  local nom="$1" fichier="$2" avant="$3" apres="$4"
  cp "$fichier" "$TMP/sauve"
  node -e '
    const fs = require("fs");
    const [p, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(p, "utf8");
    if (!s.includes(a)) process.exit(1);
    fs.writeFileSync(p, s.replace(a, () => b));
  ' "$fichier" "$avant" "$apres" || { cp "$TMP/sauve" "$fichier"; echo "NON ABOUTI : motif absent ($nom)"; exit 2; }
  if jouer; then
    echo "NON DETECTE : $nom"
    rate=1
  else
    echo "detecte : $nom"
  fi
  cp "$TMP/sauve" "$fichier"
}

saboter "suspendedAt posé à la suspension" "$SERVICE" "suspendedAt: null," "suspendedAt: new Date(),"
saboter "reprise sans réactivation natif" "$SERVICE" "await this.workspaceService.reactivateWorkspace(workspaceId);" "void workspaceId;"
saboter "événement natif de suspension non émis" "$SERVICE" "this.eventEmitter.emit(WORKSPACE_SUSPENDED_EVENT, {" "void ({"
saboter "cron natif agit sans suspendedAt" "$CLEANER" "if (isDefined(workspace.suspendedAt)) {" "if (!isDefined(workspace.suspendedAt)) { return 9999; }
    if (isDefined(workspace.suspendedAt)) {"

exit "$rate"
