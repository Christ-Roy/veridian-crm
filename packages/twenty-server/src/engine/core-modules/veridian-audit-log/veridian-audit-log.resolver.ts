import { UseFilters, UseGuards } from '@nestjs/common';
import { Args, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'twenty-shared/constants';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { VeridianAuditLogFilterInput } from 'src/engine/core-modules/veridian-audit-log/dtos/veridian-audit-log-filter.input';
import { VeridianAuditLogService } from 'src/engine/core-modules/veridian-audit-log/services/veridian-audit-log.service';
import { VeridianAuditLogEntity } from 'src/engine/core-modules/veridian-audit-log/veridian-audit-log.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { PermissionsGraphqlApiExceptionFilter } from 'src/engine/metadata-modules/permissions/utils/permissions-graphql-api-exception.filter';

/**
 * Admin consultation of the Veridian append-only audit log (AGPL,
 * clean-room). Read-only: there is intentionally NO mutation here, the journal
 * is append-only. Gated behind the SECURITY settings permission so only a
 * workspace admin can read the trail, and scoped to the caller's own
 * workspace.
 */
@MetadataResolver(() => VeridianAuditLogEntity)
@UseFilters(AuthGraphqlApiExceptionFilter, PermissionsGraphqlApiExceptionFilter)
@UseGuards(
  WorkspaceAuthGuard,
  SettingsPermissionGuard(PermissionFlagType.SECURITY),
)
export class VeridianAuditLogResolver {
  constructor(
    private readonly veridianAuditLogService: VeridianAuditLogService,
  ) {}

  @Query(() => [VeridianAuditLogEntity])
  async veridianAuditLog(
    @AuthWorkspace() workspace: WorkspaceEntity,
    @Args('filter', { nullable: true }) filter?: VeridianAuditLogFilterInput,
  ): Promise<VeridianAuditLogEntity[]> {
    return this.veridianAuditLogService.findEntries({
      workspaceId: workspace.id,
      action: filter?.action,
      targetType: filter?.targetType,
      targetId: filter?.targetId,
      actorUserId: filter?.actorUserId,
      from: filter?.from,
      to: filter?.to,
      before: filter?.before,
      limit: filter?.limit,
    });
  }
}
