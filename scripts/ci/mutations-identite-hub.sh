#!/usr/bin/env bash
# mutations-identite-hub.sh — éprouve identite-hub (CONTRAT-HUB §5.19.7) : chaque comportement retiré doit la faire échouer.
# Sortie : 0 tous détectés · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

V=packages/twenty-server/src/engine/core-modules/veridian-hub-sso
jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'identite-hub|retrait-membre' >/tmp/mutation-identite-hub.log 2>&1)
}
jouer || { tail -40 /tmp/mutation-identite-hub.log; echo "NON ABOUTI : spec rouge sans sabotage"; exit 2; }
echo "base verte"

rate=0
saboter() {
  local nom="$1" fichier="$2" avant="$3" apres="$4"
  cp "$fichier" /tmp/mutation-identite-hub.sauve
  node -e '
    const fs = require("fs");
    const [p, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(p, "utf8");
    if (!s.includes(a)) process.exit(1);
    fs.writeFileSync(p, s.replace(a, () => b));
  ' "$fichier" "$avant" "$apres" || { cp /tmp/mutation-identite-hub.sauve "$fichier"; echo "NON ABOUTI : motif absent ($nom)"; exit 2; }
  if jouer; then
    echo "NON DÉTECTÉ : $nom"; rate=1
  elif grep -q 'Test suite failed to run' /tmp/mutation-identite-hub.log; then
    cp /tmp/mutation-identite-hub.sauve "$fichier"; echo "NON ABOUTI : la spec n'a pas tourné ($nom)"; exit 2
  else
    echo "détecté : $nom"
  fi
  cp /tmp/mutation-identite-hub.sauve "$fichier"
}

S=$V/services/veridian-hub-sso.service.ts
C=$V/controllers/veridian-hub-sso.controller.ts
saboter "retrait par l'adresse" "$S" "  async removeMember(workspaceId: string, hubUserId: string) {
    const user = await this.findUserByHubUserId(hubUserId);" "  async removeMember(workspaceId: string, hubUserId: string) {
    const user = await this.userRepository.findOne({ where: { email: 'jean@ancienne.fr' } });"
saboter "appartenance lue par l'adresse" "$S" "    const user = await this.findUserByHubUserId(hubUserId);

    if (!user) {
      return { isMember" "    const user = (await this.findUserByHubUserId(hubUserId)) ?? (await this.userRepository.findOne({ where: { email: 'jean@ancienne.fr' } }));

    if (!user) {
      return { isMember"
saboter "adresse d'un autre acceptée" "$S" "if (otherLink || !emailProven) {" "if (!emailProven) {"
saboter "adresse non prouvée acceptée" "$S" "if (otherLink || !emailProven) {" "if (otherLink) {"
saboter "rebond : preuve supposée" "$S" "emailProven = false," "emailProven = true,"
saboter "propriétaire jugé à l'adresse" "$S" "existing.value.ownerHubUserId !== hubUserId" "existing.value.ownerEmail !== ownerEmail"
saboter "propriétaire inconnu accepté" "$S" "!owner || existing" "existing"
saboter "conflit d'adresse ignoré" "$S" "if (await this.userRepository.findOne({ where: { email } })) {" "if (false as boolean) {"
saboter "adresse prise en route : 500" "$S" "error?.code === POSTGRES_UNIQUE_VIOLATION" "false"
saboter "panne maquillée en conflit" "$S" "error?.code === POSTGRES_UNIQUE_VIOLATION" "true"
saboter "fiche laissée à l'ancienne adresse" "$S" "await this.writeMemberRecords(userId, { userEmail: email });" ""
saboter "fiche restaurée à l'ancienne adresse" "$S" "await repository.update({ userId }, { userEmail: email });" ""
saboter "conflit après les sessions" "$S" "    if (
      email &&
      email.toLowerCase() !== user.email &&" "    if (revokeSessions) { await this.userSessionService.revokeAllSessionsForUser({ userId: user.id, reason: UserSessionRevokedReason.UserRevoked }); }
    if (
      email &&
      email.toLowerCase() !== user.email &&"
saboter "liste : l'adresse avant l'identité" "$S" "hubUserId ? hubUserKey(hubUserId) : (email ?? '').toLowerCase()," "email ? email.toLowerCase() : hubUserKey(hubUserId ?? ''),"
saboter "liste : propriétaire par l'adresse" "$S" "role: isOwner ? 'owner' : 'member'," "role: link?.ownerEmail === email ? 'owner' : 'member',"
saboter "liste : filtre par l'adresse" "$S" "          hubUserId
            ? \`EXISTS" "          (hubUserId as string) === 'x'
            ? \`EXISTS"
saboter "conversion rejouée" "$S" "AND NOT k.value ? 'ownerHubUserId'" ""
saboter "conversion ambiguë devinée" "$S" "CASE WHEN count(*) = 1 THEN min(substr(l.key, \$1)) END" "min(substr(l.key, \$1))"
saboter "conversion en panne empêche le démarrage" "$S" "this.logger.error(\`Hub owners conversion failed: \${error}\`);" "throw error;"
saboter "route de retrait : adresse seule" "$C" "    const hubUserId = request.body?.hub_user_id;

    if (!UUID_PATTERN.test(hubUserId ?? '')) {" "    const hubUserId = request.body?.hub_user_id;

    if (false as boolean) {"
saboter "users/sync : adresse illisible acceptée" "$C" " ||
      (email !== undefined && email !== null && !isNonEmptyString(email))" ""
saboter "users/sync : conflit dit 404" "$C" "outcome === 'email_conflict' ? 409 : 404" "outcome === 'email_conflict' ? 404 : 404"
saboter "provision : metadata d'abord" "$C" "request.body?.owner_hub_user_id ?? metadata?.hub_user_id" "metadata?.hub_user_id ?? request.body?.owner_hub_user_id"
saboter "by-email : identité illisible ignorée" "$C" "hubUserId ? !isUuid(hubUserId) : !isNonEmptyString(email)" "!isNonEmptyString(email)"
saboter "adresse prouvée supposée au rattachement" "$C" "      hubUserId,
      email,
      emailProven: request.body?.email_proven === true,
    });

    if (result.status === 'workspace_not_found')" "      hubUserId,
      email,
      emailProven: true,
    });

    if (result.status === 'workspace_not_found')"
saboter "adresse prouvée supposée à la synchro" "$C" "      hubUserId,
      email,
      emailProven: request.body?.email_proven === true,
    });

    if (result.status !== 'ok')" "      hubUserId,
      email,
      emailProven: true,
    });

    if (result.status !== 'ok')"
saboter "preuve d'adresse lue en texte" "$C" "emailProven: request.body?.email_proven === true," "emailProven: Boolean(request.body?.email_proven),"

[ "$rate" -eq 0 ] && { echo "CONFORME"; exit 0; }
exit 1
