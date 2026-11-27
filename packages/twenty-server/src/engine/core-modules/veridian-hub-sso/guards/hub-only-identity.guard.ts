import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

// Identity belongs to the Hub: these mutations would let an account be created, opened
// or renamed without it. Applied to every Nest resolver, whatever the transport.
export const MUTATIONS_RESERVED_TO_HUB = new Set([
  'signUp',
  'signUpInWorkspace',
  'signUpInNewWorkspace',
  'signIn',
  'getLoginTokenFromCredentials',
  'emailPasswordResetLink',
  'updatePasswordViaResetToken',
  'sendInvitations',
  'resendWorkspaceInvitation',
  // VER-245: closed by construction, not by the absence of an invitation, a provider or a key.
  'verifyEmailAndGetLoginToken',
  'verifyEmailAndGetWorkspaceAgnosticToken',
  'resendEmailVerificationToken',
  'getAuthTokensFromSSOExchangeToken',
  'createApprovedAccessDomain',
  'validateApprovedAccessDomain',
  'createOIDCIdentityProvider',
  'createSAMLIdentityProvider',
  'editSSOIdentityProvider',
  'updateUserEmail',
  'deleteUser',
  'deleteUserFromWorkspace',
  'deleteCurrentWorkspace',
  // Two-factor authentication lives on the Hub, except for instance admins (below).
  'initiateOTPProvisioning',
]);

// Robert (27/11/2026): native impersonation across workspaces needs a verified 2FA on the impersonator. Instance admins,
// and only them, set up their own native 2FA. Signing in with a code only concerns an account that already has one.
export const TWO_FACTOR_MUTATIONS_FOR_INSTANCE_ADMINS = new Set([
  'initiateOTPProvisioningForAuthenticatedUser',
  'verifyTwoFactorAuthenticationMethodForAuthenticatedUser',
  'deleteTwoFactorAuthenticationMethod',
  'generateTwoFactorAuthenticationRecoveryCode',
  'revokeTwoFactorAuthenticationRecoveryCode',
]);

const isInstanceAdmin = (user: unknown): boolean => {
  const flags = user as
    | { canImpersonate?: boolean; canAccessFullAdminPanel?: boolean }
    | undefined;

  return flags?.canImpersonate === true || flags?.canAccessFullAdminPanel === true;
};

// A workspace admin must not reopen what provisioning closed.
export const WORKSPACE_SETTINGS_RESERVED_TO_HUB = [
  'editableProfileFields',
  'isPasswordAuthEnabled',
  'isPasswordAuthBypassEnabled',
  'isPublicInviteLinkEnabled',
  'isTwoFactorAuthenticationEnforced',
];

@Injectable()
export class HubOnlyIdentityGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType<string>() !== 'graphql') {
      return true;
    }

    const gqlContext = GqlExecutionContext.create(context);
    const info = gqlContext.getInfo();

    if (info?.parentType?.name !== 'Mutation') {
      return true;
    }

    const isRenaming =
      info.fieldName === 'updateWorkspaceMemberSettings' &&
      gqlContext.getArgs()?.input?.update?.name !== undefined;

    const isReopening =
      info.fieldName === 'updateWorkspace' &&
      WORKSPACE_SETTINGS_RESERVED_TO_HUB.some(
        (setting) => gqlContext.getArgs()?.data?.[setting] !== undefined,
      );

    const isTwoFactorForOthers =
      TWO_FACTOR_MUTATIONS_FOR_INSTANCE_ADMINS.has(info.fieldName) &&
      !isInstanceAdmin(gqlContext.getContext()?.req?.user);

    if (
      MUTATIONS_RESERVED_TO_HUB.has(info.fieldName) ||
      isTwoFactorForOthers ||
      isRenaming ||
      isReopening
    ) {
      throw new ForbiddenException(
        'Identity is managed by Veridian Hub, this operation is not available here',
      );
    }

    return true;
  }
}
