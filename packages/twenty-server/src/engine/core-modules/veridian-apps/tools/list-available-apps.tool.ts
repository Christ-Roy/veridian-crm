import { ToolCategory } from 'twenty-shared/ai';
import { z } from 'zod';

import { MarketplaceQueryService } from 'src/engine/core-modules/application/application-marketplace/marketplace-query.service';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { DefineTool } from 'src/engine/core-modules/tool-provider/decorators/define-tool.decorator';
import { BaseTool } from 'src/engine/core-modules/tool-provider/interfaces/base-tool.interface';
import { type ToolExecuteArgs } from 'src/engine/core-modules/tool-provider/types/tool-execute-args.type';
import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';
import { VERIDIAN_APPS_ACCESS_POLICY } from 'src/engine/core-modules/veridian-apps/veridian-apps-access-policy.constant';

const listAvailableAppsInputSchema = z.object({});

// Veridian (Robert, 24/11/2026): what Settings > Applications shows, for an assistant acting with the member's role.
@DefineTool({
  name: 'list_available_apps',
  category: ToolCategory.METADATA,
  accessPolicy: VERIDIAN_APPS_ACCESS_POLICY,
  description:
    'List the apps that can be installed in this workspace, with the installed version when there is one. Use universalIdentifier with install_app.',
})
export class ListAvailableAppsTool extends BaseTool<
  typeof listAvailableAppsInputSchema
> {
  readonly inputSchema = listAvailableAppsInputSchema;

  constructor(
    private readonly marketplaceQueryService: MarketplaceQueryService,
    private readonly applicationService: ApplicationService,
  ) {
    super();
  }

  async execute({
    context: { workspaceId },
  }: ToolExecuteArgs<typeof listAvailableAppsInputSchema>): Promise<ToolOutput> {
    const [catalog, installed] = await Promise.all([
      this.marketplaceQueryService.findManyMarketplaceApps({ isListed: true }),
      this.applicationService.findManyApplications(workspaceId),
    ]);

    const apps = catalog.map(({ id, name, description }) => ({
      universalIdentifier: id,
      name,
      description,
      installedVersion:
        installed.find(({ universalIdentifier }) => universalIdentifier === id)
          ?.version ?? null,
    }));

    return {
      success: true,
      message: `Found ${apps.length} available app(s)`,
      result: { apps },
    };
  }
}
