#!/usr/bin/env bash
# mutations-oauth-redirection.sh — éprouve redirection-oauth.veridian.spec.ts : retire chaque condition de la politique des
# redirect_uri de POST /oauth/register (R1, GHSA-pg47-7c3r-fwfx) ; la spec doit casser à chaque fois.
# Sortie : 0 tous détectés · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

B=packages/twenty-server/src/engine/core-modules/veridian-oauth
U=$B/is-oauth-redirect-uri-allowed-by-veridian.util.ts
M=$B/veridian-oauth-redirect-policy.middleware.ts
O=$B/veridian-oauth.module.ts

jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'redirection-oauth' >/tmp/mutation-oauth-redirection.log 2>&1)
}

jouer || { tail -60 /tmp/mutation-oauth-redirection.log; echo "NON ABOUTI : spec rouge sans sabotage"; exit 2; }
echo "base verte"

rate=0
saboter() {
  local nom="$1" fichier="$2" avant="$3" apres="$4"
  cp "$fichier" /tmp/mutation-oauth-redirection.sauve
  node -e '
    const fs = require("fs");
    const [p, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(p, "utf8");
    if (!s.includes(a)) process.exit(1);
    fs.writeFileSync(p, s.replace(a, () => b));
  ' "$fichier" "$avant" "$apres" || { cp /tmp/mutation-oauth-redirection.sauve "$fichier"; echo "NON ABOUTI : motif absent ($nom)"; exit 2; }
  if jouer; then
    echo "NON DÉTECTÉ : $nom"; rate=1
  elif grep -q 'Test suite failed to run' /tmp/mutation-oauth-redirection.log; then
    cp /tmp/mutation-oauth-redirection.sauve "$fichier"; echo "NON ABOUTI : la spec n'a pas tourné ($nom)"; exit 2
  else
    echo "détecté : $nom ($(grep -cE '^\s+●' /tmp/mutation-oauth-redirection.log) signalements)"
  fi
  cp /tmp/mutation-oauth-redirection.sauve "$fichier"
}

saboter "interrupteur toujours ouvert" "$M" "if (isOauthRedirectPolicyOpen()) {" "if (true) {"
saboter "absent vaut ouvert" "$U" "process.env.VERIDIAN_OAUTH_REDIRECT_POLICY === 'open'" "process.env.VERIDIAN_OAUTH_REDIRECT_POLICY !== 'closed'"
saboter "interrupteur jamais ouvert" "$U" "process.env.VERIDIAN_OAUTH_REDIRECT_POLICY === 'open'" "false"
saboter "une adresse permise suffit" "$M" "      uris.every(" "      uris.some("
saboter "inscription sans liste acceptée" "$M" "      Array.isArray(uris) &&
      uris.length > 0 &&" "      (!Array.isArray(uris) || uris.length >= 0) &&"
saboter "liste vide acceptée" "$M" "      uris.length > 0 &&" ""
saboter "entrée non texte acceptée" "$M" "typeof uri === 'string' && isOauthRedirectUriAllowedByVeridian(uri)" "typeof uri !== 'string' || isOauthRedirectUriAllowedByVeridian(uri)"
saboter "refus sans code 400" "$M" "res.status(400).json({" "res.status(200).json({"
saboter "refus sans code invalid_redirect_uri" "$M" "error: 'invalid_redirect_uri'," "error: 'invalid_request',"
saboter "refus qui laisse passer" "$M" "    res.status(400).json({" "    next();
    res.status(400).json({"
saboter "tout nom d'hôte est local" "$U" "LOOPBACK_HOSTNAMES.includes(parsed.hostname)" "true"
saboter "schéma non contrôlé pour le local" "$U" "if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {" "if (true) {"
saboter "identifiants dans l'adresse acceptés" "$U" "parsed.username !== '' || parsed.password !== '' || parsed.hash !== ''" "parsed.hash !== ''"
saboter "fragment accepté" "$U" "parsed.username !== '' || parsed.password !== '' || parsed.hash !== ''" "parsed.username !== '' || parsed.password !== ''"
saboter "paramètres de requête acceptés" "$U" "parsed.search !== ''" "false"
saboter "rappel ChatGPT sur n'importe quel domaine" "$U" "(parsed.origin === 'https://chatgpt.com' &&
      CHATGPT_CALLBACK_PATH.test(parsed.pathname))" "CHATGPT_CALLBACK_PATH.test(parsed.pathname)"
saboter "rappel ChatGPT sans identifiant" "$U" "[A-Za-z0-9_-]{1,128}" "[A-Za-z0-9_/-]{0,128}"
saboter "liste figée ouverte au domaine entier" "$U" "ASSISTANT_REDIRECT_URIS.includes(\`\${parsed.origin}\${parsed.pathname}\`)" "ASSISTANT_REDIRECT_URIS.some((u) => u.startsWith(parsed.origin))"
saboter "route non montée" "$O" "path: \`\${ApiPath.OAuth}/register\`," "path: \`\${ApiPath.OAuth}/registre\`,"
saboter "route montée sur GET" "$O" "method: RequestMethod.POST," "method: RequestMethod.GET,"

[ "$rate" -eq 0 ] && { echo "CONFORME : chaque condition de la politique des redirect_uri est vue échouer"; exit 0; }
exit 1
