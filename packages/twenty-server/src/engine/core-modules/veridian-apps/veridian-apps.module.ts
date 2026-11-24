import { Module } from '@nestjs/common';

import { ApplicationInstallModule } from 'src/engine/core-modules/application/application-install/application-install.module';
import { ApplicationModule } from 'src/engine/core-modules/application/application.module';
import { MarketplaceModule } from 'src/engine/core-modules/application/application-marketplace/marketplace.module';
import { InstallAppTool } from 'src/engine/core-modules/veridian-apps/tools/install-app.tool';
import { ListAvailableAppsTool } from 'src/engine/core-modules/veridian-apps/tools/list-available-apps.tool';

// The tool registry discovers @DefineTool providers of every module: nothing upstream is patched.
@Module({
  imports: [ApplicationInstallModule, ApplicationModule, MarketplaceModule],
  providers: [ListAvailableAppsTool, InstallAppTool],
})
export class VeridianAppsModule {}
