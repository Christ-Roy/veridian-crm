import { ToolCategory } from 'twenty-shared/ai';

import { DefineTool } from 'src/engine/core-modules/tool-provider/decorators/define-tool.decorator';
import { BaseTool } from 'src/engine/core-modules/tool-provider/interfaces/base-tool.interface';
import { type ToolExecuteArgs } from 'src/engine/core-modules/tool-provider/types/tool-execute-args.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { VeridianApiRunnerService } from 'src/engine/core-modules/veridian-mcp-api/api-runner.service';
import { apiToolInputSchema } from 'src/engine/core-modules/veridian-mcp-api/api-tool-input-schema.constant';
import { VERIDIAN_MCP_API_POLICY } from 'src/engine/core-modules/veridian-mcp-api/veridian-mcp-api-policy.constant';

// Veridian (VER-253, Robert 24/11/2026: the MCP must not do less than the CLI).
@DefineTool({
  name: 'api_lire',
  category: ToolCategory.ACTION,
  accessPolicy: VERIDIAN_MCP_API_POLICY,
  description:
    'Read records with one GraphQL query on the workspace objects (people, companies, custom objects...): findMany, findOne, groupBy, duplicates, relations included. Same rights as the member on screen. No fragments, no introspection: use get_object_metadata for names. Prefer find_many_* for a simple list.',
})
export class ApiLireTool extends BaseTool<typeof apiToolInputSchema> {
  readonly inputSchema = apiToolInputSchema;

  constructor(private readonly runner: VeridianApiRunnerService) {
    super();
  }

  async execute({
    input: { query, variables },
    context,
  }: ToolExecuteArgs<typeof apiToolInputSchema>): Promise<ToolOutput> {
    return this.runner.run({ kind: 'lire', query, variables, context });
  }
}
