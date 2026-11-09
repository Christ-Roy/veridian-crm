import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApiPath } from 'twenty-shared/types';

import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { VeridianHubMcpAuthMiddleware } from 'src/engine/core-modules/veridian-hub-mcp/middlewares/veridian-hub-mcp-auth.middleware';
import { VeridianHubMcpAuthService } from 'src/engine/core-modules/veridian-hub-mcp/services/veridian-hub-mcp-auth.service';

// CONTRAT-MCP (veridian-hub/docs/CONTRAT-MCP.md): the Hub's single MCP gate reaches our /mcp
// with its own signed identity. Off unless VERIDIAN_HUB_MCP_ISSUER and _AUDIENCE are set.
@Module({
  imports: [
    TypeOrmModule.forFeature([KeyValuePairEntity, UserWorkspaceEntity]),
    TokenModule,
  ],
  providers: [VeridianHubMcpAuthService, VeridianHubMcpAuthMiddleware],
})
export class VeridianHubMcpModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(VeridianHubMcpAuthMiddleware)
      .forRoutes({ path: ApiPath.Mcp, method: RequestMethod.POST });
  }
}
