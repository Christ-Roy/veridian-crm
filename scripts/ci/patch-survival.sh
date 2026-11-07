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

# Un workflow invalide échoue sans job ni message utile : on le voit ici, avant le push.
if python3 -c "import yaml" 2>/dev/null; then
  python3 -c "import sys,yaml; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.y*ml 2>/dev/null \
    || { echo "WORKFLOW INVALIDE : .github/workflows"; echec=1; }
fi

if [ "${1:-}" = "--statique" ]; then
  exit "$echec"
fi

cd packages/twenty-server || exit 2
npx jest --config jest.config.mjs --testPathPattern '\.veridian\.spec\.ts$' --passWithNoTests=false
code=$?
[ "$code" -eq 0 ] || echec=1
exit "$echec"
