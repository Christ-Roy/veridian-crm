import { PermissionFlagType } from 'twenty-shared/constants';

import { type AccessPolicy } from 'src/engine/guards/types/access-policy.type';

// Each policy below is the literal guard of the resolver named next to it, which does not export it. The spec compares
// them with the resolver source, so a drift upstream fails there. A native constant is imported, never copied.
const SESSION = {
  standard: true,
  impersonated: true,
  playground: true,
  workspaceAgnostic: false,
} as const;

// SearchResolver, ConnectedAccountResolver.myConnectedAccounts, MessageChannelResolver.myMessageChannels,
// CalendarChannelResolver, MessageFolderResolver, WorkspaceResolver.currentWorkspace, REST core controller
export const VERIDIAN_MCP_ALL_PRINCIPALS_POLICY: AccessPolicy = {
  authPrincipals: {
    userSession: { ...SESSION },
    apiKey: true,
    oauthClient: true,
    application: true,
  },
  requiredPermissionFlags: [],
};

// TimelineMessagingResolver (TIMELINE_MESSAGING_READ_ACCESS_POLICY), TimelineCalendarEventResolver
export const VERIDIAN_MCP_SESSION_ONLY_POLICY: AccessPolicy = {
  authPrincipals: {
    userSession: { ...SESSION },
    apiKey: false,
    oauthClient: false,
    application: false,
  },
  requiredPermissionFlags: [],
};

// ChannelSyncResolver
export const VERIDIAN_MCP_CHANNEL_SYNC_POLICY: AccessPolicy = {
  authPrincipals: {
    userSession: { ...SESSION },
    apiKey: true,
    oauthClient: true,
    application: true,
  },
  requiredPermissionFlags: [PermissionFlagType.CONNECTED_ACCOUNTS],
};

// RecordSharingResolver
export const VERIDIAN_MCP_RECORD_SHARING_POLICY: AccessPolicy = {
  authPrincipals: {
    userSession: { ...SESSION },
    apiKey: false,
    oauthClient: { withUser: true, withoutUser: false },
    application: { withUser: true, withoutUser: false },
  },
  requiredPermissionFlags: [],
};

// CoreWorkflowRunResolver.runCoreWorkflowVersion
export const VERIDIAN_MCP_RUN_WORKFLOW_POLICY: AccessPolicy = {
  authPrincipals: {
    userSession: { ...SESSION },
    apiKey: false,
    oauthClient: { withUser: true, withoutUser: false },
    application: { withUser: true, withoutUser: false },
  },
  requiredPermissionFlags: [PermissionFlagType.WORKFLOWS],
};
