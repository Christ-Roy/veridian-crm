import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CoreEntityCacheModule } from 'src/engine/core-entity-cache/core-entity-cache.module';
import { AuthModule } from 'src/engine/core-modules/auth/auth.module';
import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { WorkspaceDomainsModule } from 'src/engine/core-modules/domain/workspace-domains/workspace-domains.module';
import { KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { OnboardingModule } from 'src/engine/core-modules/onboarding/onboarding.module';
import { ThrottlerModule } from 'src/engine/core-modules/throttler/throttler.module';
import { UserSessionModule } from 'src/engine/core-modules/user-session/user-session.module';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserWorkspaceModule } from 'src/engine/core-modules/user-workspace/user-workspace.module';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { UserModule } from 'src/engine/core-modules/user/user.module';
import { VeridianHubSsoController } from 'src/engine/core-modules/veridian-hub-sso/controllers/veridian-hub-sso.controller';
import { HubOnlyIdentityGuard } from 'src/engine/core-modules/veridian-hub-sso/guards/hub-only-identity.guard';
import { WorkspaceMemberIdentityPreQueryHook } from 'src/engine/core-modules/veridian-hub-sso/query-hooks/workspace-member-identity.pre-query.hook';
import { VeridianHubSsoService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceModule } from 'src/engine/core-modules/workspace/workspace.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      UserWorkspaceEntity,
      WorkspaceEntity,
      KeyValuePairEntity,
    ]),
    AuthModule,
    TokenModule,
    WorkspaceDomainsModule,
    ThrottlerModule,
    WorkspaceModule,
    OnboardingModule,
    UserModule,
    UserSessionModule,
    UserWorkspaceModule,
    CoreEntityCacheModule,
  ],
  controllers: [VeridianHubSsoController],
  providers: [
    VeridianHubSsoService,
    WorkspaceMemberIdentityPreQueryHook,
    { provide: APP_GUARD, useClass: HubOnlyIdentityGuard },
  ],
})
export class VeridianHubSsoModule {}
