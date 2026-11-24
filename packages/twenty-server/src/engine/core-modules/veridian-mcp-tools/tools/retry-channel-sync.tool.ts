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
import { VERIDIAN_MCP_RETRY_SYNC_INTERVAL_MS } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-limits.constant';
import { VERIDIAN_MCP_CHANNEL_SYNC_POLICY } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-policies.constant';
import { ConnectedAccountMetadataService } from 'src/engine/metadata-modules/connected-account/connected-account-metadata.service';
import { ChannelSyncService } from 'src/modules/connected-account/channel-sync/services/channel-sync.service';

const retryChannelSyncInputSchema = z.object({
  connectedAccountId: z.uuid().describe('Id from list_connected_accounts'),
});

// Veridian (Robert, 24/11/2026): startChannelSync, with the same ownership check, at most one call per account and minute
// (per server instance: a restart or a second instance forgets the last call).
@DefineTool({
  name: 'retry_channel_sync',
  category: ToolCategory.ACTION,
  accessPolicy: VERIDIAN_MCP_CHANNEL_SYNC_POLICY,
  description:
    'Restart the mail and calendar synchronisation of a connected account. Safe to repeat, limited to one call per account and per minute.',
})
export class RetryChannelSyncTool extends BaseTool<
  typeof retryChannelSyncInputSchema
> {
  readonly inputSchema = retryChannelSyncInputSchema;

  private readonly lastCallByAccount = new Map<string, number>();

  constructor(private readonly native: NativeServices) {
    super();
  }

  protected now(): number {
    return Date.now();
  }

  async execute({
    input: { connectedAccountId },
    context,
  }: ToolExecuteArgs<typeof retryChannelSyncInputSchema>): Promise<ToolOutput> {
    const userWorkspaceId = findCallerUserWorkspaceId(context);

    if (userWorkspaceId === undefined) {
      return NO_USER_WORKSPACE;
    }

    const { workspaceId } = context;
    const key = `${workspaceId}:${connectedAccountId}`;
    let stamped = false;

    try {
      await this.native
        .get(ConnectedAccountMetadataService)
        .verifyUsableByCaller({
          id: connectedAccountId,
          userWorkspaceId,
          workspaceId,
        });

      const now = this.now();
      const last = this.lastCallByAccount.get(key);

      if (
        last !== undefined &&
        now - last < VERIDIAN_MCP_RETRY_SYNC_INTERVAL_MS
      ) {
        return failure(
          'Synchronisation already restarted less than a minute ago',
        );
      }

      for (const [otherKey, at] of this.lastCallByAccount) {
        if (now - at >= VERIDIAN_MCP_RETRY_SYNC_INTERVAL_MS) {
          this.lastCallByAccount.delete(otherKey);
        }
      }

      this.lastCallByAccount.set(key, now);
      stamped = true;

      await this.native.get(ChannelSyncService).startChannelSync({
        connectedAccountId,
        workspaceId,
      });

      return {
        success: true,
        message: 'Synchronisation restarted',
        result: { connectedAccountId },
      };
    } catch (error) {
      if (stamped) {
        this.lastCallByAccount.delete(key);
      }

      return failure('Could not restart the synchronisation', error);
    }
  }
}
