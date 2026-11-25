#!/usr/bin/env bash
# mutations-suspension.sh — éprouve la suspension Veridian (CONTRAT-HUB §5.4) : chaque comportement retiré doit faire échouer la spec.
# Sortie : 0 tous détectés · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

SERVICE=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/services/veridian-hub-suspension.service.ts
CLEANER=packages/twenty-server/src/engine/workspace-manager/workspace-cleaner/services/cleaner.workspace-service.ts
GARDE=packages/twenty-server/src/engine/guards/workspace-not-suspended.guard.ts
CLASSE=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/constants/suspended-workspace-handlers.constant.ts
UTIL=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/utils/is-magic-link-refused-for-suspension.util.ts
FILE=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/utils/postpone-suspended-workspace-job.util.ts
JETON=packages/twenty-server/src/engine/core-modules/auth/token/services/renew-token.service.ts
ORG=packages/twenty-server/src/engine/core-modules/veridian-hub-sso/services/veridian-hub-organisation.service.ts
HUBMCP=packages/twenty-server/src/engine/core-modules/veridian-hub-mcp/services/veridian-hub-mcp-auth.service.ts
WFCRON=packages/twenty-server/src/modules/workflow/workflow-trigger/automated-trigger/crons/jobs/workflow-cron-trigger-cron.job.ts
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'suspension-.*veridian|organisation-hub' >"$TMP/jest.log" 2>&1)
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

saboter "suspendedAt posé à la suspension" "$SERVICE" "suspendedAt: null," "suspendedAt: new Date(),"
saboter "reprise sans réactivation natif" "$SERVICE" "await this.workspaceService.reactivateWorkspace(workspaceId);" "void workspaceId;"
saboter "événement natif de suspension non émis" "$SERVICE" "this.eventEmitter.emit(WORKSPACE_SUSPENDED_EVENT, {" "void ({"
saboter "nettoyage natif rebranché" "$CLEANER" "if (SUSPENSION_NEVER_ERASES) {" "if (false as boolean) {"
saboter "nettoyage natif rebranché par sa constante" "$CLEANER" "SUSPENSION_NEVER_ERASES: boolean = true;" "SUSPENSION_NEVER_ERASES: boolean = false;"
saboter "espace en création suspendu" "$SERVICE" "if ((affected ?? 0) === 0) {" "if (false as boolean) {"
saboter "cache de l'espace gardé à la suspension" "$SERVICE" "await this.coreEntityCacheService.invalidate(
      'workspaceEntity',
      workspaceId,
    );" ""
saboter "file : espace suspendu exécuté" "$FILE" "if (!(await readIsSuspended(workspaceId, coreEntityCacheService))) {" "if (true as boolean) {"
saboter "file : démarrage du worker, une seule lecture" "$FILE" "const READ_ATTEMPTS = 5;" "const READ_ATTEMPTS = 1;"
saboter "file : panne du cache perd la tâche" "$FILE" "  return false;
};

// CONTRAT-HUB" "  return true;
};

// CONTRAT-HUB"
saboter "file : tâche perdue au lieu d'être reportée" "$FILE" "await queue.add(job.name" "void (async (..._: unknown[]) => undefined)(job.name"
saboter "file : lot de webhooks ignoré" "$FILE" "Array.isArray(data) ? data[0] : data" "data"
saboter "file : sans délai" "$FILE" "delay: SUSPENDED_JOB_DELAY_MS," ""
saboter "file : révocation des abonnements reportée" "$FILE" " || JOBS_RUN_WHILE_SUSPENDED.includes(job.name)" ""
saboter "rafraîchissement permis" "$JETON" "workspaceId &&
      isWorkspaceSuspended(" "(false as boolean) &&
      isWorkspaceSuspended("
saboter "organisation appliquée à un espace suspendu" "$ORG" "if (workspace.activationStatus === WorkspaceActivationStatus.SUSPENDED) {" "if (false as boolean) {"
saboter "garde : tout passe pour un espace suspendu" "$GARDE" "if (" "if (true || "
saboter "garde : entrée fermée ignorée (décorée, donc passante)" "$CLASSE" '  SUSPENDED_WORKSPACE_CLOSED_HANDLERS.has(`${className}.${handlerName}`) ||' "  false ||"
saboter "classement : gestionnaire amont non classé" "$CLASSE" "  'MessageChannelResolver.myMessageChannels'," ""
saboter "classement : contrôleur fermé entier retiré" "$CLASSE" "  'BillingResolver.*'," ""
saboter "cron des workflows : espaces suspendus parcourus" "$WFCRON" "activationStatus: WorkspaceActivationStatus.ACTIVE," "activationStatus: [WorkspaceActivationStatus.ACTIVE, WorkspaceActivationStatus.SUSPENDED] as never,"
saboter "jeton du Hub : espace suspendu accepté" "$HUBMCP" "          membership.workspace?.activationStatus ===
          WorkspaceActivationStatus.ACTIVE," "          membership.workspace !== undefined,"
saboter "423 : espace demandé suspendu ignoré" "$UTIL" "requestedSuspended || allSuspended;" "allSuspended;"
saboter "423 : tous suspendus ignoré" "$UTIL" "requestedSuspended || allSuspended;" "requestedSuspended;"

[ "$rate" -eq 0 ] && echo "CONFORME"
exit "$rate"
