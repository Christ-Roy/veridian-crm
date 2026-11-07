import { ForbiddenException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

import {
  HubOnlyIdentityGuard,
  MUTATIONS_RESERVED_TO_HUB,
} from 'src/engine/core-modules/veridian-hub-sso/guards/hub-only-identity.guard';

const contextFor = (parent: string, fieldName: string, args: object = {}) => {
  const execution = { getType: () => 'graphql' };

  jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({
    getInfo: () => ({ parentType: { name: parent }, fieldName }),
    getArgs: () => args,
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
      'getLoginTokenFromCredentials',
      'sendInvitations',
      'updateUserEmail',
      'deleteUser',
      'deleteUserFromWorkspace',
      'deleteCurrentWorkspace',
      'initiateOTPProvisioning',
      'initiateOTPProvisioningForAuthenticatedUser',
      'verifyTwoFactorAuthenticationMethodForAuthenticatedUser',
      'deleteTwoFactorAuthenticationMethod',
      'generateTwoFactorAuthenticationRecoveryCode',
      'revokeTwoFactorAuthenticationRecoveryCode',
      'getAuthTokensFromOTP',
      'getAuthTokensFromTwoFactorAuthenticationRecoveryCode',
    ]) {
      expect(MUTATIONS_RESERVED_TO_HUB.has(mutation)).toBe(true);
    }
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
