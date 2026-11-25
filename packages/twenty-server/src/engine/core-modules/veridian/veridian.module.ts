import { Module } from '@nestjs/common';

import { VeridianDelegationModule } from 'src/engine/core-modules/veridian-delegation/veridian-delegation.module';
import { VeridianHubMcpModule } from 'src/engine/core-modules/veridian-hub-mcp/veridian-hub-mcp.module';
import { VeridianHubSsoModule } from 'src/engine/core-modules/veridian-hub-sso/veridian-hub-sso.module';
import { VeridianIaModule } from 'src/engine/core-modules/veridian-ia/veridian-ia.module';
import { VeridianPgModule } from 'src/engine/core-modules/veridian-pg/veridian-pg.module';

@Module({
  imports: [
    VeridianHubSsoModule,
    VeridianHubMcpModule,
    VeridianPgModule,
    VeridianIaModule,
    VeridianDelegationModule,
  ],
})
export class VeridianModule {}
