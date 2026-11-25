import { type AccessPolicy } from 'src/engine/guards/types/access-policy.type';

// Stricter than the native GraphQL endpoint on purpose: a member's session, or an OAuth client acting for a member. Keys
// and apps keep /graphql and /rest.
export const VERIDIAN_MCP_API_POLICY: AccessPolicy = {
  authPrincipals: {
    userSession: {
      standard: true,
      impersonated: true,
      playground: true,
      workspaceAgnostic: false,
    },
    apiKey: false,
    oauthClient: { withUser: true, withoutUser: false },
    application: false,
  },
  requiredPermissionFlags: [],
};
