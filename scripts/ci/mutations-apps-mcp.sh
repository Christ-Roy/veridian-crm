#!/usr/bin/env bash
# mutations-apps-mcp.sh — éprouve apps-par-mcp.veridian.spec.ts : chaque comportement retiré doit la faire échouer.
# Sortie : 0 tous détectés · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

V=packages/twenty-server/src/engine/core-modules/veridian-apps
jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'apps-par-mcp' >/tmp/mutation-apps.log 2>&1)
}
jouer || { tail -40 /tmp/mutation-apps.log; echo "NON ABOUTI : spec rouge sans sabotage"; exit 2; }
echo "base verte"

rate=0
saboter() {
  local nom="$1" fichier="$2" avant="$3" apres="$4"
  cp "$fichier" /tmp/mutation-apps.sauve
  node -e '
    const fs = require("fs");
    const [p, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(p, "utf8");
    if (!s.includes(a)) process.exit(1);
    fs.writeFileSync(p, s.replace(a, () => b));
  ' "$fichier" "$avant" "$apres" || { cp /tmp/mutation-apps.sauve "$fichier"; echo "NON ABOUTI : motif absent ($nom)"; exit 2; }
  if jouer; then
    echo "NON DÉTECTÉ : $nom"; rate=1
  elif grep -q 'Test suite failed to run' /tmp/mutation-apps.log; then
    cp /tmp/mutation-apps.sauve "$fichier"; echo "NON ABOUTI : la spec n'a pas tourné ($nom)"; exit 2
  else
    echo "détecté : $nom"
  fi
  cp /tmp/mutation-apps.sauve "$fichier"
}

I=$V/tools/install-app.tool.ts
L=$V/tools/list-available-apps.tool.ts
P=$V/veridian-apps-access-policy.constant.ts
saboter "permission Applications retirée" "$P" "requiredPermissionFlags: [PermissionFlagType.APPLICATIONS]" "requiredPermissionFlags: []"
saboter "une app installe une app" "$P" "application: false" "application: true"
saboter "installation ouverte à une autre politique" "$I" "accessPolicy: VERIDIAN_APPS_ACCESS_POLICY," "accessPolicy: { ...VERIDIAN_APPS_ACCESS_POLICY, requiredPermissionFlags: [] },"
saboter "refus pris pour un succès" "$I" "return this.failure(status.failedReason ?? 'unknown');" "return { success: true, message: 'App installed' };"
saboter "demande acceptée prise pour installée" "$I" "status?.state === JobStateEnum.COMPLETED" "true"
saboter "erreur avalée" "$I" "return this.failure(error instanceof Error ? error.message : 'unknown');" "return { success: true, message: 'App installed' };"
saboter "déjà installée prise pour un échec" "$I" "/is already installed in this workspace/.test(error)" "false"
saboter "rétrogradation prise pour un succès" "$I" "/is already installed in this workspace/" "/is already installed/"
saboter "apps non listées montrées" "$L" "{ isListed: true }" "{}"
saboter "version installée absente" "$L" "?.version ?? null" "?.universalIdentifier ?? null"

[ "$rate" -eq 0 ] && { echo "CONFORME"; exit 0; }
exit 1
