import { ToolCategory } from 'twenty-shared/ai';
import { z } from 'zod';

import { DefineTool } from 'src/engine/core-modules/tool-provider/decorators/define-tool.decorator';
import { BaseTool } from 'src/engine/core-modules/tool-provider/interfaces/base-tool.interface';
import { type ToolExecuteArgs } from 'src/engine/core-modules/tool-provider/types/tool-execute-args.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { failure } from 'src/engine/core-modules/veridian-mcp-tools/caller.util';
import { NativeServices } from 'src/engine/core-modules/veridian-mcp-tools/native-services.service';
import { VERIDIAN_MCP_ALL_PRINCIPALS_POLICY } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-policies.constant';

const getWorkspaceSettingsInputSchema = z.object({});

// Veridian (Robert, 24/11/2026): currentWorkspace, whitelisted fields. Invite hash, auth settings, AI settings and
// everything else of the workspace row stay out.
@DefineTool({
  name: 'get_workspace_settings',
  category: ToolCategory.METADATA,
  accessPolicy: VERIDIAN_MCP_ALL_PRINCIPALS_POLICY,
  description:
    'Read the general settings of this workspace: name, subdomain, custom domain, status, trash retention, member count.',
})
export class GetWorkspaceSettingsTool extends BaseTool<
  typeof getWorkspaceSettingsInputSchema
> {
  readonly inputSchema = getWorkspaceSettingsInputSchema;

  constructor(private readonly native: NativeServices) {
    super();
  }

  async execute({
    context: { workspaceId },
  }: ToolExecuteArgs<
    typeof getWorkspaceSettingsInputSchema
  >): Promise<ToolOutput> {
    try {
      const workspace = await this.native
        .get(WorkspaceService)
        .findOneWorkspaceById(workspaceId);

      if (!workspace) {
        return failure('Workspace not found');
      }

      return {
        success: true,
        message: 'Workspace settings',
        result: {
          id: workspace.id,
          displayName: workspace.displayName,
          subdomain: workspace.subdomain,
          customDomain: workspace.customDomain,
          isCustomDomainEnabled: workspace.isCustomDomainEnabled,
          activationStatus: workspace.activationStatus,
          trashRetentionDays: workspace.trashRetentionDays,
          workspaceMembersCount: await this.native
            .get(UserWorkspaceService)
            .getUserCount(workspaceId),
          createdAt: workspace.createdAt,
        },
      };
    } catch (error) {
      return failure('Could not read the workspace settings', error);
    }
  }
}
