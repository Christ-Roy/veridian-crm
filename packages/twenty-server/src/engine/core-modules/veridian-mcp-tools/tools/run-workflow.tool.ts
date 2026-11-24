import { ToolCategory } from 'twenty-shared/ai';
import { isDefined } from 'twenty-shared/utils';
import { z } from 'zod';

import { DefineTool } from 'src/engine/core-modules/tool-provider/decorators/define-tool.decorator';
import { BaseTool } from 'src/engine/core-modules/tool-provider/interfaces/base-tool.interface';
import { type ToolExecuteArgs } from 'src/engine/core-modules/tool-provider/types/tool-execute-args.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import {
  failure,
  findCallerUserAuthContext,
} from 'src/engine/core-modules/veridian-mcp-tools/caller.util';
import { NativeServices } from 'src/engine/core-modules/veridian-mcp-tools/native-services.service';
import { VERIDIAN_MCP_MAX_PAYLOAD_CHARACTERS } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-limits.constant';
import { VERIDIAN_MCP_RUN_WORKFLOW_POLICY } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-policies.constant';
import { WorkflowVersionStatus } from 'src/engine/core-modules/workflow/entities/workflow-version.entity';
import { CoreWorkflowAccessService } from 'src/engine/core-modules/workflow/services/core-workflow-access.service';
import { WorkflowVersionCoreSyncService } from 'src/engine/core-modules/workflow/services/workflow-version-core-sync.service';
import { CoreWorkflowRunnerService } from 'src/modules/workflow/workflow-runner/services/core-workflow-runner.service';
import { buildWorkflowRunTriggerContext } from 'src/modules/workflow/workflow-trigger/utils/build-workflow-run-trigger-context.util';

const runWorkflowInputSchema = z.object({
  workflowVersionId: z
    .uuid()
    .describe(
      'Id of the ACTIVE version of the workflow (see list_workflows, get_workflow_current_version)',
    ),
  payload: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Data given to the workflow trigger'),
});

// Veridian (Robert, 24/11/2026): runCoreWorkflowVersion, same checks in the same order, active version only. The effect is
// the one of the workflow a person built (writes, emails, HTTP calls): not undoable by this tool.
@DefineTool({
  name: 'run_workflow',
  category: ToolCategory.WORKFLOW,
  accessPolicy: VERIDIAN_MCP_RUN_WORKFLOW_POLICY,
  description:
    'Run the active version of a workflow now. Executes every action of the workflow with its real effects and cannot be undone: confirm with the user first. Draft and deactivated versions are refused.',
})
export class RunWorkflowTool extends BaseTool<typeof runWorkflowInputSchema> {
  readonly inputSchema = runWorkflowInputSchema;

  constructor(private readonly native: NativeServices) {
    super();
  }

  async execute({
    input: { workflowVersionId, payload },
    context,
  }: ToolExecuteArgs<typeof runWorkflowInputSchema>): Promise<ToolOutput> {
    const authContext = findCallerUserAuthContext(context);

    if (authContext === undefined) {
      return failure('User authentication required');
    }

    if (
      isDefined(payload) &&
      JSON.stringify(payload).length > VERIDIAN_MCP_MAX_PAYLOAD_CHARACTERS
    ) {
      return failure('Payload too large');
    }

    const { workspaceId } = context;

    try {
      const version = await this.native
        .get(WorkflowVersionCoreSyncService)
        .findCoreVersionById(workspaceId, workflowVersionId);

      if (
        !isDefined(version) ||
        version.status !== WorkflowVersionStatus.ACTIVE
      ) {
        return failure('Only the active version of a workflow can be run');
      }

      const accessService = this.native.get(CoreWorkflowAccessService);

      await accessService.assertCoreWorkflowVersionsAreAccessibleOrThrow({
        workspaceId,
        userWorkspaceId: authContext.userWorkspaceId,
        coreWorkflowVersionIds: [workflowVersionId],
      });

      await accessService.assertCoreWorkflowVersionsAreStartableByApplicationOrThrow(
        {
          workspaceId,
          workspaceCustomApplicationId:
            authContext.workspace.workspaceCustomApplicationId,
          callerApplication: authContext.application ?? undefined,
          coreWorkflowVersionIds: [workflowVersionId],
        },
      );

      const { payload: triggerPayload, createdBy } =
        buildWorkflowRunTriggerContext({
          workspaceMember: authContext.workspaceMember,
          payload,
        });

      const { workflowRunId } = await this.native
        .get(CoreWorkflowRunnerService)
        .run({
          workspaceId,
          coreWorkflowVersionId: workflowVersionId,
          payload: triggerPayload,
          source: createdBy,
        });

      return {
        success: true,
        message: 'Workflow started',
        result: { workflowRunId },
      };
    } catch (error) {
      return failure('Could not run the workflow', error);
    }
  }
}
