#!/usr/bin/env bash
# mutations-delegation.sh : éprouve l'appel du CRM vers une autre app (CONTRAT-HUB §5.19.5), chaque garde retirée doit faire échouer la spec.
# Sortie : 0 tous détectés · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

M=packages/twenty-server/src/engine/core-modules/veridian-delegation
SERVICE=$M/services/veridian-delegation.service.ts
POIGNEE=$M/services/veridian-grant.service.ts
ENTREE=$M/controllers/veridian-delegation.controller.ts
URL_=$M/utils/parse-action-url.util.ts
LECTURE=$M/utils/parse-hub-grants.util.ts
REGISTRE=$M/constants/delegated-targets.constant.ts
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'delegation-.*veridian' >"$TMP/jest.log" 2>&1)
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
    echo "NON DÉTECTÉ : $nom"
    rate=1
  elif grep -q 'Test suite failed to run' "$TMP/jest.log"; then
    cp "$TMP/sauve" "$fichier"; echo "NON ABOUTI : la spec n'a pas tourné ($nom)"; exit 2
  else
    echo "détecté : $nom"
  fi
  cp "$TMP/sauve" "$fichier"
}

saboter "jeton d'une autre organisation accepté" "$SERVICE" "tenantId.toLowerCase() !== hubTenantId" "false"
saboter "jeton donné à une adresse non vérifiée" "$SERVICE" "const actionUrl = parseActionUrl(url);" "const actionUrl = url as string;"
saboter "redirection suivie" "$SERVICE" "redirect: 'error'," ""
saboter "poignée refusée gardée" "$SERVICE" "      await this.veridianGrantService.forget(userId, workspaceId);
" ""
saboter "demande non signée avec le nonce" "$SERVICE" '`${timestamp}.${nonce}.${body}`' '`${timestamp}.${body}`'
saboter "refus du Hub pris pour un accord" "$SERVICE" "if (exchange.status !== 200) {" "if (false as boolean) {"
saboter "app muette prise pour un succès" "$SERVICE" ": refusal(503, unreachable);" ": refusal(200, unreachable);"
saboter "clé de geste perdue" "$SERVICE" "...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})," ""
saboter "liaison hors registre montrée" "$SERVICE" "!isDelegatedTarget(String(pair?.audience)) ||" ""
saboter "une liaison éteinte éteint les autres" "$SERVICE" "if (states[pair.audience] !== 'allumee') {" "if (true as boolean) {"
saboter "portée d'une autre app montrée" "$SERVICE" "if (findScopes(pair.audience).includes(scope)) {" "if (true as boolean) {"
saboter "état par portée perdu" "$SERVICE" "          states[scope] = pair.etat;" ""
saboter "http accepté" "$URL_" "protocol === 'https:' &&" ""
saboter "autre domaine accepté" "$URL_" "hostname.endsWith('.veridian.site')" "hostname.includes('.')"
saboter "port accepté" "$URL_" "port === '' &&" ""
saboter "identifiants dans l'adresse acceptés" "$URL_" "    username === '' &&
    password === '' &&
" ""
saboter "poignée en clair" "$POIGNEE" "this.secretEncryptionService.encryptVersioned(
            grant as PlaintextString,
            { workspaceId: tenant.workspaceId },
          )" "grant as never"
saboter "poignée périmée servie" "$POIGNEE" " || new Date(stored.expiresAt).getTime() <= Date.now()" ""
saboter "poignée d'une autre personne" "$POIGNEE" "where: { key: GRANT_KEY, userId, workspaceId }," "where: { key: GRANT_KEY, workspaceId },"
saboter "panne qui bloque la connexion" "$POIGNEE" "    } catch (error) {
      this.logger.warn(" "    } catch (error) {
      throw error;
      this.logger.warn("
saboter "poignée périmée rangée" "$LECTURE" "new Date(delegation?.expire_le).getTime() > now" "true"
saboter "organisation mal formée rangée" "$LECTURE" "isUuid(delegation?.hub_tenant_id) &&" "delegation &&"
saboter "toute app peut agir" "$ENTREE" "findTargetsOfApp(application.universalIdentifier).length === 0" "false"
saboter "une app atteint les cibles d'une autre" "$ENTREE" "isDelegatedTarget(target) && actor.targets.includes(target)" "isDelegatedTarget(target)"
saboter "app sans personne" "$ENTREE" "      !user ||
" "      false ||
"
saboter "un agent peut agir" "$ENTREE" "      agentId !== undefined ||
" ""
saboter "session d'emprunt acceptée" "$ENTREE" "      impersonationContext !== undefined ||
" ""
saboter "app locale au même identifiant acceptée" "$ENTREE" "return isOurs" "return (true as boolean)"
saboter "écriture sans clé de geste" "$ENTREE" "        idempotencyKey === undefined)" "        false)"
saboter "corps sans limite" "$ENTREE" "JSON.stringify(payload).length > PAYLOAD_MAX_BYTES ||" ""
saboter "action hors registre" "$REGISTRE" "Object.keys(actions).includes(action) ? actions[action] : null" "({ isIdempotent: false })"
saboter "séquence inscrite avec la portée des listes" "$REGISTRE" "scope: 'notifuse:sequences.inscrire'," "scope: 'notifuse:contacts.ecrire',"
saboter "lecture d'un contact avec la portée d'écriture" "$REGISTRE" "scope: 'notifuse:contacts.lire'," "scope: 'notifuse:contacts.ecrire',"
saboter "portée de l'action perdue" "$ENTREE" "scope: delegated.scope," "scope: 'notifuse:contacts.ecrire',"
saboter "séquence inscrite sans clé de geste" "$REGISTRE" "      scope: 'notifuse:sequences.inscrire',
      isIdempotent: true," "      scope: 'notifuse:sequences.inscrire',
      isIdempotent: false,"
saboter "cible hors registre" "$REGISTRE" "Object.keys(DELEGATED_TARGETS).includes(value)" "true"

[ "$rate" -eq 0 ] && echo "CONFORME"
exit "$rate"
