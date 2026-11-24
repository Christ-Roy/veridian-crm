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
import { VERIDIAN_MCP_MAX_ROWS } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-limits.constant';
import { VERIDIAN_MCP_RECORD_SHARING_POLICY } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-policies.constant';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { buildObjectIdByNameMaps } from 'src/engine/metadata-modules/flat-object-metadata/utils/build-object-id-by-name-maps.util';
import { RecordSharingService } from 'src/engine/permissions/record-share/services/record-sharing.service';

const getRecordSharingInputSchema = z.object({
  objectNameSingular: z.string().describe('For example person or company'),
  recordId: z.uuid(),
});

// Veridian (Robert, 24/11/2026): the recordSharing query, which answers "not found" to a caller that cannot read the record.
@DefineTool({
  name: 'get_record_sharing',
  category: ToolCategory.METADATA,
  accessPolicy: VERIDIAN_MCP_RECORD_SHARING_POLICY,
  description:
    'Show who can see a record and how it is shared (private, shared with members or roles). Change shares with share_record.',
})
export class GetRecordSharingTool extends BaseTool<
  typeof getRecordSharingInputSchema
> {
  readonly inputSchema = getRecordSharingInputSchema;

  constructor(private readonly native: NativeServices) {
    super();
  }

  async execute({
    input: { objectNameSingular, recordId },
    context,
  }: ToolExecuteArgs<typeof getRecordSharingInputSchema>): Promise<ToolOutput> {
    const authContext = findCallerUserAuthContext(context);

    if (authContext === undefined) {
      return failure('User authentication required');
    }

    try {
      const { flatObjectMetadataMaps } = await this.native
        .get(WorkspaceManyOrAllFlatEntityMapsCacheService)
        .getOrRecomputeManyOrAllFlatEntityMaps({
          workspaceId: context.workspaceId,
          flatMapsKeys: ['flatObjectMetadataMaps'],
        });
      const objectMetadataId = buildObjectIdByNameMaps(flatObjectMetadataMaps)
        .idByNameSingular[objectNameSingular];

      if (!isDefined(objectMetadataId)) {
        return failure(`Object ${objectNameSingular} not found`);
      }

      const sharing = await this.native.get(RecordSharingService).getSharing({
        objectMetadataId,
        recordId,
        authContext,
      });

      return {
        success: true,
        message: sharing.isPrivate ? 'Record is private' : 'Record sharing',
        result: {
          ...sharing,
          roles: sharing.roles.slice(0, VERIDIAN_MCP_MAX_ROWS),
          shares: sharing.shares.slice(0, VERIDIAN_MCP_MAX_ROWS),
        },
      };
    } catch (error) {
      return failure('Could not read the record sharing', error);
    }
  }
}
