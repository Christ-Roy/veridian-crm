import { Module } from '@nestjs/common';

import { NativeServices } from 'src/engine/core-modules/veridian-mcp-tools/native-services.service';
import { FindDuplicateRecordsTool } from 'src/engine/core-modules/veridian-mcp-tools/tools/find-duplicate-records.tool';
import { GetMyPermissionsTool } from 'src/engine/core-modules/veridian-mcp-tools/tools/get-my-permissions.tool';
import { GetRecordCalendarEventsTool } from 'src/engine/core-modules/veridian-mcp-tools/tools/get-record-calendar-events.tool';
import { GetRecordEmailThreadsTool } from 'src/engine/core-modules/veridian-mcp-tools/tools/get-record-email-threads.tool';
import { GetRecordSharingTool } from 'src/engine/core-modules/veridian-mcp-tools/tools/get-record-sharing.tool';
import { GetSyncStatusTool } from 'src/engine/core-modules/veridian-mcp-tools/tools/get-sync-status.tool';
import { GetWorkspaceSettingsTool } from 'src/engine/core-modules/veridian-mcp-tools/tools/get-workspace-settings.tool';
import { ListApiKeysTool } from 'src/engine/core-modules/veridian-mcp-tools/tools/list-api-keys.tool';
import { ListConnectedAccountsTool } from 'src/engine/core-modules/veridian-mcp-tools/tools/list-connected-accounts.tool';
import { RestoreRecordsTool } from 'src/engine/core-modules/veridian-mcp-tools/tools/restore-records.tool';
import { RetryChannelSyncTool } from 'src/engine/core-modules/veridian-mcp-tools/tools/retry-channel-sync.tool';
import { RunWorkflowTool } from 'src/engine/core-modules/veridian-mcp-tools/tools/run-workflow.tool';
import { SearchRecordsTool } from 'src/engine/core-modules/veridian-mcp-tools/tools/search-records.tool';

// The tool registry discovers @DefineTool providers of every module: nothing upstream is patched for them. The native
// services are reached through NativeServices (the instances the resolvers use), so this module imports none.
@Module({
  providers: [
    NativeServices,
    SearchRecordsTool,
    GetMyPermissionsTool,
    GetRecordEmailThreadsTool,
    GetRecordCalendarEventsTool,
    ListConnectedAccountsTool,
    GetSyncStatusTool,
    FindDuplicateRecordsTool,
    GetWorkspaceSettingsTool,
    ListApiKeysTool,
    GetRecordSharingTool,
    RestoreRecordsTool,
    RetryChannelSyncTool,
    RunWorkflowTool,
  ],
})
export class VeridianMcpToolsModule {}
