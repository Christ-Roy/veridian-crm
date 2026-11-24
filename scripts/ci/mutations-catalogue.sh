#!/usr/bin/env bash
# mutations-catalogue.sh — éprouve catalogue-instance.veridian.spec.ts : retire chaque condition qui ouvre les gardes
# d'installation et d'exécution aux apps listées ou préinstallées, et ce qui rend ces drapeaux sûrs à l'amont.
# Sortie : 0 tous détectés · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

B=packages/twenty-server/src/engine/core-modules
U=$B/veridian-coupures/is-application-install-allowed-by-veridian.util.ts
L=$B/veridian-coupures/is-logic-function-allowed-by-veridian.util.ts
I=$B/application/application-install/application-install.service.ts
X=$B/logic-function/logic-function-executor/logic-function-executor.service.ts
R=$B/application/application-registration/application-registration.service.ts
A=$B/admin-panel/admin-panel.resolver.ts

jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'catalogue-instance' >/tmp/mutation-catalogue.log 2>&1)
}

jouer || { tail -60 /tmp/mutation-catalogue.log; echo "NON ABOUTI : spec rouge sans sabotage"; exit 2; }
echo "base verte"

rate=0
saboter() {
  local nom="$1" fichier="$2" avant="$3" apres="$4"
  cp "$fichier" /tmp/mutation-catalogue.sauve
  node -e '
    const fs = require("fs");
    const [p, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(p, "utf8");
    if (!s.includes(a)) process.exit(1);
    fs.writeFileSync(p, s.replace(a, () => b));
  ' "$fichier" "$avant" "$apres" || { cp /tmp/mutation-catalogue.sauve "$fichier"; echo "NON ABOUTI : motif absent ($nom)"; exit 2; }
  if jouer; then
    echo "NON DÉTECTÉ : $nom"; rate=1
  elif grep -q 'Test suite failed to run' /tmp/mutation-catalogue.log; then
    cp /tmp/mutation-catalogue.sauve "$fichier"; echo "NON ABOUTI : la spec n'a pas tourné ($nom)"; exit 2
  else
    echo "détecté : $nom ($(grep -cE '^\s+●' /tmp/mutation-catalogue.log) signalements)"
  fi
  cp /tmp/mutation-catalogue.sauve "$fichier"
}

saboter "toute app passe" "$U" "(isListed === true || isPreInstalled === true)" "true"
saboter "listée oubliée" "$U" "(isListed === true || isPreInstalled === true)" "isPreInstalled === true"
saboter "préinstallée oubliée" "$U" "(isListed === true || isPreInstalled === true)" "isListed === true"
saboter "npm accepté" "$U" "sourceType === ApplicationRegistrationSourceType.TARBALL &&" ""
saboter "installation : drapeaux non transmis" "$I" "applicationRegistration: appRegistration," ""
saboter "installation : couples cassés" "$U" '`${workspaceId}:${applicationUniversalIdentifier}`.toLowerCase(),
  ) ||' '`${workspaceId}:`.toLowerCase(),
  ) ||'
saboter "exécution : garde retirée" "$X" "!(await isCatalogApplicationAllowedByVeridian(
        this.workspaceRepository.manager,
        flatApplication,
      ))" "true"
saboter "exécution : tout passe" "$X" "!(await isCatalogApplicationAllowedByVeridian(
        this.workspaceRepository.manager,
        flatApplication,
      ))" "false"
saboter "exécution : couples cassés" "$X" "!isLogicFunctionAllowedByVeridian({" "true || !isLogicFunctionAllowedByVeridian({"
saboter "exécution : code local accepté" "$L" "sourceType !== ApplicationRegistrationSourceType.TARBALL" "false"
saboter "exécution : identifiant non comparé" "$L" "registration.universalIdentifier === universalIdentifier &&" ""
saboter "exécution : lue par l'identifiant du manifeste" "$L" "where: { id: applicationRegistrationId }" "where: { universalIdentifier }"
saboter "exécution : drapeaux non lus" "$L" "isInstanceCatalogApplication(registration)" "true"
T=$B/application/application-registration/application-tarball.service.ts
saboter "catalogue : npm revient" "$R" "sourceType: ApplicationRegistrationSourceType.TARBALL,
        isListed: true," "sourceType: ApplicationRegistrationSourceType.NPM,"
saboter "catalogue : apps privées visibles" "$R" "sourceType: ApplicationRegistrationSourceType.TARBALL,
        isListed: true," "sourceType: ApplicationRegistrationSourceType.TARBALL,"
saboter "republier déliste" "$T" "isListed: existingRegistration?.isListed ?? false," "isListed: false,"
saboter "une app neuve se liste seule" "$T" "isListed: existingRegistration?.isListed ?? false," "isListed: true,"
saboter "amont : un propriétaire pose les drapeaux" "$R" "await this.applyUpdate({ id, update });" "await this.applyUpdate({ id, update, instanceFlags: update as never });"
saboter "amont : mutation sans AdminPanelGuard" "$A" "@UseGuards(AccessPolicyGuard(ADMIN_PANEL_ACCESS_POLICY), AdminPanelGuard)
  @Mutation(() => ApplicationRegistrationEntity)" "@UseGuards(AccessPolicyGuard(ADMIN_PANEL_ACCESS_POLICY))
  @Mutation(() => ApplicationRegistrationEntity)"
saboter "amont : AdminPanelGuard ouvert" "packages/twenty-server/src/engine/guards/admin-panel-guard.ts" "userIsFullAdmin(request.user)" "true"

[ "$rate" -eq 0 ] && { echo "CONFORME : chaque condition du catalogue d'instance est vue échouer"; exit 0; }
exit 1
