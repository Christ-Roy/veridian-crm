import { PermissionFlagType } from 'twenty-shared/constants';

import { type AccessPolicy } from 'src/engine/guards/types/access-policy.type';

// Same gate as the Applications settings page (APPLICATION_INSTALL_WRITE_ACCESS_POLICY, not exported upstream): the
// member's own role decides, and an app never installs another app.
export const VERIDIAN_APPS_ACCESS_POLICY: AccessPolicy = {
  authPrincipals: {
    userSession: {
      standard: true,
      impersonated: true,
      playground: true,
      workspaceAgnostic: false,
    },
    apiKey: true,
    oauthClient: true,
    application: false,
  },
  requiredPermissionFlags: [PermissionFlagType.APPLICATIONS],
};
