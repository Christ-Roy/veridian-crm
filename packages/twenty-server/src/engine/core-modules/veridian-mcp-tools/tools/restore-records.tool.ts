import { ToolCategory } from 'twenty-shared/ai';
import { canObjectBeManagedByAutomation } from 'twenty-shared/workflow';
import { z } from 'zod';

import { CommonRestoreManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-restore-many-query-runner.service';
import { CommonApiContextBuilderService } from 'src/engine/core-modules/record-crud/services/common-api-context-builder.service';
import { DefineTool } from 'src/engine/core-modules/tool-provider/decorators/define-tool.decorator';
import { BaseTool } from 'src/engine/core-modules/tool-provider/interfaces/base-tool.interface';
import { type ToolExecuteArgs } from 'src/engine/core-modules/tool-provider/types/tool-execute-args.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { failure } from 'src/engine/core-modules/veridian-mcp-tools/caller.util';
import { NativeServices } from 'src/engine/core-modules/veridian-mcp-tools/native-services.service';
import { VERIDIAN_MCP_MAX_ROWS } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-limits.constant';
import { VERIDIAN_MCP_ALL_PRINCIPALS_POLICY } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-policies.constant';
import { PermissionsService } from 'src/engine/permissions/permissions.service';

const restoreRecordsInputSchema = z.object({
  objectNameSingular: z.string().describe('For example person or company'),
  ids: z
    .array(z.uuid())
    .min(1)
    .max(VERIDIAN_MCP_MAX_ROWS)
    .describe('Ids of the deleted records to bring back, 100 at most'),
});

// Veridian (Robert, 24/11/2026): restoreMany through the shared query runner, with its hooks and the role's soft-delete
// right, on the same objects delete_many_* can reach. Brings back what a delete_many_* took out.
@DefineTool({
  name: 'restore_records',
  category: ToolCategory.ACTION,
  accessPolicy: VERIDIAN_MCP_ALL_PRINCIPALS_POLICY,
  description:
    'Bring back records from the trash (soft-deleted), 100 at most per call. Undoes delete_many_*.',
})
export class RestoreRecordsTool extends BaseTool<
  typeof restoreRecordsInputSchema
> {
  readonly inputSchema = restoreRecordsInputSchema;

  constructor(private readonly native: NativeServices) {
    super();
  }

  async execute({
    input: { objectNameSingular, ids },
    context,
  }: ToolExecuteArgs<typeof restoreRecordsInputSchema>): Promise<ToolOutput> {
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

      if (
        !canObjectBeManagedByAutomation({
          nameSingular: flatObjectMetadata.nameSingular,
        })
      ) {
        return failure(
          `${objectNameSingular} cannot be restored by an assistant`,
        );
      }

      const permissionsService = this.native.get(PermissionsService);
      const principals =
        await permissionsService.buildPermissionsPrincipalsOrThrow({
          authContext,
        });

      if (
        !(await permissionsService.canSoftDeleteSomeRecords({
          principals,
          objectMetadataId: flatObjectMetadata.id,
        }))
      ) {
        return failure(`No delete access to ${objectNameSingular}`);
      }

      const { results } = await this.native
        .get(CommonRestoreManyQueryRunnerService)
        .execute(
          { filter: { id: { in: ids } }, selectedFields },
          queryRunnerContext,
        );

      return {
        success: true,
        message: `Restored ${results.length} ${objectNameSingular} record(s)`,
        result: results
          .slice(0, VERIDIAN_MCP_MAX_ROWS)
          .map((record) => ({ id: record.id })),
      };
    } catch (error) {
      return failure(`Could not restore ${objectNameSingular} records`, error);
    }
  }
}
