import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CoreEntityCacheModule } from 'src/engine/core-entity-cache/core-entity-cache.module';
import { ApplicationInstallModule } from 'src/engine/core-modules/application/application-install/application-install.module';
import { ApplicationModule } from 'src/engine/core-modules/application/application.module';
import { MarketplaceModule } from 'src/engine/core-modules/application/application-marketplace/marketplace.module';
import { ApplicationRegistrationEntity } from 'src/engine/core-modules/application/application-registration/application-registration.entity';
import { VeridianCatalogueService } from 'src/engine/core-modules/veridian-apps/services/veridian-catalogue.service';
import { InstallAppTool } from 'src/engine/core-modules/veridian-apps/tools/install-app.tool';
import { ListAvailableAppsTool } from 'src/engine/core-modules/veridian-apps/tools/list-available-apps.tool';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

// The tool registry discovers @DefineTool providers of every module: nothing upstream is patched.
@Module({
  imports: [
    ApplicationInstallModule,
    ApplicationModule,
    MarketplaceModule,
    CoreEntityCacheModule,
    TypeOrmModule.forFeature([ApplicationRegistrationEntity, WorkspaceEntity]),
  ],
  providers: [ListAvailableAppsTool, InstallAppTool, VeridianCatalogueService],
})
export class VeridianAppsModule {}
