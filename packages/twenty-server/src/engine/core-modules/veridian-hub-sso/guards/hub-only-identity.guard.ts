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
  'updateUserEmail',
  'deleteUser',
  'deleteUserFromWorkspace',
  'deleteCurrentWorkspace',
  // Two-factor authentication lives on the Hub alone.
  'initiateOTPProvisioning',
  'initiateOTPProvisioningForAuthenticatedUser',
  'verifyTwoFactorAuthenticationMethodForAuthenticatedUser',
  'deleteTwoFactorAuthenticationMethod',
  'generateTwoFactorAuthenticationRecoveryCode',
  'revokeTwoFactorAuthenticationRecoveryCode',
  'getAuthTokensFromOTP',
  'getAuthTokensFromTwoFactorAuthenticationRecoveryCode',
]);

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

    if (
      MUTATIONS_RESERVED_TO_HUB.has(info.fieldName) ||
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
