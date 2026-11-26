#!/usr/bin/env bash
# mutations-signature-unique.sh : éprouve signature-usage-unique.veridian.spec.ts, chaque retrait de l'usage unique des signatures du Hub doit la faire échouer.
# Sortie : 0 tous détectés (compte affiché) · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

C=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/controllers/veridian-hub-sso.controller.ts
V=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service.ts
U=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/utils/is-hub-signature-valid.util.ts
LOG=$(mktemp /tmp/mutation-signature.XXXXXX)
SAUVE=$(mktemp /tmp/mutation-signature-sauve.XXXXXX)
FICHIER_EN_COURS=""
restaurer() { [ -n "$FICHIER_EN_COURS" ] && [ -s "$SAUVE" ] && cp "$SAUVE" "$FICHIER_EN_COURS"; rm -f "$LOG" "$SAUVE"; }
trap restaurer EXIT

jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'signature-usage-unique' >"$LOG" 2>&1)
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

saboter "consommation de la signature sautée" "$C" "    if (!(await this.veridianHubSsoService.consumeHubSignature(signature))) {" "    if (!(await Promise.resolve(true))) {"
saboter "refus du rejeu sans retour" "$C" "      response.status(401).json({ error: 'signature_already_used' });

      return false;" "      response.status(401).json({ error: 'signature_already_used' });"
saboter "signature fausse qui passe quand même" "$C" "    if (!isSigned || !isNonEmptyString(signature)) {" "    if (!isNonEmptyString(signature)) {"
saboter "rejeu accepté (le verrou ne décide plus)" "$V" "    return this.cacheStorage.setIfAbsent(" "    return true || this.cacheStorage.setIfAbsent("
saboter "v2 : chemin hors de la signature" "$U" "      path,
      query.join('?')," "      query.join('?'),"
saboter "v2 : méthode hors de la signature" "$U" "      (route?.method ?? '').toUpperCase()," "      '',"
saboter "v2 : requête hors de la signature" "$U" "      query.join('?')," "      '',"
saboter "v2 : corps hors de la signature" "$U" "      createHash('sha256').update(rawBody).digest('hex')," "      createHash('sha256').digest('hex'),"
saboter "v2 jamais reconnue" "$C" "?.trim() === '2' ? 'v2' : 'v1';" "?.trim() === '3' ? 'v2' : 'v1';"
saboter "interrupteur v2 obligatoire sans effet" "$C" "process.env.VERIDIAN_HMAC_REQUIRE_V2 === 'true'" "process.env.VERIDIAN_HMAC_REQUIRE_V2 === 'jamais'"

echo "$detectes sabotages détectés sur $total"
[ "$rate" -eq 0 ] && { echo "CONFORME"; exit 0; }
exit 1
