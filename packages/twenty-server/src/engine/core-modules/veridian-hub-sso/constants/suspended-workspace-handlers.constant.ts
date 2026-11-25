// Veridian, suspension d'un espace (CONTRAT-HUB §5.4, 24/11/2026).
// Les gestionnaires amont marqués @AllowSuspendedWorkspace restent ceux de l'amont. Notre garde
// (ClosedWhenSuspendedGuard) lit cette liste : un gestionnaire fermé est refusé même décoré.
// Clé : NomDeClasse.methode, ou NomDeClasse.* pour un contrôleur ou un résolveur entier.
// La spec suspension-classement.veridian.spec.ts échoue si un décorateur amont n'est classé ni ici ni là.

// Refusés pour un espace suspendu : données, écritures, accès, exécution d'app.
export const SUSPENDED_WORKSPACE_CLOSED_HANDLERS: ReadonlySet<string> = new Set(
  [
    // Mail et agenda : canaux et comptes connectés (données personnelles, synchronisations)
    'MessageChannelResolver.myMessageChannels',
    'ConnectedAccountResolver.myConnectedAccounts',
    'CalendarChannelResolver.myCalendarChannels',
    // Apps et composants d'app qui s'exécutent ou se servent
    'FrontComponentController.*',
    'FrontComponentResolver.frontComponents',
    'LogicFunctionResolver.findManyLogicFunctions',
    'ApplicationInstallResolver.findManyApplications',
    // Invitations, suppression, comptes et 2FA
    'WorkspaceInvitationResolver.sendInvitations',
    'UserResolver.deleteUser',
    'UserResolver.deleteUserFromWorkspace',
    'UserResolver.updateWorkspaceMemberSettings',
    'WorkspaceResolver.deleteCurrentWorkspace',
    'TwoFactorAuthenticationResolver.initiateOTPProvisioning',
    'EmailVerificationResolver.*',
    'OnboardingResolver.*',
    'BillingResolver.*',
    // Flux d'événements et analytique
    'EventStreamResolver.*',
    'EventLogEmitterResolver.trackAnalytics',
    // Création et réinitialisation de comptes, connexions par identifiants : le Hub seul identifie
    'AuthResolver.getAuthorizationUrlForSSO',
    'AuthResolver.getLoginTokenFromCredentials',
    'AuthResolver.signIn',
    'AuthResolver.verifyEmailAndGetLoginToken',
    'AuthResolver.verifyEmailAndGetWorkspaceAgnosticToken',
    'AuthResolver.getAuthTokensFromOTP',
    'AuthResolver.getAuthTokensFromTwoFactorAuthenticationRecoveryCode',
    'AuthResolver.signUp',
    'AuthResolver.signUpInWorkspace',
    'AuthResolver.signUpInNewWorkspace',
    'AuthResolver.uploadNewWorkspaceLogo',
    'AuthResolver.createNewWorkspaceLogoUpload',
    'AuthResolver.completeNewWorkspaceLogoUpload',
    'AuthResolver.emailPasswordResetLink',
    'AuthResolver.updatePasswordViaResetToken',
  ],
);

// Restent ouverts pour un espace suspendu : définitions d'écran, session, sortie, contenu statique.
export const SUSPENDED_WORKSPACE_OPEN_HANDLERS: ReadonlySet<string> = new Set([
  'MinimalMetadataResolver.minimalMetadata',
  'UserResolver.currentUser',
  'ObjectMetadataResolver.objects',
  'ViewResolver.getViews',
  'PageLayoutResolver.getPageLayouts',
  'NavigationMenuItemResolver.navigationMenuItems',
  'CommandMenuItemResolver.commandMenuItems',
  'WorkspaceResolver.getPublicWorkspaceDataByDomain',
  'UserSessionResolver.*',
  'SdkClientController.*',
  'FrontComponentSharedDependenciesController.*',
  'ImpersonationResolver.stopImpersonation',
  'AuthResolver.getAuthTokensFromLoginToken',
  'AuthResolver.getAuthTokensFromSSOExchangeToken',
  'AuthResolver.renewToken',
  'AuthResolver.signOut',
]);

export const isClosedWhenSuspended = (
  className: string,
  handlerName: string,
): boolean =>
  SUSPENDED_WORKSPACE_CLOSED_HANDLERS.has(`${className}.${handlerName}`) ||
  SUSPENDED_WORKSPACE_CLOSED_HANDLERS.has(`${className}.*`);
