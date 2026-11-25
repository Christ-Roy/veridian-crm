import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';

import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { isClosedWhenSuspended } from 'src/engine/core-modules/veridian-hub-sso/constants/suspended-workspace-handlers.constant';
import { isWorkspaceSuspended } from 'src/engine/core-modules/workspace/utils/is-workspace-suspended.util';
import { getRequest } from 'src/utils/extract-request';

// Adds to the native WorkspaceNotSuspendedGuard: closes handlers that Twenty leaves open
// to a suspended workspace (CONTRAT-HUB §5.4).
@Injectable()
export class ClosedWhenSuspendedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (
      !isWorkspaceSuspended(getRequest(context)?.workspace) ||
      !isClosedWhenSuspended(context.getClass().name, context.getHandler().name)
    ) {
      return true;
    }

    throw new AuthException(
      'Workspace is suspended',
      AuthExceptionCode.WORKSPACE_SUSPENDED,
    );
  }
}
