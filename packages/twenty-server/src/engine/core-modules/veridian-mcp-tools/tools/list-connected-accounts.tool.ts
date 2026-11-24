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
import { ConnectedAccountMetadataService } from 'src/engine/metadata-modules/connected-account/connected-account-metadata.service';
import { buildPublicConnectedAccount } from 'src/engine/metadata-modules/connected-account/utils/build-public-connected-account.util';

const listConnectedAccountsInputSchema = z.object({
  provider: z
    .string()
    .optional()
    .describe('Keep only this provider, for example google or microsoft'),
  limit: z.number().int().min(1).max(VERIDIAN_MCP_MAX_ROWS).default(50),
  offset: z.number().int().min(0).default(0),
});

// Veridian (Robert, 24/11/2026): myConnectedAccounts, whitelisted fields. Credentials and connection parameters never leave.
@DefineTool({
  name: 'list_connected_accounts',
  category: ToolCategory.METADATA,
  accessPolicy: VERIDIAN_MCP_ALL_PRINCIPALS_POLICY,
  description:
    'List the connected mail and calendar accounts the caller can use: address, provider, authentication status. Never returns credentials.',
})
export class ListConnectedAccountsTool extends BaseTool<
  typeof listConnectedAccountsInputSchema
> {
  readonly inputSchema = listConnectedAccountsInputSchema;

  constructor(private readonly native: NativeServices) {
    super();
  }

  async execute({
    input: { provider, limit, offset },
    context,
  }: ToolExecuteArgs<
    typeof listConnectedAccountsInputSchema
  >): Promise<ToolOutput> {
    const userWorkspaceId = findCallerUserWorkspaceId(context);

    if (userWorkspaceId === undefined) {
      return NO_USER_WORKSPACE;
    }

    try {
      const accounts = await this.native
        .get(ConnectedAccountMetadataService)
        .findUsableByCaller({
          userWorkspaceId,
          workspaceId: context.workspaceId,
        });

      const rows = accounts
        .map((account) => buildPublicConnectedAccount(account))
        .filter(
          (account) => provider === undefined || account.provider === provider,
        )
        .slice(offset, offset + limit)
        .map((account) => ({
          id: account.id,
          handle: account.handle,
          handleAliases: account.handleAliases,
          provider: account.provider,
          name: account.name,
          visibility: account.visibility,
          authFailedAt: account.authFailedAt,
          authFailedReason: account.authFailedReason,
          lastSignedInAt: account.lastSignedInAt,
          createdAt: account.createdAt,
        }));

      return {
        success: true,
        message: `Found ${rows.length} connected account(s)`,
        result: { accounts: rows },
      };
    } catch (error) {
      return failure('Could not list the connected accounts', error);
    }
  }
}
