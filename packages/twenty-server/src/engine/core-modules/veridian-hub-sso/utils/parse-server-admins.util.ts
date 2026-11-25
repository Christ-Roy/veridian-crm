import { isUuid } from 'src/engine/core-modules/veridian-hub-sso/utils/parse-hub-organisations.util';

// Null when the list is absent or holds anything else than an identity: nobody is then granted nor stripped.
export const parseServerAdmins = (
  list: string | undefined,
): ReadonlySet<string> | null => {
  const ids = (list ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id.length > 0);

  return ids.length > 0 && ids.every(isUuid) ? new Set(ids) : null;
};
