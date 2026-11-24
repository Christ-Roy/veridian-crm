#!/usr/bin/env bash
# mutations-role-hub.sh — éprouve role-hub et retrait-membre (CONTRAT-HUB §5.22) : chaque comportement retiré doit la faire échouer.
# Sortie : 0 tous détectés · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

V=packages/twenty-server/src/engine/core-modules/veridian-hub-sso
jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'role-hub|retrait-membre' >/tmp/mutation-role.log 2>&1)
}
jouer || { tail -40 /tmp/mutation-role.log; echo "NON ABOUTI : spec rouge sans sabotage"; exit 2; }
echo "base verte"

rate=0
saboter() {
  local nom="$1" fichier="$2" avant="$3" apres="$4"
  cp "$fichier" /tmp/mutation-role.sauve
  node -e '
    const fs = require("fs");
    const [p, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(p, "utf8");
    if (!s.includes(a)) process.exit(1);
    fs.writeFileSync(p, s.replace(a, () => b));
  ' "$fichier" "$avant" "$apres" || { cp /tmp/mutation-role.sauve "$fichier"; echo "NON ABOUTI : motif absent ($nom)"; exit 2; }
  if jouer; then
    echo "NON DÉTECTÉ : $nom"; rate=1
  elif grep -q 'Test suite failed to run' /tmp/mutation-role.log; then
    cp /tmp/mutation-role.sauve "$fichier"; echo "NON ABOUTI : la spec n'a pas tourné ($nom)"; exit 2
  else
    echo "détecté : $nom"
  fi
  cp /tmp/mutation-role.sauve "$fichier"
}

R=$V/services/veridian-hub-role.service.ts
S=$V/services/veridian-hub-sso.service.ts
P=$V/utils/parse-hub-organisations.util.ts
saboter "version égale acceptée" "$R" "version <= storedRole.version" "version < storedRole.version"
saboter "version ancienne acceptée" "$R" "version <= storedRole.version" "version === storedRole.version"
saboter "rôle sur mesure rétrogradé" "$R" "(role === 'member' && !isAdmin)" "false"
saboter "Admin reconnu à son libellé" "$R" "current?.universalIdentifier === STANDARD_ROLE.admin.universalIdentifier" "current?.label === 'Admin'"
saboter "dernier Admin : erreur brute" "$R" "error.code === PermissionsExceptionCode.CANNOT_UNASSIGN_LAST_ADMIN" "false"
saboter "version consommée sans effet" "$R" "return { status: 'ok', applied: false, reason: 'last_admin' };" "await remember(); return { status: 'ok', applied: false, reason: 'last_admin' };"
saboter "non-membre ignoré" "$R" "if (!userWorkspace) {" "if (false as boolean) {"
saboter "autre espace" "$R" "where: { userId, workspaceId }," "where: { userId },"
saboter "sans verrou" "$R" '`veridian-hub-role:${workspaceId}:${userId}`' "'veridian-hub-role'"
saboter "membre reçoit Admin" "$R" "role === 'member'
        ? await" "role === 'owner'
        ? await"
saboter "connexion bloquée par un rôle" "$R" "} catch (error) {
        this.logger.warn(" "} catch (error) {
        throw error;
        this.logger.warn("
saboter "rôle du Hub gardé au départ" "$S" "await this.veridianHubRoleService.forgetRole(workspace.id, user.id);" ""
saboter "rôle inconnu accepté au rebond" "$P" "isHubRole(organisation?.role) &&" ""
saboter "version non vérifiée au rebond" "$P" "isHubRoleVersion(organisation?.version)" "true"
A=$V/utils/assert-role-not-carried-by-hub.util.ts
U=packages/twenty-server/src/engine/permissions/role-assignment/user-role.service.ts
saboter "espace porté non marqué" "$R" "await this.markCarried(workspaceId);" ""
saboter "libération : autre espace" "$R" "workspaceId: tenant.workspaceId,
      userId: IsNull()," "userId: IsNull(),"
saboter "refus natif retiré" "$U" "await assertRoleNotCarriedByHub(" "void (async (..._: unknown[]) => undefined)("
saboter "refus d'un autre espace" "$A" '[HUB_ROLE_CARRIED_KEY, workspaceId]' '[HUB_ROLE_CARRIED_KEY]'
saboter "espace porté accepté" "$A" "carried.length > 0" "false"
saboter "clé révoquée comptée" "$S" 'AND "revokedAt" IS NULL ' ''

[ "$rate" -eq 0 ] && { echo "CONFORME"; exit 0; }
exit 1
