import { type EntityManager } from 'typeorm';

import {
  PermissionsException,
  PermissionsExceptionCode,
} from 'src/engine/permissions/permissions.exception';

export const HUB_ROLE_CARRIED_KEY = 'veridian.hub_role_carried';

// CONTRAT-HUB §5.22 (24/11/2026): once the Hub carries the roles of a workspace, no human changes one here.
export const assertRoleNotCarriedByHub = async (
  manager: Pick<EntityManager, 'query'>,
  workspaceId: string,
): Promise<void> => {
  const carried = await manager.query(
    `SELECT 1 FROM core."keyValuePair" WHERE key = $1 AND "workspaceId" = $2 AND "userId" IS NULL LIMIT 1`,
    [HUB_ROLE_CARRIED_KEY, workspaceId],
  );

  if (carried.length > 0) {
    throw new PermissionsException(
      'Roles are managed by Veridian Hub, change them there',
      PermissionsExceptionCode.PERMISSION_DENIED,
      {
        userFriendlyMessage: {
          id: 'veridian.roleCarriedByHub',
          message:
            'Les rôles se gèrent dans votre Hub Veridian, page de votre organisation.',
        },
      },
    );
  }
};
