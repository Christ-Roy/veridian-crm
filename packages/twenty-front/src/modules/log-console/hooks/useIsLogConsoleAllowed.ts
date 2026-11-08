import { isClickHouseConfiguredState } from '@/client-config/states/isClickHouseConfiguredState';
import { useHasPermissionFlag } from '@/settings/roles/hooks/useHasPermissionFlag';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useIsMobile } from 'twenty-ui/utilities';
import { PermissionFlagType } from '~/generated-metadata/graphql';

export const useIsLogConsoleAllowed = () => {
  const hasSecurityPermission = useHasPermissionFlag(
    PermissionFlagType.SECURITY,
  );
  const isMobile = useIsMobile();
  // Veridian: logs live in ClickHouse, which we do not run; without it the console only shows an error.
  const isClickHouseConfigured = useAtomStateValue(isClickHouseConfiguredState);

  return hasSecurityPermission && !isMobile && isClickHouseConfigured;
};
