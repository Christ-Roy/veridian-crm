import { ToolCategory } from 'twenty-shared/ai';
import { z } from 'zod';

import { TIMELINE_THREADS_DEFAULT_PAGE_SIZE } from 'src/engine/core-modules/messaging/constants/messaging.constants';
import { GetMessagesService } from 'src/engine/core-modules/messaging/services/get-messages.service';
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
import { VERIDIAN_MCP_MAX_TIMELINE_PAGE_SIZE } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-limits.constant';
import { VERIDIAN_MCP_SESSION_ONLY_POLICY } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-policies.constant';

const getRecordEmailThreadsInputSchema = z.object({
  objectNameSingular: z
    .string()
    .describe('Object of the record, for example person, company, opportunity'),
  recordId: z.uuid(),
  page: z.number().int().min(1).default(1),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(VERIDIAN_MCP_MAX_TIMELINE_PAGE_SIZE)
    .default(TIMELINE_THREADS_DEFAULT_PAGE_SIZE),
});

// Veridian (Robert, 24/11/2026): the Emails tab of a record. Native service: each mailbox visibility is applied by it.
@DefineTool({
  name: 'get_record_email_threads',
  category: ToolCategory.METADATA,
  accessPolicy: VERIDIAN_MCP_SESSION_ONLY_POLICY,
  description:
    'List the email threads linked to a record (person, company, opportunity...), like the Emails tab. Shows what the caller sees on screen, mailbox visibility included.',
})
export class GetRecordEmailThreadsTool extends BaseTool<
  typeof getRecordEmailThreadsInputSchema
> {
  readonly inputSchema = getRecordEmailThreadsInputSchema;

  constructor(private readonly native: NativeServices) {
    super();
  }

  async execute({
    input: { objectNameSingular, recordId, page, pageSize },
    context,
  }: ToolExecuteArgs<
    typeof getRecordEmailThreadsInputSchema
  >): Promise<ToolOutput> {
    const userWorkspaceId = findCallerUserWorkspaceId(context);

    if (userWorkspaceId === undefined) {
      return NO_USER_WORKSPACE;
    }

    try {
      const threads = await this.native
        .get(GetMessagesService)
        .getMessagesFromObjectRecord({
          userWorkspaceId,
          objectNameSingular,
          recordId,
          workspaceId: context.workspaceId,
          page,
          pageSize,
        });

      return {
        success: true,
        message: `Found ${threads.timelineThreads.length} thread(s) of ${threads.totalNumberOfThreads}`,
        result: {
          ...threads,
          timelineThreads: threads.timelineThreads.slice(0, pageSize),
        },
      };
    } catch (error) {
      return failure('Could not read the email threads', error);
    }
  }
}
