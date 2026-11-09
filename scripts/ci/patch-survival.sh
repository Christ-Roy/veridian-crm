#!/usr/bin/env bash
# patch-survival.sh — échoue quand un patch Veridian disparaît (sync amont, erreur).
# Joue les *.veridian.spec du serveur, puis vérifie que le code garde ses coupures.
# Sortie : 0 patchs présents · 1 patch absent · 2 mesure non aboutie

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

SERVEUR=packages/twenty-server/src
echec=0

exige() {
  local fichier="$1" motif="$2"
  [ -f "$fichier" ] || { echo "NON ABOUTI : $fichier introuvable"; exit 2; }
  if ! grep -qF -- "$motif" "$fichier"; then
    echo "PATCH ABSENT : $fichier ne contient plus « $motif »"
    echec=1
  fi
}

exige "$SERVEUR/engine/core-modules/auth/constants/max-workspaces-without-organization-key.constant.ts" "Number.MAX_SAFE_INTEGER"
exige "$SERVEUR/engine/core-modules/auth/services/sign-in-up.service.ts" "if (!TWENTY_ICONS_BASE_URL)"
exige "$SERVEUR/modules/contact-creation-manager/services/create-company.service.ts" "if (!TWENTY_COMPANIES_BASE_URL)"
exige "$SERVEUR/engine/core-modules/tool/tools/search-help-center-tool/search-help-center-tool.ts" "HELP_CENTER_SEARCH_ENABLED"
exige "$SERVEUR/engine/core-modules/core-engine.module.ts" "VeridianHubSsoModule"
exige "$SERVEUR/engine/core-modules/core-engine.module.ts" "VeridianHubMcpModule"
exige "$SERVEUR/engine/core-modules/core-engine.module.ts" "VeridianPgModule"
exige "$SERVEUR/engine/core-modules/core-engine.module.ts" "VeridianIaModule"
exige packages/twenty-shared/src/types/SettingsPath.ts "VeridianIa = 'connect-ai'"
exige packages/twenty-front/src/modules/app/components/SettingsRoutes.tsx "path={SettingsPath.VeridianIa}"
exige packages/twenty-front/src/modules/settings/hooks/useSettingsNavigationItems.tsx "path: SettingsPath.VeridianIa"
exige packages/twenty-front/src/modules/navigation/components/MainNavigationDrawerScrollableItems.tsx "<VeridianIaNavigationItem />"
exige packages/twenty-front/src/modules/settings/mcp/components/SettingsMcpSetup.tsx "<VeridianIaSetup />"
exige "$SERVEUR/engine/api/mcp/constants/mcp-excluded-tool-names.constant.ts" ": ['search_help_center']),"
exige "$SERVEUR/engine/api/mcp/services/mcp-protocol.service.ts" "COMMON_PRELOAD_TOOLS.filter((name) => !MCP_EXCLUDED_TOOL_NAMES.has(name))"
exige "$SERVEUR/database/typeorm/core/core.datasource.ts" "...getVeridianPgPoolResilience()"
exige "$SERVEUR/engine/workspace-query-executor/services/workspace-query-executor.service.ts" "...getVeridianPgPoolResilience()"
exige "$SERVEUR/engine/core-modules/veridian-hub-mcp/veridian-hub-mcp.module.ts" "forRoutes({ path: ApiPath.Mcp"
exige packages/twenty-front/src/pages/auth/SignInUp.tsx "useRedirectToHubLogin();"
exige packages/twenty-front/src/modules/domain-manager/hooks/useRedirect.ts "createSingleNavigation"
exige packages/twenty-front/src/modules/ui/navigation/navigation-drawer/constants/DefaultWorkspaceLogo.ts "data:image/gif"
exige packages/twenty-front/src/modules/onboarding/constants/OnboardingNetworkPreviewPeople.ts "avatarUrl: ''"
exige packages/twenty-front/src/modules/auth/hooks/useAuth.ts "/welcome?logout=1"
# Le menu « Create Workspace » ne doit pas revenir : l'absence se garde par une présence (le commentaire du patch).
exige packages/twenty-front/src/modules/navigation/components/MultiWorkspaceDropdown/internal/MultiWorkspaceDropdownDefaultComponents.tsx "un workspace se crée au Hub seul"
if grep -q "create-new-workspace" packages/twenty-front/src/modules/navigation/components/MultiWorkspaceDropdown/internal/MultiWorkspaceDropdownDefaultComponents.tsx; then
  echo "PATCH ABSENT : le menu Create Workspace est revenu"; echec=1
fi
if grep -q "Invite user" packages/twenty-front/src/modules/navigation/components/MultiWorkspaceDropdown/internal/MultiWorkspaceDropdownDefaultComponents.tsx; then
  echo "PATCH ABSENT : le menu Invite user est revenu"; echec=1
fi
# Ce que seul le Hub décide ne s'offre pas dans l'interface.
refuse() {
  if grep -qF -- "$2" "$1"; then
    echo "PATCH ABSENT : $1 propose de nouveau « $2 »"; echec=1
  fi
}
refuse "$SERVEUR/engine/core-modules/frontend/frontend.service.ts" "Unable to load Twenty"
refuse packages/twenty-front/src/pages/settings/members/SettingsWorkspaceMembers.tsx "SettingsWorkspaceMembersInviteTab"
refuse packages/twenty-front/src/pages/settings/profile/SettingsProfile.tsx "<DeleteAccount"
refuse packages/twenty-front/src/pages/settings/profile/SettingsProfile.tsx "Two Factor Authentication"
refuse packages/twenty-front/src/modules/settings/security/components/SettingsSecurityAuthProvidersOptionsList.tsx "<TwoFactorAuthenticationSwitch"
refuse packages/twenty-front/src/modules/settings/members/components/MemberInfosTab.tsx "MemberTwoFactorAuthenticationRecoverySection"
refuse packages/twenty-front/src/pages/settings/general/SettingsGeneral.tsx "<DeleteWorkspace"
refuse packages/twenty-front/src/modules/settings/members/components/MemberInfosTab.tsx "Delete account"
refuse packages/twenty-front/src/modules/settings/security/components/SettingsSecurityAuthProvidersOptionsList.tsx "Invite by Link"
exige "$SERVEUR/engine/core-modules/getting-started/services/getting-started.service.ts" "stepActionKey !== GettingStartedStepActionKey.INVITE_TEAM"
exige packages/twenty-front/src/modules/settings/members/components/MemberNameFields.tsx "disabled"
exige "$SERVEUR/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service.ts" "editableProfileFields: ['profilePicture']"
exige packages/twenty-front/src/utils/i18n/dynamicActivate.ts "replaceBrandInMessages(messages)"
exige packages/twenty-front/index.html "<title>Veridian CRM</title>"
exige packages/twenty-front/public/manifest.json '"name": "Veridian CRM"'
exige packages/twenty-front/src/modules/navigation/components/SettingsNavigationDrawerContent.tsx "Basé sur Twenty, AGPL"
exige packages/twenty-front/src/modules/navigation/components/SettingsNavigationDrawerContent.tsx "github.com/Christ-Roy/veridian-crm-source"
exige "$SERVEUR/engine/core-modules/auth/auth.module.ts" "SignInUpService,
  ],"

# Aucun fournisseur IA : le drapeau AI se refuse aux deux points de calcul, l'interface n'offre que MCP.
exige "$SERVEUR/engine/permissions/role/utils/build-is-permission-flag-granted.util.ts" "!isPermissionFlagDisabledByVeridian(permissionFlag)"
exige "$SERVEUR/engine/metadata-modules/flat-role/utils/is-permission-flag-granted-to-flat-role.util.ts" "!isPermissionFlagDisabledByVeridian(permissionFlag)"
exige packages/twenty-front/src/pages/settings/ai/SettingsAI.tsx "getSettingsAiTabs(isInboxEnabled, canReadSystemPrompts)"
exige packages/twenty-front/src/modules/side-panel/pages/workflow/action/components/SidePanelWorkflowSelectAction.tsx "skip: !hasAiPermission"
refuse packages/twenty-front/src/modules/settings/mcp/utils/buildMcpSetupCategories.tsx "chatGptTwentyAppUrl"
exige packages/twenty-front/src/modules/settings/mcp/utils/buildMcpSetupCategories.tsx "chatgpt.com/#settings/Connectors"
for job in deploy/crm-staging.nomad.hcl deploy/crm-prod.nomad.hcl; do exige "$job" "VERIDIAN_AI_DISABLED=true"; done

# Le plan vient du Hub (CONTRAT-BILLING v2 §3) : la route existe et ne limite rien.
exige "$SERVEUR/engine/core-modules/veridian-hub-sso/controllers/veridian-hub-sso.controller.ts" "@Post('api/tenants/update-plan')"

# Menus morts retirés (parente, 08/11/2026) : e-mailing de Twenty, console sans ClickHouse, code client.
exige packages/twenty-front/src/modules/navigation-menu-item/common/utils/filterAndSortNavigationMenuItems.ts "VERIDIAN_HIDDEN_OBJECT_NAMES"
exige packages/twenty-front/src/modules/navigation-menu-item/display/folder/hooks/useNavigationMenuItemsByFolder.ts "itemsInFolder.length > 0 && sortedItems.length === 0"
exige packages/twenty-front/src/modules/log-console/hooks/useIsLogConsoleAllowed.ts "&& isClickHouseConfigured"
exige packages/twenty-front/src/modules/side-panel/pages/workflow/action/components/SidePanelWorkflowSelectAction.tsx "if (type === 'CODE')"
exige "$SERVEUR/modules/workflow/workflow-builder/workflow-version-step/workflow-version-step-operations.workspace-service.ts" "isWorkflowActionDisabledByVeridian(type)"
for job in deploy/crm-staging.nomad.hcl deploy/crm-prod.nomad.hcl; do exige "$job" "IS_CONFIG_VARIABLES_IN_DB_ENABLED=false"; done

# Un workflow invalide échoue sans job ni message utile : on le voit ici, avant le push.
if python3 -c "import yaml" 2>/dev/null; then
  python3 -c "import sys,yaml; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.y*ml 2>/dev/null \
    || { echo "WORKFLOW INVALIDE : .github/workflows"; echec=1; }
fi

if [ "${1:-}" = "--statique" ]; then
  exit "$echec"
fi

cd packages/twenty-server || exit 2
# Un seul processus : sur le runner, des workers jest tués par SIGBUS faisaient tomber la CI (09/11/2026, deux fois).
npx jest --config jest.config.mjs --runInBand --testPathPattern '\.veridian\.spec\.ts$' --passWithNoTests=false
code=$?
[ "$code" -eq 0 ] || echec=1
exit "$echec"
