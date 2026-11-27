#!/usr/bin/env bash
# mutations-organisation.sh — éprouve organisation-hub et retrait-membre (CONTRAT-HUB §5.19.6) : chaque comportement retiré doit la faire échouer.
# Sortie : 0 tous détectés · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

V=packages/twenty-server/src/engine/core-modules/veridian-hub-sso
jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'organisation-hub|retrait-membre' >/tmp/mutation-organisation.log 2>&1)
}
jouer || { tail -40 /tmp/mutation-organisation.log; echo "NON ABOUTI : spec rouge sans sabotage"; exit 2; }
echo "base verte"

rate=0
saboter() {
  local nom="$1" fichier="$2" avant="$3" apres="$4"
  cp "$fichier" /tmp/mutation-organisation.sauve
  node -e '
    const fs = require("fs");
    const [p, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(p, "utf8");
    if (!s.includes(a)) process.exit(1);
    fs.writeFileSync(p, s.replace(a, () => b));
  ' "$fichier" "$avant" "$apres" || { cp /tmp/mutation-organisation.sauve "$fichier"; echo "NON ABOUTI : motif absent ($nom)"; exit 2; }
  if jouer; then
    echo "NON DÉTECTÉ : $nom"; rate=1
  elif grep -q 'Test suite failed to run' /tmp/mutation-organisation.log; then
    cp /tmp/mutation-organisation.sauve "$fichier"; echo "NON ABOUTI : la spec n'a pas tourné ($nom)"; exit 2
  else
    echo "détecté : $nom"
  fi
  cp /tmp/mutation-organisation.sauve "$fichier"
}

O=$V/services/veridian-hub-organisation.service.ts
P=$V/utils/parse-hub-organisation.util.ts
S=$V/services/veridian-hub-sso.service.ts
saboter "nom du compte renomme" "$P" "const name = body.marque?.nom_affiche;" "const name = body.marque?.nom_affiche ?? body.nom;"
saboter "logo d'ailleurs" "$P" "url.startsWith(prefix) && " ""
saboter "logo d'une autre organisation" "$P" '/api/public/org/${hubTenantId}/logo?v=`' '/api/public/org/`'
saboter "empreinte de logo libre" "$P" '/^[\w-]{1,64}$/' '/^.*$/'
saboter "Hub inconnu accepté" "$P" "!hubUrl || " "!!hubUrl && "
saboter "adresse non prouvée acceptée" "$P" "member.email_proven === true &&" ""
saboter "rôle inconnu accepté" "$P" "isHubRole(member.role) &&" ""
saboter "adhésion illisible acceptée" "$P" "!Number.isNaN(joinedAt.getTime())" "true"
saboter "identité illisible acceptée" "$P" "isUuid(member?.hub_user_id) &&" "member &&"
saboter "écartés non comptés" "$P" "refused: members.length - parsed.length," "refused: 0,"
saboter "version non vérifiée" "$P" "!isHubRoleVersion(version) ||" ""
saboter "liste sans borne" "$P" "members.length > MEMBERS_MAX" "false"
saboter "version égale rejouée" "$O" "organisation.version <= stored.value.version" "organisation.version < stored.value.version"
saboter "version ancienne acceptée" "$O" "organisation.version <= stored.value.version" "organisation.version === stored.value.version"
saboter "espace non relié accepté" "$O" "if (!workspace) {" "if (false as boolean) {"
saboter "sans verrou par espace" "$O" '`veridian-hub-organisation:${workspaceId}`' "'veridian-hub-organisation'"
saboter "version d'un autre espace" "$O" "where: { key: HUB_ORGANISATION_KEY, workspaceId, userId: IsNull() }," "where: { key: HUB_ORGANISATION_KEY, userId: IsNull() },"
saboter "nom absent vide l'espace" "$O" "organisation.chosenName &&
      organisation" "organisation"
saboter "cache du nom gardé" "$O" "await this.coreEntityCacheService.invalidate(
        'workspaceEntity',
        workspaceId,
      );" ""
saboter "cache du logo gardé" "$O" "await this.coreEntityCacheService.invalidate(
      'workspaceEntity',
      workspace.id,
    );" ""
saboter "panne d'un membre oubliée" "$O" "if (failed > 0) {" "if (false as boolean) {"
saboter "panne d'un membre arrête les autres" "$O" "count.failed++;" "count.failed++; break;"
saboter "présent rejoué" "$O" "if (membership.isMember) {" "if (false as boolean) {"
saboter "retiré revient toujours" "$O" "(membership.removedAt && joinedAt <= membership.removedAt)" "false"
saboter "retiré revient au même instant" "$O" "joinedAt <= membership.removedAt" "joinedAt < membership.removedAt"
saboter "retiré ne revient jamais" "$O" "(membership.removedAt && joinedAt <= membership.removedAt)" "membership.removedAt"
saboter "compte désactivé rattaché" "$O" "membership.isDisabled ||" ""
saboter "identité contestée comptée" "$O" "if (result.status !== 'ok') {" "if (false as boolean) {"
saboter "rôles portés sans que le Hub les porte" "$O" "await this.veridianHubRoleService.isCarried(workspaceId)" "true"
saboter "rôle à l'heure du document" "$O" "version: joinedAt.getTime()," "version: Date.now(),"
saboter "logo nul oublie le logo posé" "$O" "logoUrl: stored?.logoUrl ?? null," "logoUrl: null,"
saboter "logo rechargé à chaque fois" "$O" "stored.logoFileId === replacedLogoFileId" "false"
saboter "logo posé à la main gardé" "$O" "stored.logoFileId === replacedLogoFileId" "true"
saboter "nouveau logo ignoré" "$O" "stored?.logoUrl === logoUrl &&" "stored &&"
saboter "logo non servi dit posé" "$O" "if (!logo) {" "if (false as boolean) {"
saboter "ancien fichier gardé" "$O" "if (replacedLogoFileId) {" "if (false as boolean) {"
saboter "appartenance retirée comptée présente" "$S" "isMember: memberships.some(({ deletedAt }) => !deletedAt)," "isMember: memberships.length > 0,"
saboter "premier retrait au lieu du dernier" "$S" "new Date(Math.max(...removals))" "new Date(Math.min(...removals))"
saboter "logo dit appliqué sans le fichier de l'espace (VER-252)" "$O" "        workspace?.logoFileId === stored?.logoFileId," "        true,"

[ "$rate" -eq 0 ] && { echo "CONFORME"; exit 0; }
exit 1
