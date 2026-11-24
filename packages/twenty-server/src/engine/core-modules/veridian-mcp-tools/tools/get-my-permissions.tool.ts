import { ToolCategory } from 'twenty-shared/ai';
import { PermissionFlagType } from 'twenty-shared/constants';
import { z } from 'zod';

import { DefineTool } from 'src/engine/core-modules/tool-provider/decorators/define-tool.decorator';
import { BaseTool } from 'src/engine/core-modules/tool-provider/interfaces/base-tool.interface';
import { type ToolExecuteArgs } from 'src/engine/core-modules/tool-provider/types/tool-execute-args.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { failure } from 'src/engine/core-modules/veridian-mcp-tools/caller.util';
import { NativeServices } from 'src/engine/core-modules/veridian-mcp-tools/native-services.service';
import { VERIDIAN_MCP_ALL_PRINCIPALS_POLICY } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-policies.constant';
import { PermissionsService } from 'src/engine/permissions/permissions.service';

const getMyPermissionsInputSchema = z.object({});

// Veridian (Robert, 24/11/2026): the caller reads its own settings permissions, so it does not try what will be refused.
// No native resolver is its twin: the answer is the same check every guarded operation runs, for the caller only.
@DefineTool({
  name: 'get_my_permissions',
  category: ToolCategory.METADATA,
  accessPolicy: VERIDIAN_MCP_ALL_PRINCIPALS_POLICY,
  description:
    'List the role ids and the settings permissions (which of the settings flags are granted) of the caller. Object and field access is read with find_many_* and list_roles.',
})
export class GetMyPermissionsTool extends BaseTool<
  typeof getMyPermissionsInputSchema
> {
  readonly inputSchema = getMyPermissionsInputSchema;

  constructor(private readonly native: NativeServices) {
    super();
  }

  async execute({
    context: { authContext },
  }: ToolExecuteArgs<typeof getMyPermissionsInputSchema>): Promise<ToolOutput> {
    if (authContext === undefined) {
      return failure('No authentication context');
    }

    try {
      const permissionsService = this.native.get(PermissionsService);
      const roleIds = await permissionsService.getRoleIds(authContext);
      const permissionFlags: Record<string, boolean> = {};

      for (const setting of Object.values(PermissionFlagType)) {
        permissionFlags[setting] = await permissionsService.hasPermissionFlag({
          authContext,
          setting,
        });
      }

      return {
        success: true,
        message: 'Permissions of the caller',
        result: { principal: authContext.type, roleIds, permissionFlags },
      };
    } catch (error) {
      return failure('Could not read permissions', error);
    }
  }
}
