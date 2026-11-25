import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppTokenEntity } from 'src/engine/core-modules/app-token/app-token.entity';
import { CoreEntityCacheModule } from 'src/engine/core-entity-cache/core-entity-cache.module';
import { AuthModule } from 'src/engine/core-modules/auth/auth.module';
import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { WorkspaceDomainsModule } from 'src/engine/core-modules/domain/workspace-domains/workspace-domains.module';
import { CacheLockModule } from 'src/engine/core-modules/cache-lock/cache-lock.module';
import { FileCorePictureModule } from 'src/engine/core-modules/file/file-core-picture/file-core-picture.module';
import { KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { OnboardingModule } from 'src/engine/core-modules/onboarding/onboarding.module';
import { ThrottlerModule } from 'src/engine/core-modules/throttler/throttler.module';
import { UserSessionModule } from 'src/engine/core-modules/user-session/user-session.module';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserWorkspaceModule } from 'src/engine/core-modules/user-workspace/user-workspace.module';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { UserModule } from 'src/engine/core-modules/user/user.module';
import { VeridianHubSsoController } from 'src/engine/core-modules/veridian-hub-sso/controllers/veridian-hub-sso.controller';
import { ClosedWhenSuspendedGuard } from 'src/engine/core-modules/veridian-hub-sso/guards/closed-when-suspended.guard';
import { HubOnlyIdentityGuard } from 'src/engine/core-modules/veridian-hub-sso/guards/hub-only-identity.guard';
import { WorkspaceMemberIdentityPreQueryHook } from 'src/engine/core-modules/veridian-hub-sso/query-hooks/workspace-member-identity.pre-query.hook';
import { VeridianHubMemberAccessService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-member-access.service';
import { VeridianHubOrganisationService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-organisation.service';
import { VeridianHubRoleService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-role.service';
import { VeridianHubSsoService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service';
import { VeridianHubSuspensionService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-suspension.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { SubscriptionsModule } from 'src/engine/subscriptions/subscriptions.module';
import { UserRoleModule } from 'src/engine/permissions/role-assignment/user-role.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { WorkspaceModule } from 'src/engine/core-modules/workspace/workspace.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      UserWorkspaceEntity,
      WorkspaceEntity,
      KeyValuePairEntity,
      RoleEntity,
      AppTokenEntity,
    ]),
    CacheLockModule,
    FileCorePictureModule,
    UserRoleModule,
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
    WorkspaceCacheModule,
    SubscriptionsModule,
  ],
  controllers: [VeridianHubSsoController],
  providers: [
    VeridianHubSsoService,
    VeridianHubRoleService,
    VeridianHubMemberAccessService,
    VeridianHubOrganisationService,
    VeridianHubSuspensionService,
    WorkspaceMemberIdentityPreQueryHook,
    { provide: APP_GUARD, useClass: HubOnlyIdentityGuard },
    { provide: APP_GUARD, useClass: ClosedWhenSuspendedGuard },
  ],
})
export class VeridianHubSsoModule {}
