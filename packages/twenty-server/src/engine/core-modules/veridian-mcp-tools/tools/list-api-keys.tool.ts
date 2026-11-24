import { ToolCategory } from 'twenty-shared/ai';
import { z } from 'zod';

import { API_KEY_READ_ACCESS_POLICY } from 'src/engine/core-modules/api-key/constants/api-key-read-access-policy.constant';
import { ApiKeyRoleService } from 'src/engine/core-modules/api-key/services/api-key-role.service';
import { ApiKeyService } from 'src/engine/core-modules/api-key/services/api-key.service';
import { DefineTool } from 'src/engine/core-modules/tool-provider/decorators/define-tool.decorator';
import { BaseTool } from 'src/engine/core-modules/tool-provider/interfaces/base-tool.interface';
import { type ToolExecuteArgs } from 'src/engine/core-modules/tool-provider/types/tool-execute-args.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { failure } from 'src/engine/core-modules/veridian-mcp-tools/caller.util';
import { NativeServices } from 'src/engine/core-modules/veridian-mcp-tools/native-services.service';
import { VERIDIAN_MCP_MAX_ROWS } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-limits.constant';

const listApiKeysInputSchema = z.object({
  limit: z.number().int().min(1).max(VERIDIAN_MCP_MAX_ROWS).default(50),
  offset: z.number().int().min(0).default(0),
});

// Veridian (Robert, 24/11/2026): the apiKeys query under its own native policy. Name, role and dates only: a key's token
// is shown once at creation and no field of the entity carries it.
@DefineTool({
  name: 'list_api_keys',
  category: ToolCategory.METADATA,
  accessPolicy: API_KEY_READ_ACCESS_POLICY,
  description:
    'List the active API keys of this workspace with their role and expiry. Audit of who has durable access. Never returns a key value.',
})
export class ListApiKeysTool extends BaseTool<typeof listApiKeysInputSchema> {
  readonly inputSchema = listApiKeysInputSchema;

  constructor(private readonly native: NativeServices) {
    super();
  }

  async execute({
    input: { limit, offset },
    context: { workspaceId },
  }: ToolExecuteArgs<typeof listApiKeysInputSchema>): Promise<ToolOutput> {
    try {
      const keys = await this.native
        .get(ApiKeyService)
        .findActiveByWorkspaceId(workspaceId);
      const roleService = this.native.get(ApiKeyRoleService);

      const rows = await Promise.all(
        keys.slice(offset, offset + limit).map(async (key) => {
          const role = await roleService
            .getRoleDtoByApiKeyId({ apiKeyId: key.id, workspaceId })
            .catch(() => null);

          return {
            id: key.id,
            name: key.name,
            expiresAt: key.expiresAt,
            createdAt: key.createdAt,
            role: role === null ? null : { id: role.id, label: role.label },
          };
        }),
      );

      return {
        success: true,
        message: `Found ${rows.length} of ${keys.length} active API key(s)`,
        result: { apiKeys: rows, total: keys.length },
      };
    } catch (error) {
      return failure('Could not list the API keys', error);
    }
  }
}
