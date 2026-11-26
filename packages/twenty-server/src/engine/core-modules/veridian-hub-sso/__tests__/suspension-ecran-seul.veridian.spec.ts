import {
  SUSPENDED_WORKSPACE_OPEN_HANDLERS,
  isClosedWhenSuspended,
} from 'src/engine/core-modules/veridian-hub-sso/constants/suspended-workspace-handlers.constant';

// Veridian (26/11/2026, parente) : pendant une suspension, seul ce qu'il faut à l'écran « suspendu » répond (sortie,
// jetons, domaine public, contenu statique, ses propres sessions). L'identité et les définitions d'écran sont refusées.
describe('Veridian : un espace suspendu ne livre que son écran', () => {
  it.each([
    ['UserResolver', 'currentUser'],
    ['MinimalMetadataResolver', 'minimalMetadata'],
    ['ObjectMetadataResolver', 'objects'],
    ['ViewResolver', 'getViews'],
    ['PageLayoutResolver', 'getPageLayouts'],
    ['NavigationMenuItemResolver', 'navigationMenuItems'],
    ['CommandMenuItemResolver', 'commandMenuItems'],
  ])('%s.%s est refusé', (classe, methode) => {
    expect(isClosedWhenSuspended(classe, methode)).toBe(true);
  });

  it("n'ouvre que la liste attendue, rien de plus", () => {
    expect([...SUSPENDED_WORKSPACE_OPEN_HANDLERS].sort()).toEqual(
      [
        'AuthResolver.getAuthTokensFromLoginToken',
        'AuthResolver.getAuthTokensFromSSOExchangeToken',
        'AuthResolver.renewToken',
        'AuthResolver.signOut',
        'FrontComponentSharedDependenciesController.*',
        'ImpersonationResolver.stopImpersonation',
        'SdkClientController.*',
        'UserSessionResolver.*',
        'WorkspaceResolver.getPublicWorkspaceDataByDomain',
      ].sort(),
    );
  });

  it('laisse ouverte la sortie de session (témoin)', () => {
    expect(isClosedWhenSuspended('AuthResolver', 'signOut')).toBe(false);
  });
});
