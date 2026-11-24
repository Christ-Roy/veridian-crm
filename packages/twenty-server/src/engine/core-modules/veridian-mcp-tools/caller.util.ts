import { isDefined } from 'twenty-shared/utils';

import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';

export const failure = (message: string, error?: unknown): ToolOutput => ({
  success: false,
  message,
  error:
    error === undefined
      ? message
      : error instanceof Error
        ? error.message
        : 'unknown',
});

// Native: AuthUserWorkspaceId() refuses a token that is not bound to a user workspace.
export const findCallerUserWorkspaceId = (
  context: ToolProviderContext,
): string | undefined => {
  if (isDefined(context.userWorkspaceId)) {
    return context.userWorkspaceId;
  }

  const authContext = context.authContext;

  return isDefined(authContext) && 'userWorkspaceId' in authContext
    ? authContext.userWorkspaceId
    : undefined;
};

export const NO_USER_WORKSPACE = failure(
  'This tool requires a token bound to a user workspace.',
);

export const findCallerUserAuthContext = (
  context: ToolProviderContext,
): UserWorkspaceAuthContext | undefined =>
  context.authContext?.type === 'user' ? context.authContext : undefined;

export const clampPage = (value: number, max: number): number =>
  Math.min(Math.max(Math.trunc(value), 1), max);
