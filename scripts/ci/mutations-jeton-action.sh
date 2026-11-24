#!/usr/bin/env bash
# mutations-jeton-action.sh — éprouve jeton-action.veridian.spec.ts : retire chaque garde du jeton à `act`
# (INTEGRATIONS-NATIVES §2.3) et exige que la spec échoue.
# Sortie : 0 tous détectés · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

D=packages/twenty-server/src/engine/core-modules/veridian-hub-mcp
U=$D/utils/read-delegation.util.ts
S=$D/services/veridian-hub-mcp-auth.service.ts
M=$D/middlewares/veridian-hub-mcp-auth.middleware.ts
A=$D/services/veridian-delegated-app.service.ts

jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern '(jeton-action|app-deleguee)' >/tmp/mutation-action.log 2>&1)
}

jouer || { tail -30 /tmp/mutation-action.log; echo "NON ABOUTI : spec rouge sans sabotage"; exit 2; }
echo "base verte"

rate=0
saboter() {
  local nom="$1" fichier="$2" avant="$3" apres="$4"
  cp "$fichier" /tmp/mutation-action.sauve
  node -e '
    const fs = require("fs");
    const [p, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(p, "utf8");
    if (!s.includes(a)) process.exit(1);
    fs.writeFileSync(p, s.replace(a, () => b));
  ' "$fichier" "$avant" "$apres" || { echo "NON ABOUTI : motif absent ($nom)"; exit 2; }
  if jouer; then
    echo "NON DÉTECTÉ : $nom"; rate=1
  else
    echo "détecté : $nom ($(grep -cE '^\s+●' /tmp/mutation-action.log) signalements)"
  fi
  cp /tmp/mutation-action.sauve "$fichier"
}

saboter "act ignoré : jeton complet" "$U" "if (!('act' in claims)) {" "if (true as boolean) {"
saboter "act en chaîne accepté" "$U" "Object.keys(act).join() !== 'sub'" "false"
saboter "act sans préfixe accepté" "$U" '/^app:[a-z0-9-]{1,40}$/' '/^[a-z:-]+$/'
saboter "jti facultatif" "$U" '!isNonEmptyString(claims.jti)' 'false'
saboter "iat facultatif" "$U" "typeof claims.iat !== 'number'" 'false'
saboter "durée libre" "$U" 'claims.exp - claims.iat > MAX_LIFETIME_S' 'false'
saboter "espace facultatif" "$U" '!isNonEmptyString(claims.tenant_id)' 'false'
saboter "tout outil permis" "$U" "rule !== undefined &&" "true ||"
saboter "autre app permise" "$U" 'rule.app === delegation.app' 'true'
saboter "portées non exigées" "$U" 'rule.scopes.every(' 'rule.scopes.some('
saboter "autre méthode permise" "$U" "body?.method !== 'tools/call'" "false"
saboter "rejeu permis" "$S" 'if (!isFirstUse) {' 'if (false as boolean) {'
saboter "portée non contrôlée" "$S" 'if (!isDelegatedCallAllowed(delegation, body)) {' 'if (false as boolean) {'
saboter "origine forgée gardée" "$M" 'stripAttestation(req.body);' ''
saboter "origine non attestée" "$M" 'if (result.delegation) {' 'if (false as boolean) {'
saboter "app posée sans espace du jeton" "$S" 'workspaceId: result.workspaceId,' "workspaceId: '',"
saboter "refus de l'app ignoré" "$S" "if (app.kind === 'refused') {" "if (false as boolean) {"
saboter "app jamais posée" "$S" 'if (applicationUniversalIdentifier) {' 'if (false as boolean) {'
saboter "app posée sans garde d'installation" "$A" '!isApplicationInstallAllowedByVeridian({' 'false && !isApplicationInstallAllowedByVeridian({'
saboter "app désinstallée qui revient" "$A" 'if (!isInstalling && (await this.wasSeen(target))) {' 'if (false as boolean) {'
saboter "installation en cours prise pour une désinstallation" "$A" '!isInstalling && ' ''
saboter "travail en échec accepté" "$A" 'if (status?.state === JobStateEnum.FAILED) {' 'if (false as boolean) {'
saboter "ligne sans version prise pour installée" "$A" 'return isNonEmptyString((await this.findApplication(target))?.version);' 'return (await this.findApplication(target)) !== null;'
saboter "espace jamais marqué" "$A" '    if (await this.wasSeen(target)) {' '    if (true as boolean) {'
saboter "marque commune à tous les espaces" "$A" '        workspaceId: target.workspaceId,
        userId: IsNull(),' '        userId: IsNull(),'

exit "$rate"
