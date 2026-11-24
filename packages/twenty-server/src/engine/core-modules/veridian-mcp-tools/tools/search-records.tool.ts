import { ToolCategory } from 'twenty-shared/ai';
import { isDefined } from 'twenty-shared/utils';
import { z } from 'zod';

import { SearchService } from 'src/engine/core-modules/search/services/search.service';
import { DefineTool } from 'src/engine/core-modules/tool-provider/decorators/define-tool.decorator';
import { BaseTool } from 'src/engine/core-modules/tool-provider/interfaces/base-tool.interface';
import { type ToolExecuteArgs } from 'src/engine/core-modules/tool-provider/types/tool-execute-args.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { failure } from 'src/engine/core-modules/veridian-mcp-tools/caller.util';
import { NativeServices } from 'src/engine/core-modules/veridian-mcp-tools/native-services.service';
import { VERIDIAN_MCP_MAX_ROWS } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-limits.constant';
import { VERIDIAN_MCP_ALL_PRINCIPALS_POLICY } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-policies.constant';
import { DataloaderService } from 'src/engine/dataloaders/dataloader.service';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { PermissionsService } from 'src/engine/permissions/permissions.service';

const searchRecordsInputSchema = z.object({
  query: z.string().min(1).max(200).describe('Text to look for'),
  objects: z
    .array(z.string())
    .max(50)
    .optional()
    .describe(
      'Restrict to these objects (nameSingular), all searchable ones when omitted',
    ),
  limit: z.number().int().min(1).max(VERIDIAN_MCP_MAX_ROWS).default(20),
  after: z.string().optional().describe('Cursor from a previous page'),
});

// Veridian (Robert, 24/11/2026): the search bar, for an assistant acting with the caller's role.
@DefineTool({
  name: 'search_records',
  category: ToolCategory.METADATA,
  accessPolicy: VERIDIAN_MCP_ALL_PRINCIPALS_POLICY,
  description:
    'Search across all objects by text, like the search bar. Returns record ids, labels and object names the caller can read. Use find_many_* for filters.',
})
export class SearchRecordsTool extends BaseTool<
  typeof searchRecordsInputSchema
> {
  readonly inputSchema = searchRecordsInputSchema;

  constructor(private readonly native: NativeServices) {
    super();
  }

  async execute({
    input: { query, objects, limit, after },
    context,
  }: ToolExecuteArgs<typeof searchRecordsInputSchema>): Promise<ToolOutput> {
    const { authContext } = context;

    if (!isDefined(authContext)) {
      return failure('No authentication context');
    }

    try {
      const permissionsService = this.native.get(PermissionsService);
      const principals = await permissionsService.buildPermissionsPrincipals({
        authContext,
      });

      if (!isDefined(principals)) {
        return failure('No role');
      }

      const searchService = this.native.get(SearchService);
      const { flatObjectMetadataMaps, flatFieldMetadataMaps } =
        await this.native
          .get(WorkspaceManyOrAllFlatEntityMapsCacheService)
          .getOrRecomputeManyOrAllFlatEntityMaps({
            workspaceId: context.workspaceId,
            flatMapsKeys: ['flatObjectMetadataMaps', 'flatFieldMetadataMaps'],
          });

      const flatObjectMetadatas = Object.values(
        flatObjectMetadataMaps.byUniversalIdentifier,
      ).filter(isDefined);

      const included = objects ?? [];
      const filtered = searchService.filterObjectMetadataItems({
        flatObjectMetadatas,
        includedObjectNameSingulars: included,
        excludedObjectNameSingulars: [],
      });

      // One unreadable object makes the native search throw: the search bar leaves those out, so does this tool.
      const readable: typeof filtered = [];

      for (const flatObjectMetadata of filtered) {
        if (
          await permissionsService.canReadSomeRecords({
            principals,
            objectMetadataId: flatObjectMetadata.id,
          })
        ) {
          readable.push(flatObjectMetadata);
        }
      }

      const records = await searchService.getAllRecordsWithObjectMetadataItems({
        flatObjectMetadatas: readable,
        flatFieldMetadataMaps,
        searchInput: query,
        limit,
        includedObjectNameSingulars: included,
        excludedObjectNameSingulars: [],
        after,
      });

      const { edges, pageInfo } =
        await searchService.computeSearchObjectResults({
          recordsWithObjectMetadataItems: records,
          flatFieldMetadataMaps,
          workspaceId: context.workspaceId,
          limit,
          after,
          loaders: this.native.get(DataloaderService).createLoaders(),
          locale: context.locale,
        });

      const rows = edges.slice(0, limit);

      return {
        success: true,
        message: `Found ${rows.length} record(s)`,
        result: { edges: rows, pageInfo },
      };
    } catch (error) {
      return failure('Search failed', error);
    }
  }
}
