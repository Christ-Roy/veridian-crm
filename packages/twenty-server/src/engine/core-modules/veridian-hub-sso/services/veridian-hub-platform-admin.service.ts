import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, IsNull, Like, type Repository } from 'typeorm';

import { CacheLockService } from 'src/engine/core-modules/cache-lock/cache-lock.service';
import {
  KeyValuePairEntity,
  KeyValuePairType,
} from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import {
  PermissionsException,
  PermissionsExceptionCode,
} from 'src/engine/permissions/permissions.exception';
import { UserRoleService } from 'src/engine/permissions/role-assignment/user-role.service';
import { STANDARD_ROLE } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant';

export const PLATFORM_ADMIN_KEY = 'veridian.platform_admin';

type StoredPlatformAdmin = {
  granted: boolean;
  withdrawn: boolean;
  at: string;
  actor: string;
  reason: string | null;
};

export type PlatformAdminMember = {
  hub_user_id: string;
  role: string | null;
  admin_granted: boolean;
  admin_withdrawn: boolean;
};

export type PlatformAdminResult =
  | { status: 404; error: 'tenant_not_found' | 'user_not_in_app' | 'not_a_member' }
  | { status: 409; error: 'admin_withdrawn' | 'is_owner' | 'last_admin' }
  | { status: 200; applied: boolean; role: string | null };

type Workspace = { workspaceId: string; ownerHubUserId: string | null };

// CONTRAT-HUB §5.23 (Robert, 25/11/2026): the Hub's platform admins are Admin in every client workspace, never owner.
// The client may take the role back natively; that choice is kept, and only a human `reinstate` undoes it.
@Injectable()
export class VeridianHubPlatformAdminService {
  private readonly logger = new Logger(VeridianHubPlatformAdminService.name);

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

  async apply({
    workspaceRef,
    hubUserId,
    action,
    actor,
    reason,
    reinstate,
  }: {
    workspaceRef: string;
    hubUserId: string;
    action: 'grant' | 'revoke';
    actor: string;
    reason: string | null;
    reinstate: boolean;
  }): Promise<PlatformAdminResult> {
    const workspace = await this.findWorkspace(workspaceRef);

    if (!workspace) {
      return { status: 404, error: 'tenant_not_found' };
    }

    const hubUser = await this.keyValuePairRepository.findOne({
      where: { key: `veridian.hub_user:${hubUserId}`, workspaceId: IsNull() },
    });

    if (!hubUser?.userId) {
      return { status: 404, error: 'user_not_in_app' };
    }

    if (workspace.ownerHubUserId === hubUserId) {
      return { status: 409, error: 'is_owner' };
    }

    const { workspaceId } = workspace;
    const userId = hubUser.userId;

    return this.cacheLockService.withLock(
      () =>
        this.applyLocked({
          workspaceId,
          userId,
          hubUserId,
          action,
          actor,
          reason,
          reinstate,
        }),
      `veridian-platform-admin:${workspaceId}:${userId}`,
    );
  }

  async list(workspaceRef: string): Promise<PlatformAdminMember[] | null> {
    const workspace = await this.findWorkspace(workspaceRef);

    if (!workspace) {
      return null;
    }

    const { workspaceId } = workspace;
    const userWorkspaces = await this.userWorkspaceRepository.find({
      where: { workspaceId },
    });
    const links = userWorkspaces.length
      ? await this.keyValuePairRepository.find({
          where: {
            userId: In(userWorkspaces.map(({ userId }) => userId)),
            workspaceId: IsNull(),
          },
        })
      : [];
    const hubUserIdByUserId = new Map(
      links
        .filter(({ key }) => key.startsWith('veridian.hub_user:'))
        .map(({ key, userId }) => [userId, key.slice('veridian.hub_user:'.length)]),
    );
    const roles = await this.userRoleService.getRolesByUserWorkspaces({
      userWorkspaceIds: userWorkspaces.map(({ id }) => id),
      workspaceId,
    });
    const members: PlatformAdminMember[] = [];

    for (const userWorkspace of userWorkspaces) {
      const hubUserId = hubUserIdByUserId.get(userWorkspace.userId);

      if (!hubUserId) {
        continue;
      }

      const role = roles.get(userWorkspace.id)?.[0];
      const stored = await this.observeWithdrawal(
        workspaceId,
        userWorkspace.userId,
        this.isAdmin(role),
      );

      members.push({
        hub_user_id: hubUserId,
        role: this.roleName(role, workspace.ownerHubUserId === hubUserId),
        admin_granted: stored?.granted === true,
        admin_withdrawn: stored?.withdrawn === true,
      });
    }

    return members;
  }

  // An organisation push (§5.22) never gives Admin back to a platform admin the client removed.
  async isWithdrawn(workspaceId: string, userId: string): Promise<boolean> {
    return (await this.read(workspaceId, userId))?.value.withdrawn === true;
  }

  private async applyLocked({
    workspaceId,
    userId,
    hubUserId,
    action,
    actor,
    reason,
    reinstate,
  }: {
    workspaceId: string;
    userId: string;
    hubUserId: string;
    action: 'grant' | 'revoke';
    actor: string;
    reason: string | null;
    reinstate: boolean;
  }): Promise<PlatformAdminResult> {
    const userWorkspace = await this.userWorkspaceRepository.findOne({
      where: { userId, workspaceId },
    });

    if (!userWorkspace) {
      return { status: 404, error: 'not_a_member' };
    }

    const current = (
      await this.userRoleService.getRolesByUserWorkspaces({
        userWorkspaceIds: [userWorkspace.id],
        workspaceId,
      })
    ).get(userWorkspace.id)?.[0];
    const stored = await this.observeWithdrawal(
      workspaceId,
      userId,
      this.isAdmin(current),
    );
    const log = (applied: boolean, outcome: string) =>
      this.logger.log(
        `platform_admin ${JSON.stringify({ workspaceId, hubUserId, action, actor, reason, reinstate, applied, outcome })}`,
      );

    if (action === 'grant') {
      if (stored?.withdrawn && !reinstate) {
        log(false, 'admin_withdrawn');

        return { status: 409, error: 'admin_withdrawn' };
      }

      const admin = await this.roleRepository.findOne({
        where: {
          workspaceId,
          universalIdentifier: STANDARD_ROLE.admin.universalIdentifier,
        },
      });

      if (!admin) {
        throw new Error(`no Admin role in workspace ${workspaceId}`);
      }

      const applied = current?.id !== admin.id;

      if (applied) {
        await this.userRoleService.assignRoleToManyUserWorkspace({
          workspaceId,
          userWorkspaceIds: [userWorkspace.id],
          roleId: admin.id,
        });
      }

      await this.write(workspaceId, userId, {
        granted: true,
        withdrawn: false,
        at: new Date().toISOString(),
        actor,
        reason,
      });
      log(applied, 'granted');

      return { status: 200, applied, role: 'admin' };
    }

    // revoke: the Hub takes back what it gave, never a role a human chose.
    if (!stored?.granted || !this.isAdmin(current)) {
      await this.write(workspaceId, userId, {
        granted: false,
        withdrawn: stored?.withdrawn === true,
        at: new Date().toISOString(),
        actor,
        reason,
      });
      log(false, 'nothing_to_revoke');

      return { status: 200, applied: false, role: this.roleName(current, false) };
    }

    const workspace = await this.workspaceRepository.findOne({
      where: { id: workspaceId },
    });
    const fallback = workspace?.defaultRoleId
      ? await this.roleRepository.findOne({
          where: { workspaceId, id: workspace.defaultRoleId },
        })
      : null;

    if (!fallback || fallback.id === current?.id) {
      log(false, 'no_default_role');

      return { status: 200, applied: false, role: this.roleName(current, false) };
    }

    try {
      await this.userRoleService.assignRoleToManyUserWorkspace({
        workspaceId,
        userWorkspaceIds: [userWorkspace.id],
        roleId: fallback.id,
      });
    } catch (error) {
      if (
        error instanceof PermissionsException &&
        error.code === PermissionsExceptionCode.CANNOT_UNASSIGN_LAST_ADMIN
      ) {
        log(false, 'last_admin');

        return { status: 409, error: 'last_admin' };
      }

      throw error;
    }

    await this.write(workspaceId, userId, {
      granted: false,
      withdrawn: false,
      at: new Date().toISOString(),
      actor,
      reason,
    });
    log(true, 'revoked');

    return { status: 200, applied: true, role: 'member' };
  }

  // Granted by the Hub, no longer Admin, never revoked by the Hub: the client took it back.
  private async observeWithdrawal(
    workspaceId: string,
    userId: string,
    isAdmin: boolean,
  ): Promise<StoredPlatformAdmin | null> {
    const row = await this.read(workspaceId, userId);

    if (!row) {
      return null;
    }

    if (row.value.granted && !row.value.withdrawn && !isAdmin) {
      const withdrawn = {
        ...row.value,
        granted: false,
        withdrawn: true,
        at: new Date().toISOString(),
      };

      await this.write(workspaceId, userId, withdrawn, row.id);
      this.logger.log(
        `platform_admin ${JSON.stringify({ workspaceId, userId, outcome: 'withdrawn_by_client' })}`,
      );

      return withdrawn;
    }

    return row.value;
  }

  private async read(
    workspaceId: string,
    userId: string,
  ): Promise<{ id: string; value: StoredPlatformAdmin } | null> {
    const row = await this.keyValuePairRepository.findOne({
      where: { key: PLATFORM_ADMIN_KEY, workspaceId, userId },
    });

    return row
      ? { id: row.id, value: row.value as unknown as StoredPlatformAdmin }
      : null;
  }

  private async write(
    workspaceId: string,
    userId: string,
    value: StoredPlatformAdmin,
    id?: string,
  ): Promise<void> {
    const existingId = id ?? (await this.read(workspaceId, userId))?.id;

    await this.keyValuePairRepository.save({
      ...(existingId ? { id: existingId } : {}),
      key: PLATFORM_ADMIN_KEY,
      workspaceId,
      userId,
      value: value as unknown as JSON,
      type: KeyValuePairType.USER_VARIABLE,
    });
  }

  // `workspace_id` is the Hub tenant (what the Hub sends, §5.23) or the CRM workspace of a linked tenant.
  private async findWorkspace(workspaceRef: string): Promise<Workspace | null> {
    const tenant =
      (await this.keyValuePairRepository.findOne({
        where: { key: `veridian.hub_tenant:${workspaceRef}`, userId: IsNull() },
      })) ??
      (await this.keyValuePairRepository.findOne({
        where: {
          key: Like('veridian.hub_tenant:%'),
          workspaceId: workspaceRef,
          userId: IsNull(),
        },
      }));

    if (!tenant?.workspaceId) {
      return null;
    }

    const value = tenant.value as unknown as
      | { ownerHubUserId?: string | null }
      | undefined;

    return {
      workspaceId: tenant.workspaceId,
      ownerHubUserId: value?.ownerHubUserId ?? null,
    };
  }

  private isAdmin(role: { universalIdentifier?: string | null } | undefined) {
    return role?.universalIdentifier === STANDARD_ROLE.admin.universalIdentifier;
  }

  private roleName(
    role: { universalIdentifier?: string | null } | undefined,
    isOwner: boolean,
  ): string | null {
    if (isOwner) {
      return 'owner';
    }

    if (!role) {
      return null;
    }

    return this.isAdmin(role) ? 'admin' : 'member';
  }
}
