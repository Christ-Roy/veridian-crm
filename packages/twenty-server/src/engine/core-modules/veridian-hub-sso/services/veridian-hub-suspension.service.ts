import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { EventEmitter2 } from '@nestjs/event-emitter';
import { IsNull, Not, Repository } from 'typeorm';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { WORKSPACE_SUSPENDED_EVENT } from 'src/engine/core-modules/workspace/constants/workspace-suspended-event.constant';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { type WorkspaceSuspendedEvent } from 'src/engine/core-modules/workspace/types/workspace-suspended-event.type';
import { KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { hubTenantKey } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service';

export const SUSPENSION_REASONS = [
  'billing_past_due',
  'admin_action',
  'quota_exceeded',
] as const;

export type SuspensionReason = (typeof SUSPENSION_REASONS)[number];

export const isSuspensionReason = (value: unknown): value is SuspensionReason =>
  typeof value === 'string' &&
  (SUSPENSION_REASONS as readonly string[]).includes(value);

type SuspensionFields = {
  suspendedAt?: string;
  suspendedReason?: SuspensionReason;
  resumedAt?: string;
};

export type SuspensionOutcome =
  | { status: 'not_found' | 'workspace_gone' }
  | { status: 'ok'; at: string };

// CONTRAT-HUB §5.4. The date and the reason live on the tenant link. suspendedAt stays NULL on
// purpose: the native CleanSuspendedWorkspacesJob erases a space whose suspendedAt is set.
@Injectable()
export class VeridianHubSuspensionService {
  constructor(
    @InjectRepository(KeyValuePairEntity)
    private readonly keyValuePairRepository: Repository<KeyValuePairEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly workspaceService: WorkspaceService,
    private readonly eventEmitter: EventEmitter2,
    private readonly coreEntityCacheService: CoreEntityCacheService,
  ) {}

  private async findLink(tenantId: string) {
    const link = await this.keyValuePairRepository.findOne({
      where: { key: hubTenantKey(tenantId), userId: IsNull() },
    });

    if (!link?.workspaceId) {
      return null;
    }

    const workspace = await this.workspaceRepository.findOne({
      where: { id: link.workspaceId },
      withDeleted: true,
    });

    return { link, workspaceId: link.workspaceId, workspace };
  }

  private async writeFields(
    linkId: string,
    current: object,
    fields: SuspensionFields,
  ) {
    await this.keyValuePairRepository.update(linkId, {
      value: { ...current, ...fields } as unknown as JSON,
    });
  }

  async suspend(
    tenantId: string,
    reason: SuspensionReason,
  ): Promise<SuspensionOutcome> {
    const found = await this.findLink(tenantId);

    if (!found) {
      return { status: 'not_found' };
    }

    const { link, workspaceId, workspace } = found;

    if (!workspace || workspace.deletedAt) {
      return { status: 'workspace_gone' };
    }

    const current = (link.value ?? {}) as SuspensionFields;

    if (workspace.activationStatus === WorkspaceActivationStatus.SUSPENDED) {
      const at = current.suspendedAt ?? new Date().toISOString();

      return { status: 'ok', at };
    }

    const at = new Date().toISOString();

    const { affected } = await this.workspaceRepository.update(
      {
        id: workspaceId,
        activationStatus: Not(WorkspaceActivationStatus.SUSPENDED),
        deletedAt: IsNull(),
      },
      {
        activationStatus: WorkspaceActivationStatus.SUSPENDED,
        suspendedAt: null,
      },
    );

    if ((affected ?? 0) > 0) {
      this.eventEmitter.emit(WORKSPACE_SUSPENDED_EVENT, {
        workspaceId,
      } satisfies WorkspaceSuspendedEvent);
      await this.coreEntityCacheService.invalidate(
        'workspaceEntity',
        workspaceId,
      );
    }

    await this.writeFields(link.id, link.value ?? {}, {
      suspendedAt: at,
      suspendedReason: reason,
      resumedAt: undefined,
    });

    return { status: 'ok', at };
  }

  async resume(tenantId: string): Promise<SuspensionOutcome> {
    const found = await this.findLink(tenantId);

    if (!found) {
      return { status: 'not_found' };
    }

    const { link, workspaceId, workspace } = found;

    if (!workspace || workspace.deletedAt) {
      return { status: 'workspace_gone' };
    }

    const at = new Date().toISOString();

    if (workspace.activationStatus === WorkspaceActivationStatus.SUSPENDED) {
      await this.workspaceService.reactivateWorkspace(workspaceId);
    }

    await this.writeFields(link.id, link.value ?? {}, {
      suspendedAt: undefined,
      suspendedReason: undefined,
      resumedAt: at,
    });

    return { status: 'ok', at };
  }
}
