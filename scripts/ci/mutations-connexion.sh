#!/usr/bin/env bash
# mutations-connexion.sh — éprouve contrat-connexion-automatique.veridian.spec.ts : retire chaque
# comportement du §6bis.8.0 et exige que la spec échoue. Un sabotage non détecté fait sortir en 1.
# Sortie : 0 tous détectés · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

C=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/controllers/veridian-hub-sso.controller.ts
S=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service.ts
G=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/guards/hub-only-identity.guard.ts
N=packages/twenty-shared/src/utils/navigation/createSingleNavigation.ts

jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'contrat-connexion-automatique|hub-only-identity|marque.veridian' >/tmp/mutation.log 2>&1)
}

jouer || { tail -30 /tmp/mutation.log; echo "NON ABOUTI : spec rouge sans sabotage"; exit 2; }
echo "base verte"

rate=0
saboter() {
  local nom="$1" fichier="$2" avant="$3" apres="$4"
  cp "$fichier" /tmp/mutation.sauve
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
    echo "détecté : $nom ($(grep -cE '^\s+●' /tmp/mutation.log) signalements)"
  fi
  cp /tmp/mutation.sauve "$fichier"
}

saboter "1. auto=1 retiré" "$C" '`${bounce}&auto=1`' 'bounce'
saboter "1. returnToPath perdu" "$C" '`${ownOrigin}${requestedPath}`' 'ownOrigin'
saboter "1. next étranger suivi" "$C" 'const target = parseOwnUrl(next, serverUrl)' 'const target = next'
saboter "1. cookie d'essai non posé" "$C" "response.cookie(AUTO_TRY_COOKIE, '1', { ...options, maxAge: FIVE_MINUTES_MS });" ""
saboter "2. logout sans cookie" "$C" "response.cookie(SIGNED_OUT_COOKIE, '1', {" "response.cookie('autre', '1', {"
saboter "2. cookie de déconnexion ignoré" "$C" 'cookies.includes(`${SIGNED_OUT_COOKIE}=`) ||' ''
saboter "3. cookie d'essai ignoré" "$C" 'cookies.includes(`${AUTO_TRY_COOKIE}=`) ||' ''
saboter "4. iframe rebondit" "$C" "fetchDest === 'iframe'" "false"
saboter "4. requête non navigation acceptée" "$C" "fetchMode !== 'navigate'" "false"
saboter "4. route ouverte au POST" "$C" "@Get('welcome')" "@Post('welcome')"
saboter "5. origine non contrôlée" "packages/twenty-server/src/engine/core-modules/veridian-hub-sso/utils/parse-own-url.util.ts" "if (!isSameHost && !isSubdomain) {" "if (false as boolean) {"
saboter "5. espace demandé ignoré" "$S" 'ownNext?.subdomain ?? null' 'null'
saboter "6. revoke_sessions sans effet" "$S" 'if (revokeSessions === true) {' 'if (false as boolean) {'
saboter "boucle : garde retirée" "$N" 'if (url === navigatingToUrl) {' 'if (false as boolean) {'

for mutation in deleteUser deleteUserFromWorkspace deleteCurrentWorkspace initiateOTPProvisioning initiateOTPProvisioningForAuthenticatedUser verifyTwoFactorAuthenticationMethodForAuthenticatedUser deleteTwoFactorAuthenticationMethod generateTwoFactorAuthenticationRecoveryCode revokeTwoFactorAuthenticationRecoveryCode getAuthTokensFromOTP getAuthTokensFromTwoFactorAuthenticationRecoveryCode; do
  saboter "garde : $mutation permis" "$G" "  '$mutation',"$'\n' ""
done
for reglage in editableProfileFields isPasswordAuthEnabled isPasswordAuthBypassEnabled isPublicInviteLinkEnabled isTwoFactorAuthenticationEnforced; do
  saboter "garde : $reglage rouvrable" "$G" "  '$reglage',"$'\n' ""
done
saboter "garde : réouverture ignorée" "$G" "isRenaming ||"$'\n'"      isReopening" "isRenaming"
saboter "marque : nom amont gardé" packages/twenty-front/src/modules/veridian-brand/replaceBrandInMessages.ts "'Veridian CRM'" "'Twenty'"
saboter "marque : messages compilés ignorés" packages/twenty-front/src/modules/veridian-brand/replaceBrandInMessages.ts "return message.map(replaceBrand);" "return message;"

exit "$rate"
