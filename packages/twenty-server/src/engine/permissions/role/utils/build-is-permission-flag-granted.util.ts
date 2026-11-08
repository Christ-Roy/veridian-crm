import {
  type PermissionFlagType,
  SystemPermissionFlag,
} from 'twenty-shared/constants';

import { isPermissionFlagDisabledByVeridian } from 'src/engine/core-modules/veridian-ai/is-permission-flag-disabled-by-veridian.util';
import { type FlatRole } from 'src/engine/metadata-modules/flat-role/types/flat-role.type';
import { hasRoleWideAccessToPermissionFlag } from 'src/engine/permissions/role/utils/has-role-wide-access-to-permission-flag.util';

export const buildIsPermissionFlagGranted = ({
  role,
  permissionFlagUniversalIdentifiers,
}: {
  role: Pick<FlatRole, 'canUpdateAllSettings' | 'canAccessAllTools'>;
  permissionFlagUniversalIdentifiers: Iterable<string>;
}): ((permissionFlag: PermissionFlagType) => boolean) => {
  const grantedPermissionFlagUniversalIdentifiers = new Set(
    permissionFlagUniversalIdentifiers,
  );

  return (permissionFlag) =>
    !isPermissionFlagDisabledByVeridian(permissionFlag) &&
    (hasRoleWideAccessToPermissionFlag({ role, permissionFlag }) ||
      grantedPermissionFlagUniversalIdentifiers.has(
        SystemPermissionFlag[permissionFlag],
      ));
};
