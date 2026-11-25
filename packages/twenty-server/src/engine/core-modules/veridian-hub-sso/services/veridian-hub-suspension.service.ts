import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { In, IsNull, type Repository } from 'typeorm';

import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { CacheLockService } from 'src/engine/core-modules/cache-lock/cache-lock.service';
import {
  KeyValuePairEntity,
  KeyValuePairType,
} from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { hubTenantKey } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service';
import { settleCoreEntityCache } from 'src/engine/core-modules/veridian-hub-sso/utils/settle-core-entity-cache.util';
import { WORKSPACE_REACTIVATED_EVENT } from 'src/engine/core-modules/workspace/constants/workspace-reactivated-event.constant';
import { WORKSPACE_SUSPENDED_EVENT } from 'src/engine/core-modules/workspace/constants/workspace-suspended-event.constant';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { type WorkspaceReactivatedEvent } from 'src/engine/core-modules/workspace/types/workspace-reactivated-event.type';
import { type WorkspaceSuspendedEvent } from 'src/engine/core-modules/workspace/types/workspace-suspended-event.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

export const HUB_SUSPENSION_KEY = 'veridian.hub_suspension';

export const SUSPENSION_REASONS = [
  'billing_past_due',
  'admin_action',
  'quota_exceeded',
] as const;

export type SuspensionReason = (typeof SUSPENSION_REASONS)[number];

export const isSuspensionReason = (value: unknown): value is SuspensionReason =>
  typeof value === 'string' &&
  (SUSPENSION_REASONS as readonly string[]).includes(value);

type SuspensionMark = { suspendedAt: string; reason: SuspensionReason };

export type SuspensionOutcome =
  | {
      status:
        | 'not_found'
        | 'workspace_gone'
        | 'not_active'
        | 'not_suspended_by_hub';
    }
  | { status: 'ok'; at: string };

// CONTRAT-HUB §5.4. The Hub's mark has its own row (a plan update rewrites the tenant link) and is written first: any
// call cut halfway is finished by replaying it. suspendedAt stays NULL on purpose, the native
// CleanSuspendedWorkspacesJob erases a space whose suspendedAt is set.
@Injectable()
export class VeridianHubSuspensionService {
  constructor(
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(KeyValuePairEntity)
    private readonly keyValuePairRepository: Repository<KeyValuePairEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly workspaceService: WorkspaceService,
    private readonly eventEmitter: EventEmitter2,
    private readonly coreEntityCacheService: CoreEntityCacheService,
    private readonly cacheLockService: CacheLockService,
  ) {}

  async suspend(
    tenantId: string,
    reason: SuspensionReason,
  ): Promise<SuspensionOutcome> {
    return this.withWorkspace(tenantId, async (workspace) => {
      if (
        workspace.activationStatus !== WorkspaceActivationStatus.ACTIVE &&
        workspace.activationStatus !== WorkspaceActivationStatus.SUSPENDED
      ) {
        return { status: 'not_active' };
      }

      const known = await this.findMark(workspace.id);
      const at = known?.value.suspendedAt ?? new Date().toISOString();

      if (!known) {
        await this.keyValuePairRepository.save({
          key: HUB_SUSPENSION_KEY,
          userId: null,
          workspaceId: workspace.id,
          value: { suspendedAt: at, reason } as unknown as JSON,
          type: KeyValuePairType.USER_VARIABLE,
        });
      }

      await this.workspaceRepository.update(
        {
          id: workspace.id,
          activationStatus: In([
            WorkspaceActivationStatus.ACTIVE,
            WorkspaceActivationStatus.SUSPENDED,
          ]),
          deletedAt: IsNull(),
        },
        {
          activationStatus: WorkspaceActivationStatus.SUSPENDED,
          suspendedAt: null,
        },
      );
      await this.coreEntityCacheService.invalidate(
        'workspaceEntity',
        workspace.id,
      );
      this.eventEmitter.emit(WORKSPACE_SUSPENDED_EVENT, {
        workspaceId: workspace.id,
      } satisfies WorkspaceSuspendedEvent);
      await this.settleCaches(workspace.id);

      return { status: 'ok', at };
    });
  }

  // Only what the Hub suspended: another path (deletion, billing) keeps its own reason to close the space.
  async resume(tenantId: string): Promise<SuspensionOutcome> {
    return this.withWorkspace(tenantId, async (workspace) => {
      const mark = await this.findMark(workspace.id);
      const at = new Date().toISOString();

      if (!mark) {
        return workspace.activationStatus ===
          WorkspaceActivationStatus.SUSPENDED
          ? { status: 'not_suspended_by_hub' }
          : { status: 'ok', at };
      }

      if (workspace.activationStatus === WorkspaceActivationStatus.SUSPENDED) {
        await this.workspaceService.reactivateWorkspace(workspace.id);
      } else {
        // Cut after the native reactivation: its event and its cache are replayed.
        await this.coreEntityCacheService.invalidate(
          'workspaceEntity',
          workspace.id,
        );
        this.eventEmitter.emit(WORKSPACE_REACTIVATED_EVENT, {
          workspaceId: workspace.id,
        } satisfies WorkspaceReactivatedEvent);
      }

      await this.settleCaches(workspace.id);
      await this.keyValuePairRepository.delete(mark.id);

      return { status: 'ok', at };
    });
  }

  private async settleCaches(workspaceId: string): Promise<void> {
    await settleCoreEntityCache(
      this.coreEntityCacheService,
      'workspaceEntity',
      [workspaceId],
    );
  }

  private async withWorkspace(
    tenantId: string,
    act: (workspace: WorkspaceEntity) => Promise<SuspensionOutcome>,
  ): Promise<SuspensionOutcome> {
    const link = await this.keyValuePairRepository.findOne({
      where: { key: hubTenantKey(tenantId), userId: IsNull() },
    });
    const workspaceId = link?.workspaceId;

    if (!workspaceId) {
      return { status: 'not_found' };
    }

    return this.cacheLockService.withLock(async () => {
      const workspace = await this.workspaceRepository.findOne({
        where: { id: workspaceId },
        withDeleted: true,
      });

      return workspace && !workspace.deletedAt
        ? act(workspace)
        : { status: 'workspace_gone' };
    }, `veridian-hub-suspension:${workspaceId}`);
  }

  private async findMark(workspaceId: string) {
    const pair = await this.keyValuePairRepository.findOne({
      where: { key: HUB_SUSPENSION_KEY, workspaceId, userId: IsNull() },
    });

    return pair
      ? { id: pair.id, value: pair.value as unknown as SuspensionMark }
      : null;
  }
}
