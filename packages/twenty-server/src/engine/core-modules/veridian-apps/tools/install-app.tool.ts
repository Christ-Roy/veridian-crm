import { ToolCategory } from 'twenty-shared/ai';
import { z } from 'zod';

import { ApplicationLifecycleJobService } from 'src/engine/core-modules/application/application-install/services/application-lifecycle-job.service';
import { JobStateEnum } from 'src/engine/core-modules/message-queue/enums/job-state.enum';
import { DefineTool } from 'src/engine/core-modules/tool-provider/decorators/define-tool.decorator';
import { BaseTool } from 'src/engine/core-modules/tool-provider/interfaces/base-tool.interface';
import { type ToolExecuteArgs } from 'src/engine/core-modules/tool-provider/types/tool-execute-args.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { VERIDIAN_APPS_ACCESS_POLICY } from 'src/engine/core-modules/veridian-apps/veridian-apps-access-policy.constant';

const POLL_MS = 1_500;
const POLLS = 30;

const installAppInputSchema = z.object({
  universalIdentifier: z
    .string()
    .uuid()
    .describe('App to install or update. Obtain it from list_available_apps.'),
});

// Veridian (Robert, 24/11/2026): the native installation job, with its own guards (VER-173, instance catalog). Accepting the
// job is not installing: only the job's end is an answer.
@DefineTool({
  name: 'install_app',
  category: ToolCategory.METADATA,
  accessPolicy: VERIDIAN_APPS_ACCESS_POLICY,
  description:
    'Install an app in this workspace, or update it to its latest version. Ask the user first. Uninstalling stays in Settings > Applications.',
})
export class InstallAppTool extends BaseTool<typeof installAppInputSchema> {
  readonly inputSchema = installAppInputSchema;

  constructor(
    private readonly applicationLifecycleJobService: ApplicationLifecycleJobService,
  ) {
    super();
  }

  async execute({
    input: { universalIdentifier },
    context: { workspaceId },
  }: ToolExecuteArgs<typeof installAppInputSchema>): Promise<ToolOutput> {
    let jobId: string;

    try {
      ({ jobId } =
        await this.applicationLifecycleJobService.triggerInstallApplication({
          universalIdentifier,
          workspaceId,
        }));
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : 'unknown');
    }

    for (let poll = 0; poll < POLLS; poll++) {
      const status =
        await this.applicationLifecycleJobService.findInstallApplicationJobStatus(
          { universalIdentifier, workspaceId, jobId },
        );

      if (status?.state === JobStateEnum.COMPLETED) {
        return { success: true, message: 'App installed', result: { jobId } };
      }

      if (status?.state === JobStateEnum.FAILED) {
        return this.failure(status.failedReason ?? 'unknown');
      }

      await this.wait();
    }

    return {
      success: true,
      message:
        'Installation still running: check with list_available_apps in a minute',
      result: { jobId, pending: true },
    };
  }

  protected wait(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  private failure(error: string): ToolOutput {
    if (/is already installed in this workspace/.test(error)) {
      return { success: true, message: 'App already installed' };
    }

    return { success: false, message: 'App not installed', error };
  }
}
