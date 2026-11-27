import { ForbiddenException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

import {
  HubOnlyIdentityGuard,
  MUTATIONS_RESERVED_TO_HUB,
  TWO_FACTOR_MUTATIONS_FOR_INSTANCE_ADMINS,
} from 'src/engine/core-modules/veridian-hub-sso/guards/hub-only-identity.guard';

const contextFor = (
  parent: string,
  fieldName: string,
  args: object = {},
  user: object | undefined = undefined,
) => {
  const execution = { getType: () => 'graphql' };

  jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({
    getInfo: () => ({ parentType: { name: parent }, fieldName }),
    getArgs: () => args,
    getContext: () => ({ req: { user } }),
  } as never);

  return execution as never;
};

describe('HubOnlyIdentityGuard', () => {
  const guard = new HubOnlyIdentityGuard();

  it.each([...MUTATIONS_RESERVED_TO_HUB])('refuses %s', (mutation) => {
    expect(() => guard.canActivate(contextFor('Mutation', mutation))).toThrow(
      ForbiddenException,
    );
  });

  it('keeps every path that opens or creates an account closed', () => {
    for (const mutation of [
      'signUp',
      'signIn',
      'signUpInNewWorkspace',
      'signUpInWorkspace',
      'emailPasswordResetLink',
      'updatePasswordViaResetToken',
      'resendWorkspaceInvitation',
      'verifyEmailAndGetLoginToken',
      'verifyEmailAndGetWorkspaceAgnosticToken',
      'resendEmailVerificationToken',
      'getAuthTokensFromSSOExchangeToken',
      'createApprovedAccessDomain',
      'validateApprovedAccessDomain',
      'createOIDCIdentityProvider',
      'createSAMLIdentityProvider',
      'editSSOIdentityProvider',
      'getLoginTokenFromCredentials',
      'sendInvitations',
      'updateUserEmail',
      'deleteUser',
      'deleteUserFromWorkspace',
      'deleteCurrentWorkspace',
      'initiateOTPProvisioning',
    ]) {
      expect(MUTATIONS_RESERVED_TO_HUB.has(mutation)).toBe(true);
    }
  });

  // Robert, 27/11/2026 : l'emprunt natif exige une 2FA vérifiée chez l'administrateur d'instance, et chez lui seul.
  it.each([...TWO_FACTOR_MUTATIONS_FOR_INSTANCE_ADMINS])(
    '2FA %s : refusée à un membre ou sans session, ouverte à un administrateur d’instance',
    (mutation) => {
      expect(() =>
        guard.canActivate(contextFor('Mutation', mutation, {}, { canImpersonate: false })),
      ).toThrow(ForbiddenException);
      expect(() => guard.canActivate(contextFor('Mutation', mutation))).toThrow(
        ForbiddenException,
      );
      expect(
        guard.canActivate(contextFor('Mutation', mutation, {}, { canImpersonate: true })),
      ).toBe(true);
      expect(
        guard.canActivate(
          contextFor('Mutation', mutation, {}, { canAccessFullAdminPanel: true }),
        ),
      ).toBe(true);
    },
  );

  it('liste fermée des mutations 2FA ouvertes aux administrateurs', () => {
    expect([...TWO_FACTOR_MUTATIONS_FOR_INSTANCE_ADMINS].sort()).toEqual([
      'deleteTwoFactorAuthenticationMethod',
      'generateTwoFactorAuthenticationRecoveryCode',
      'initiateOTPProvisioningForAuthenticatedUser',
      'revokeTwoFactorAuthenticationRecoveryCode',
      'verifyTwoFactorAuthenticationMethodForAuthenticatedUser',
    ]);
  });

  it('la connexion par code ne sert qu’un compte qui a déjà une 2FA vérifiée : ouverte', () => {
    expect(guard.canActivate(contextFor('Mutation', 'getAuthTokensFromOTP'))).toBe(true);
    expect(
      guard.canActivate(
        contextFor('Mutation', 'getAuthTokensFromTwoFactorAuthenticationRecoveryCode'),
      ),
    ).toBe(true);
  });

  it('refuses a rename, lets other member settings through', () => {
    const rename = { input: { update: { name: { firstName: 'X' } } } };
    const theme = { input: { update: { colorScheme: 'Dark' } } };

    expect(() =>
      guard.canActivate(
        contextFor('Mutation', 'updateWorkspaceMemberSettings', rename),
      ),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(
        contextFor('Mutation', 'updateWorkspaceMemberSettings', theme),
      ),
    ).toBe(true);
  });

  // Liste écrite ici, pas lue dans la garde : retirer une entrée doit casser ce test.
  it.each([
    'editableProfileFields',
    'isPasswordAuthEnabled',
    'isPasswordAuthBypassEnabled',
    'isPublicInviteLinkEnabled',
    'isTwoFactorAuthenticationEnforced',
  ])(
    'refuses reopening %s, lets other workspace settings through',
    (setting) => {
      expect(() =>
        guard.canActivate(
          contextFor('Mutation', 'updateWorkspace', {
            data: { [setting]: true },
          }),
        ),
      ).toThrow(ForbiddenException);
      expect(
        guard.canActivate(
          contextFor('Mutation', 'updateWorkspace', {
            data: { displayName: 'Acme' },
          }),
        ),
      ).toBe(true);
    },
  );

  it('lets the login token exchange and queries through', () => {
    expect(
      guard.canActivate(contextFor('Mutation', 'getAuthTokensFromLoginToken')),
    ).toBe(true);
    expect(guard.canActivate(contextFor('Query', 'signIn'))).toBe(true);
  });

  it('ignores http requests', () => {
    expect(
      guard.canActivate({ getType: () => 'http' } as never),
    ).toBe(true);
  });
});
