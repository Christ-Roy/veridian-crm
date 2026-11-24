import { ToolCategory } from 'twenty-shared/ai';
import { z } from 'zod';

import { DefineTool } from 'src/engine/core-modules/tool-provider/decorators/define-tool.decorator';
import { BaseTool } from 'src/engine/core-modules/tool-provider/interfaces/base-tool.interface';
import { type ToolExecuteArgs } from 'src/engine/core-modules/tool-provider/types/tool-execute-args.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import {
  failure,
  findCallerUserWorkspaceId,
  NO_USER_WORKSPACE,
} from 'src/engine/core-modules/veridian-mcp-tools/caller.util';
import { NativeServices } from 'src/engine/core-modules/veridian-mcp-tools/native-services.service';
import { VERIDIAN_MCP_MAX_ROWS } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-limits.constant';
import { VERIDIAN_MCP_ALL_PRINCIPALS_POLICY } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-policies.constant';
import { CalendarChannelMetadataService } from 'src/engine/metadata-modules/calendar-channel/calendar-channel-metadata.service';
import { MessageChannelMetadataService } from 'src/engine/metadata-modules/message-channel/message-channel-metadata.service';
import { MessageFolderMetadataService } from 'src/engine/metadata-modules/message-folder/message-folder-metadata.service';

const getSyncStatusInputSchema = z.object({
  connectedAccountId: z
    .uuid()
    .optional()
    .describe('Only this connected account, all of the caller when omitted'),
});

// Veridian (Robert, 24/11/2026): myMessageChannels, myCalendarChannels and myMessageFolders, whitelisted fields.
// Cursors, workspace ids and contents never leave.
@DefineTool({
  name: 'get_sync_status',
  category: ToolCategory.METADATA,
  accessPolicy: VERIDIAN_MCP_ALL_PRINCIPALS_POLICY,
  description:
    'Show the synchronisation state of the mail and calendar channels of the caller: stage, status, last sync, throttling, followed folders. Never returns message or event content.',
})
export class GetSyncStatusTool extends BaseTool<
  typeof getSyncStatusInputSchema
> {
  readonly inputSchema = getSyncStatusInputSchema;

  constructor(private readonly native: NativeServices) {
    super();
  }

  async execute({
    input: { connectedAccountId },
    context,
  }: ToolExecuteArgs<typeof getSyncStatusInputSchema>): Promise<ToolOutput> {
    const userWorkspaceId = findCallerUserWorkspaceId(context);

    if (userWorkspaceId === undefined) {
      return NO_USER_WORKSPACE;
    }

    const { workspaceId } = context;

    try {
      const messageChannelService = this.native.get(
        MessageChannelMetadataService,
      );
      const calendarChannelService = this.native.get(
        CalendarChannelMetadataService,
      );
      const messageFolderService = this.native.get(
        MessageFolderMetadataService,
      );

      const messageChannels = connectedAccountId
        ? await messageChannelService.findByConnectedAccountIdForUser({
            connectedAccountId,
            userWorkspaceId,
            workspaceId,
          })
        : await messageChannelService.findByUserWorkspaceId({
            userWorkspaceId,
            workspaceId,
          });

      const calendarChannels = connectedAccountId
        ? await calendarChannelService.findByConnectedAccountIdForUser({
            connectedAccountId,
            userWorkspaceId,
            workspaceId,
          })
        : await calendarChannelService.findByUserWorkspaceId({
            userWorkspaceId,
            workspaceId,
          });

      const messageFolders = (
        await Promise.all(
          messageChannels.slice(0, VERIDIAN_MCP_MAX_ROWS).map((channel) =>
            messageFolderService.findByMessageChannelIdForUser({
              messageChannelId: channel.id,
              userWorkspaceId,
              workspaceId,
            }),
          ),
        )
      ).flat();

      return {
        success: true,
        message: `Found ${messageChannels.length} mail channel(s) and ${calendarChannels.length} calendar channel(s)`,
        result: {
          messageChannels: messageChannels
            .slice(0, VERIDIAN_MCP_MAX_ROWS)
            .map((channel) => ({
              id: channel.id,
              connectedAccountId: channel.connectedAccountId,
              handle: channel.handle,
              type: channel.type,
              visibility: channel.visibility,
              isSyncEnabled: channel.isSyncEnabled,
              syncStatus: channel.syncStatus,
              syncStage: channel.syncStage,
              syncStageStartedAt: channel.syncStageStartedAt,
              syncedAt: channel.syncedAt,
              throttleFailureCount: channel.throttleFailureCount,
              throttleRetryAfter: channel.throttleRetryAfter,
            })),
          calendarChannels: calendarChannels
            .slice(0, VERIDIAN_MCP_MAX_ROWS)
            .map((channel) => ({
              id: channel.id,
              connectedAccountId: channel.connectedAccountId,
              handle: channel.handle,
              visibility: channel.visibility,
              isSyncEnabled: channel.isSyncEnabled,
              syncStatus: channel.syncStatus,
              syncStage: channel.syncStage,
              syncStageStartedAt: channel.syncStageStartedAt,
              syncedAt: channel.syncedAt,
              throttleFailureCount: channel.throttleFailureCount,
            })),
          messageFolders: messageFolders
            .slice(0, VERIDIAN_MCP_MAX_ROWS)
            .map((folder) => ({
              id: folder.id,
              messageChannelId: folder.messageChannelId,
              name: folder.name,
              isSynced: folder.isSynced,
              isSentFolder: folder.isSentFolder,
            })),
        },
      };
    } catch (error) {
      return failure('Could not read the synchronisation state', error);
    }
  }
}
