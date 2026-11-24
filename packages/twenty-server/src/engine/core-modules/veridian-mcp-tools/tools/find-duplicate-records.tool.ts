import { ToolCategory } from 'twenty-shared/ai';
import { z } from 'zod';

import { CommonFindDuplicatesQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-find-duplicates-query-runner.service';
import { CommonApiContextBuilderService } from 'src/engine/core-modules/record-crud/services/common-api-context-builder.service';
import { DefineTool } from 'src/engine/core-modules/tool-provider/decorators/define-tool.decorator';
import { BaseTool } from 'src/engine/core-modules/tool-provider/interfaces/base-tool.interface';
import { type ToolExecuteArgs } from 'src/engine/core-modules/tool-provider/types/tool-execute-args.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { failure } from 'src/engine/core-modules/veridian-mcp-tools/caller.util';
import { NativeServices } from 'src/engine/core-modules/veridian-mcp-tools/native-services.service';
import {
  VERIDIAN_MCP_MAX_DUPLICATE_SOURCES,
  VERIDIAN_MCP_MAX_DUPLICATES_PER_SOURCE,
} from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-limits.constant';
import { VERIDIAN_MCP_ALL_PRINCIPALS_POLICY } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-policies.constant';
import { PermissionsService } from 'src/engine/permissions/permissions.service';

const findDuplicateRecordsInputSchema = z.object({
  objectNameSingular: z.string().describe('For example person or company'),
  ids: z
    .array(z.uuid())
    .min(1)
    .max(VERIDIAN_MCP_MAX_DUPLICATE_SOURCES)
    .optional()
    .describe('Existing records to find the duplicates of'),
  data: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(VERIDIAN_MCP_MAX_DUPLICATE_SOURCES)
    .optional()
    .describe('Or values of a record that is about to be created'),
});

// Veridian (Robert, 24/11/2026): findDuplicates through the shared query runner, which applies the role's read rights.
@DefineTool({
  name: 'find_duplicate_records',
  category: ToolCategory.METADATA,
  accessPolicy: VERIDIAN_MCP_ALL_PRINCIPALS_POLICY,
  description:
    'Find the records that look like duplicates of given records (ids) or of values about to be created (data). Pass ids or data, not both. Merge with merge_many_*.',
})
export class FindDuplicateRecordsTool extends BaseTool<
  typeof findDuplicateRecordsInputSchema
> {
  readonly inputSchema = findDuplicateRecordsInputSchema;

  constructor(private readonly native: NativeServices) {
    super();
  }

  async execute({
    input: { objectNameSingular, ids, data },
    context,
  }: ToolExecuteArgs<
    typeof findDuplicateRecordsInputSchema
  >): Promise<ToolOutput> {
    if ((ids === undefined) === (data === undefined)) {
      return failure('Pass either ids or data');
    }

    const authContext = context.authContext;

    if (authContext === undefined || authContext.type === 'system') {
      return failure('No authentication context');
    }

    try {
      const { queryRunnerContext, selectedFields, flatObjectMetadata } =
        await this.native.get(CommonApiContextBuilderService).build({
          authContext,
          objectName: objectNameSingular,
        });

      const permissionsService = this.native.get(PermissionsService);
      const principals =
        await permissionsService.buildPermissionsPrincipalsOrThrow({
          authContext,
        });

      if (
        !(await permissionsService.canReadSomeRecords({
          principals,
          objectMetadataId: flatObjectMetadata.id,
        }))
      ) {
        return failure(`No read access to ${objectNameSingular}`);
      }

      const { results } = await this.native
        .get(CommonFindDuplicatesQueryRunnerService)
        .execute({ ids, data, selectedFields }, queryRunnerContext);

      const groups = results
        .slice(0, VERIDIAN_MCP_MAX_DUPLICATE_SOURCES)
        .map((group) => ({
          totalCount: group.totalCount,
          records: group.records.slice(
            0,
            VERIDIAN_MCP_MAX_DUPLICATES_PER_SOURCE,
          ),
        }));

      return {
        success: true,
        message: `Checked ${groups.length} record(s) for duplicates`,
        result: { groups },
      };
    } catch (error) {
      return failure(
        `Could not search duplicates of ${objectNameSingular}`,
        error,
      );
    }
  }
}
