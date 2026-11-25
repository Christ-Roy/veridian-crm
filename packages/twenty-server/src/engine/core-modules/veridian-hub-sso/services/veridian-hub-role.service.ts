import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, type Repository } from 'typeorm';

import { CacheLockService } from 'src/engine/core-modules/cache-lock/cache-lock.service';
import {
  KeyValuePairEntity,
  KeyValuePairType,
} from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import {
  HUB_ROLE_KEY,
  type HubRole,
} from 'src/engine/core-modules/veridian-hub-sso/utils/parse-hub-organisations.util';
import { HUB_ROLE_CARRIED_KEY } from 'src/engine/core-modules/veridian-hub-sso/utils/assert-role-not-carried-by-hub.util';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import {
  PermissionsException,
  PermissionsExceptionCode,
} from 'src/engine/permissions/permissions.exception';
import { UserRoleService } from 'src/engine/permissions/role-assignment/user-role.service';
import { STANDARD_ROLE } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant';

export type HubRoleResult =
  | { status: 'tenant_not_linked' }
  | { status: 'ok'; applied: true; nativeRole: string }
  | {
      status: 'ok';
      applied: false;
      reason:
        | 'unchanged'
        | 'not_member'
        | 'stale'
        | 'native_custom'
        | 'last_admin'
        | 'released';
    };

type StoredHubRole = { role: HubRole; version: number };

// CONTRAT-HUB §5.22 (Robert, 24/11/2026): the Hub carries the role of a member. It never creates a membership, never
// touches another workspace, never replaces a custom role by a demotion, never removes the last Admin.
@Injectable()
export class VeridianHubRoleService {
  private readonly logger = new Logger(VeridianHubRoleService.name);

  constructor(
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(KeyValuePairEntity)
    private readonly keyValuePairRepository: Repository<KeyValuePairEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    private readonly userRoleService: UserRoleService,
    private readonly cacheLockService: CacheLockService,
  ) {}

  async applyRole({
    hubTenantId,
    hubUserId,
    role,
    version,
  }: {
    hubTenantId: string;
    hubUserId: string;
    role: HubRole;
    version: number;
  }): Promise<HubRoleResult> {
    const tenant = await this.findTenant(hubTenantId);

    if (!tenant?.workspaceId) {
      return { status: 'tenant_not_linked' };
    }

    // By hub_user_id only: an email never decides whose role changes.
    const hubUser = await this.keyValuePairRepository.findOne({
      where: { key: `veridian.hub_user:${hubUserId}`, workspaceId: IsNull() },
    });

    if (!hubUser?.userId) {
      return { status: 'ok', applied: false, reason: 'not_member' };
    }

    const { workspaceId } = tenant;
    const { userId } = hubUser;

    return this.cacheLockService.withLock(
      () => this.applyLocked({ workspaceId, userId, role, version }),
      `veridian-hub-role:${workspaceId}:${userId}`,
    );
  }

  // A role carried by a sign-in never blocks the sign-in.
  async applyRolesAtSignIn(
    hubUserId: string,
    organisations: { hubTenantId: string; role: HubRole; version: number }[],
  ): Promise<void> {
    for (const organisation of organisations) {
      try {
        const result = await this.applyRole({ hubUserId, ...organisation });

        this.logger.log(
          `Hub role at sign-in tenant=${organisation.hubTenantId} sub=${hubUserId} ${JSON.stringify(result)}`,
        );
      } catch (error) {
        this.logger.warn(
          `Hub role at sign-in failed tenant=${organisation.hubTenantId} sub=${hubUserId}: ${error}`,
        );
      }
    }
  }

  // The Hub gives the roles back to the workspace: nobody's role changes.
  async release(hubTenantId: string): Promise<HubRoleResult> {
    const tenant = await this.findTenant(hubTenantId);

    if (!tenant?.workspaceId) {
      return { status: 'tenant_not_linked' };
    }

    await this.keyValuePairRepository.delete({
      key: HUB_ROLE_CARRIED_KEY,
      workspaceId: tenant.workspaceId,
      userId: IsNull(),
    });
    this.logger.log(`Hub roles released tenant=${hubTenantId}`);

    return { status: 'ok', applied: false, reason: 'released' };
  }

  // A member who left comes back with the default role: what the Hub said before no longer describes them.
  async forgetRole(workspaceId: string, userId: string): Promise<void> {
    await this.keyValuePairRepository.delete({
      key: HUB_ROLE_KEY,
      workspaceId,
      userId,
    });
  }

  private async applyLocked({
    workspaceId,
    userId,
    role,
    version,
  }: {
    workspaceId: string;
    userId: string;
    role: HubRole;
    version: number;
  }): Promise<HubRoleResult> {
    const userWorkspace = await this.userWorkspaceRepository.findOne({
      where: { userId, workspaceId },
    });

    if (!userWorkspace) {
      return { status: 'ok', applied: false, reason: 'not_member' };
    }

    const stored = await this.keyValuePairRepository.findOne({
      where: { key: HUB_ROLE_KEY, userId, workspaceId },
    });
    const storedRole = stored?.value as unknown as StoredHubRole | undefined;

    if (storedRole && version <= storedRole.version) {
      return { status: 'ok', applied: false, reason: 'stale' };
    }

    const current = (
      await this.userRoleService.getRolesByUserWorkspaces({
        userWorkspaceIds: [userWorkspace.id],
        workspaceId,
      })
    ).get(userWorkspace.id)?.[0];
    const isAdmin =
      current?.universalIdentifier === STANDARD_ROLE.admin.universalIdentifier;
    const remember = async () => {
      await this.keyValuePairRepository.save({
        ...(stored ? { id: stored.id } : {}),
        key: HUB_ROLE_KEY,
        userId,
        workspaceId,
        value: { role, version } as unknown as JSON,
        type: KeyValuePairType.USER_VARIABLE,
      });
      await this.markCarried(workspaceId);
    };

    const target =
      role === 'member'
        ? await this.findDefaultRole(workspaceId)
        : await this.findAdminRole(workspaceId);

    if (current?.id === target?.id) {
      await remember();

      return { status: 'ok', applied: false, reason: 'unchanged' };
    }

    // A demotion only takes Admin back: a custom role is a human choice.
    if (!target || (role === 'member' && !isAdmin)) {
      return { status: 'ok', applied: false, reason: 'native_custom' };
    }

    try {
      await this.userRoleService.assignRoleToManyUserWorkspace({
        workspaceId,
        userWorkspaceIds: [userWorkspace.id],
        roleId: target.id,
      });
    } catch (error) {
      if (
        error instanceof PermissionsException &&
        error.code === PermissionsExceptionCode.CANNOT_UNASSIGN_LAST_ADMIN
      ) {
        return { status: 'ok', applied: false, reason: 'last_admin' };
      }

      throw error;
    }

    await remember();

    return { status: 'ok', applied: true, nativeRole: target.label };
  }

  private findTenant(hubTenantId: string) {
    return this.keyValuePairRepository.findOne({
      where: { key: `veridian.hub_tenant:${hubTenantId}`, userId: IsNull() },
    });
  }

  async isCarried(workspaceId: string): Promise<boolean> {
    const mark = await this.keyValuePairRepository.findOne({
      where: { key: HUB_ROLE_CARRIED_KEY, workspaceId, userId: IsNull() },
    });

    return Boolean(mark);
  }

  private async markCarried(workspaceId: string): Promise<void> {
    if (await this.isCarried(workspaceId)) {
      return;
    }

    await this.keyValuePairRepository.save({
      key: HUB_ROLE_CARRIED_KEY,
      userId: null,
      workspaceId,
      value: { since: new Date().toISOString() } as unknown as JSON,
      type: KeyValuePairType.USER_VARIABLE,
    });
  }

  private findAdminRole(workspaceId: string) {
    return this.roleRepository.findOne({
      where: {
        workspaceId,
        universalIdentifier: STANDARD_ROLE.admin.universalIdentifier,
      },
    });
  }

  private async findDefaultRole(workspaceId: string) {
    const workspace = await this.workspaceRepository.findOne({
      where: { id: workspaceId },
    });

    return workspace?.defaultRoleId
      ? this.roleRepository.findOne({
          where: { workspaceId, id: workspace.defaultRoleId },
        })
      : null;
  }
}
