#!/usr/bin/env bash
# mutations-outils-mcp.sh : éprouve outils-mcp.veridian.spec.ts, chaque garde retirée doit la faire échouer.
# Sortie : 0 tous détectés (compte affiché) · 1 sabotage non détecté · 2 base non verte ou sabotage inapplicable
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

V=packages/twenty-server/src/engine/core-modules/veridian-mcp-tools
T=$V/tools
LOG=$(mktemp /tmp/mutation-outils.XXXXXX)
SAUVE=$(mktemp /tmp/mutation-outils-sauve.XXXXXX)
FICHIER_EN_COURS=""
restaurer() { [ -n "$FICHIER_EN_COURS" ] && [ -s "$SAUVE" ] && cp "$SAUVE" "$FICHIER_EN_COURS"; rm -f "$LOG" "$SAUVE"; }
trap restaurer EXIT

jouer() {
  (cd packages/twenty-server && npx jest --config jest.config.mjs --testPathPattern 'outils-mcp' >"$LOG" 2>&1)
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

P=$V/veridian-mcp-tools-policies.constant.ts
L=$V/veridian-mcp-tools-limits.constant.ts
A=$V/veridian-mcp-tool-annotations.constant.ts
U=packages/twenty-server/src/engine/api/mcp/utils/get-mcp-registry-tool-annotations.util.ts

# Politiques : chacune plus large que celle du résolveur
saboter "synchro de canal sans la permission Comptes connectés" "$P" "requiredPermissionFlags: [PermissionFlagType.CONNECTED_ACCOUNTS]" "requiredPermissionFlags: []"
saboter "workflow lancé sans la permission Workflows" "$P" "requiredPermissionFlags: [PermissionFlagType.WORKFLOWS]" "requiredPermissionFlags: []"
saboter "fils de mails ouverts aux tiers OAuth" "$P" "    oauthClient: false," "    oauthClient: true,"
saboter "partage de fiche ouvert aux clés d'API" "$P" "// RecordSharingResolver
export const VERIDIAN_MCP_RECORD_SHARING_POLICY: AccessPolicy = {
  authPrincipals: {
    userSession: { ...SESSION },
    apiKey: false," "// RecordSharingResolver
export const VERIDIAN_MCP_RECORD_SHARING_POLICY: AccessPolicy = {
  authPrincipals: {
    userSession: { ...SESSION },
    apiKey: true,"
saboter "workflow ouvert aux clés d'API" "$P" "// CoreWorkflowRunResolver.runCoreWorkflowVersion
export const VERIDIAN_MCP_RUN_WORKFLOW_POLICY: AccessPolicy = {
  authPrincipals: {
    userSession: { ...SESSION },
    apiKey: false," "// CoreWorkflowRunResolver.runCoreWorkflowVersion
export const VERIDIAN_MCP_RUN_WORKFLOW_POLICY: AccessPolicy = {
  authPrincipals: {
    userSession: { ...SESSION },
    apiKey: true,"
saboter "session jetable (impersonation) refusée à tort" "$P" "  impersonated: true," "  impersonated: false,"

# Politique d'un outil : celle d'un autre
saboter "retry_channel_sync sous une politique sans drapeau" "$T/retry-channel-sync.tool.ts" "accessPolicy: VERIDIAN_MCP_CHANNEL_SYNC_POLICY," "accessPolicy: { ...VERIDIAN_MCP_CHANNEL_SYNC_POLICY, requiredPermissionFlags: [] },"
saboter "run_workflow sous une politique sans drapeau" "$T/run-workflow.tool.ts" "accessPolicy: VERIDIAN_MCP_RUN_WORKFLOW_POLICY," "accessPolicy: { ...VERIDIAN_MCP_RUN_WORKFLOW_POLICY, requiredPermissionFlags: [] },"
saboter "list_api_keys sans la permission Clés et webhooks" "$T/list-api-keys.tool.ts" "accessPolicy: API_KEY_READ_ACCESS_POLICY," "accessPolicy: { ...API_KEY_READ_ACCESS_POLICY, requiredPermissionFlags: [] },"
saboter "fils de mails ouverts à tout principal" "$T/get-record-email-threads.tool.ts" "accessPolicy: VERIDIAN_MCP_SESSION_ONLY_POLICY," "accessPolicy: { ...VERIDIAN_MCP_SESSION_ONLY_POLICY, authPrincipals: { ...VERIDIAN_MCP_SESSION_ONLY_POLICY.authPrincipals, apiKey: true } },"
saboter "agenda ouvert à tout principal" "$T/get-record-calendar-events.tool.ts" "accessPolicy: VERIDIAN_MCP_SESSION_ONLY_POLICY," "accessPolicy: { ...VERIDIAN_MCP_SESSION_ONLY_POLICY, authPrincipals: { ...VERIDIAN_MCP_SESSION_ONLY_POLICY.authPrincipals, apiKey: true } },"
saboter "partage de fiche ouvert aux clés d'API (outil)" "$T/get-record-sharing.tool.ts" "accessPolicy: VERIDIAN_MCP_RECORD_SHARING_POLICY," "accessPolicy: { ...VERIDIAN_MCP_RECORD_SHARING_POLICY, authPrincipals: { ...VERIDIAN_MCP_RECORD_SHARING_POLICY.authPrincipals, apiKey: true } },"

# Contexte de l'appelant
saboter "fils de mails d'une fiche illisible" "$T/get-record-email-threads.tool.ts" "return failure(RECORD_NOT_READABLE);" ""
saboter "agenda d'une fiche illisible" "$T/get-record-calendar-events.tool.ts" "return failure(RECORD_NOT_READABLE);" ""
saboter "fiche lue sans le contexte de l'appelant" "$T/../is-record-readable.util.ts" "    authContext,
  );" "  );"
saboter "fils de mails sans jeton de membre" "$T/get-record-email-threads.tool.ts" "if (userWorkspaceId === undefined) {" "if (false) {"
saboter "agenda sans jeton de membre" "$T/get-record-calendar-events.tool.ts" "if (userWorkspaceId === undefined) {" "if (false) {"
saboter "comptes connectés sans jeton de membre" "$T/list-connected-accounts.tool.ts" "if (userWorkspaceId === undefined) {" "if (false) {"
saboter "synchro sans jeton de membre" "$T/get-sync-status.tool.ts" "if (userWorkspaceId === undefined) {" "if (false) {"
saboter "relance sans jeton de membre" "$T/retry-channel-sync.tool.ts" "if (userWorkspaceId === undefined) {" "if (false) {"
saboter "partage lu sans contexte de membre" "$T/get-record-sharing.tool.ts" "const authContext = findCallerUserAuthContext(context);" "const authContext = context.authContext as never;"
saboter "workflow lancé sans contexte de membre" "$T/run-workflow.tool.ts" "const authContext = findCallerUserAuthContext(context);" "const authContext = context.authContext as never;"
saboter "restauration sous un autre contexte d'authentification" "$T/restore-records.tool.ts" "const authContext = context.authContext;" "const authContext = { ...context.authContext, mutated: true } as typeof context.authContext;"
saboter "doublons sous un autre contexte d'authentification" "$T/find-duplicate-records.tool.ts" "const authContext = context.authContext;" "const authContext = { ...context.authContext, mutated: true } as typeof context.authContext;"
saboter "droits lus pour un autre contexte" "$T/get-my-permissions.tool.ts" "const roleIds = await permissionsService.getRoleIds(authContext);" "const roleIds = await permissionsService.getRoleIds(undefined as never);"

# Gardes propres aux outils
saboter "restauration sans droit de suppression" "$T/restore-records.tool.ts" "!(await permissionsService.canSoftDeleteSomeRecords({" "false && !(await permissionsService.canSoftDeleteSomeRecords({"
saboter "restauration d'un objet réservé à l'automatisation" "$T/restore-records.tool.ts" "!canObjectBeManagedByAutomation({" "false && !canObjectBeManagedByAutomation({"
saboter "doublons sans droit de lecture" "$T/find-duplicate-records.tool.ts" "!(await permissionsService.canReadSomeRecords({" "false && !(await permissionsService.canReadSomeRecords({"
saboter "doublons : ids et data acceptés ensemble" "$T/find-duplicate-records.tool.ts" "if ((ids === undefined) === (data === undefined)) {" "if (false) {"
saboter "relance sans propriété du compte" "$T/retry-channel-sync.tool.ts" "verifyUsableByCaller" "findByIdOrThrow"
saboter "relance sans plafond d'une par minute" "$T/retry-channel-sync.tool.ts" "last !== undefined &&" "false &&"
saboter "workflow : version non active lancée" "$T/run-workflow.tool.ts" "version.status !== WorkflowVersionStatus.ACTIVE" "false"
saboter "workflow : accès au workflow privé non vérifié" "$T/run-workflow.tool.ts" "await accessService.assertCoreWorkflowVersionsAreAccessibleOrThrow(" "await Promise.resolve("
saboter "workflow : charge utile démesurée acceptée" "$T/run-workflow.tool.ts" "> VERIDIAN_MCP_MAX_PAYLOAD_CHARACTERS" "> 1e12"

# Plafonds
saboter "plafond de lignes à 1000" "$L" "VERIDIAN_MCP_MAX_ROWS = 100;" "VERIDIAN_MCP_MAX_ROWS = 1000;"
saboter "plafond de fiches de doublons à 1000" "$L" "VERIDIAN_MCP_MAX_DUPLICATES_PER_SOURCE = 10;" "VERIDIAN_MCP_MAX_DUPLICATES_PER_SOURCE = 1000;"
saboter "plafond de pages d'historique à 1000" "$L" "VERIDIAN_MCP_MAX_TIMELINE_PAGE_SIZE = 50;" "VERIDIAN_MCP_MAX_TIMELINE_PAGE_SIZE = 1000;"
saboter "comptes connectés sans découpe" "$T/list-connected-accounts.tool.ts" ".slice(offset, offset + limit)" ".slice(offset)"
saboter "recherche : objets illisibles pas écartés" "$T/search-records.tool.ts" "flatObjectMetadatas: readable," "flatObjectMetadatas: filtered,"
saboter "recherche : lisibilité jugée sans le rôle de l'appelant" "$T/search-records.tool.ts" "        authContext,
      });" "        authContext: undefined as never,
      });"
saboter "réglages : nombre de membres perdu" "$T/get-workspace-settings.tool.ts" "workspaceMembersCount: await" "ignore: await"
saboter "recherche sans découpe" "$T/search-records.tool.ts" "edges.slice(0, limit)" "edges"
saboter "restauration sans plafond de 100" "$T/restore-records.tool.ts" ".max(VERIDIAN_MCP_MAX_ROWS)" ".max(100000)"

# Projections : un champ sensible de plus
saboter "jeton d'accès dans les comptes connectés" "$T/list-connected-accounts.tool.ts" "name: account.name," "name: account.name, accessToken: (account as unknown as { accessToken: string }).accessToken,"
saboter "hash d'invitation dans les réglages" "$T/get-workspace-settings.tool.ts" "createdAt: workspace.createdAt," "createdAt: workspace.createdAt, inviteHash: workspace.inviteHash,"
saboter "valeur de la clé dans la liste des clés" "$T/list-api-keys.tool.ts" "name: key.name," "name: key.name, key: (key as unknown as { key: string }).key,"
saboter "curseur de synchro dans les dossiers" "$T/get-sync-status.tool.ts" "isSentFolder: folder.isSentFolder," "isSentFolder: folder.isSentFolder, syncCursor: (folder as unknown as { syncCursor: string }).syncCursor,"

# Annotations
saboter "run_workflow non destructeur" "$A" "['run_workflow', 'api_supprimer']," "['api_supprimer'],"
saboter "search_records non déclaré en lecture seule" "$A" "  'search_records'," "  'search_records_x',"
saboter "annotations : crochet du registre retiré" "$U" "findVeridianMcpToolAnnotations(executionRef.toolId)" "undefined"

saboter "un outil d'écriture dans la liste de lecture" "$A" "  'list_roles'," "  'list_roles',
  'update_role',"
saboter "list_webhooks déclaré en lecture seule" "$A" "  'list_roles'," "  'list_roles',
  'list_webhooks',"

echo "$detectes sabotages détectés sur $total"
[ "$rate" -eq 0 ] && { echo "CONFORME"; exit 0; }
exit 1
