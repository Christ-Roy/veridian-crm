import { ToolCategory } from 'twenty-shared/ai';
import { z } from 'zod';

import { TIMELINE_CALENDAR_EVENTS_DEFAULT_PAGE_SIZE } from 'src/engine/core-modules/calendar/constants/calendar.constants';
import { TimelineCalendarEventService } from 'src/engine/core-modules/calendar/timeline-calendar-event.service';
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

const getRecordCalendarEventsInputSchema = z.object({
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
    .default(TIMELINE_CALENDAR_EVENTS_DEFAULT_PAGE_SIZE),
});

// Veridian (Robert, 24/11/2026): the Calendar tab of a record. Native service: calendar visibility is applied by it.
@DefineTool({
  name: 'get_record_calendar_events',
  category: ToolCategory.METADATA,
  accessPolicy: VERIDIAN_MCP_SESSION_ONLY_POLICY,
  description:
    'List the calendar events linked to a record (person, company, opportunity...), like the Calendar tab. Shows what the caller sees on screen, calendar visibility included.',
})
export class GetRecordCalendarEventsTool extends BaseTool<
  typeof getRecordCalendarEventsInputSchema
> {
  readonly inputSchema = getRecordCalendarEventsInputSchema;

  constructor(private readonly native: NativeServices) {
    super();
  }

  async execute({
    input: { objectNameSingular, recordId, page, pageSize },
    context,
  }: ToolExecuteArgs<
    typeof getRecordCalendarEventsInputSchema
  >): Promise<ToolOutput> {
    const userWorkspaceId = findCallerUserWorkspaceId(context);

    if (userWorkspaceId === undefined) {
      return NO_USER_WORKSPACE;
    }

    try {
      const events = await this.native
        .get(TimelineCalendarEventService)
        .getCalendarEventsFromObjectRecord({
          userWorkspaceId,
          objectNameSingular,
          recordId,
          workspaceId: context.workspaceId,
          page,
          pageSize,
        });

      return {
        success: true,
        message: `Found ${events.timelineCalendarEvents.length} event(s) of ${events.totalNumberOfCalendarEvents}`,
        result: {
          ...events,
          timelineCalendarEvents: events.timelineCalendarEvents.slice(
            0,
            pageSize,
          ),
        },
      };
    } catch (error) {
      return failure('Could not read the calendar events', error);
    }
  }
}
