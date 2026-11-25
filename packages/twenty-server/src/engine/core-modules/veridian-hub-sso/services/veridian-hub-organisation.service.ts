import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, type Repository } from 'typeorm';

import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { CacheLockService } from 'src/engine/core-modules/cache-lock/cache-lock.service';
import { FileCorePictureService } from 'src/engine/core-modules/file/file-core-picture/services/file-core-picture.service';
import {
  KeyValuePairEntity,
  KeyValuePairType,
} from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { VeridianHubRoleService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-role.service';
import { VeridianHubSsoService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service';
import {
  type HubOrganisation,
  type HubOrganisationMember,
} from 'src/engine/core-modules/veridian-hub-sso/utils/parse-hub-organisation.util';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

const HUB_ORGANISATION_KEY = 'veridian.hub_organisation';

type StoredOrganisation = {
  version: number;
  logoUrl: string | null;
  logoFileId: string | null;
};

export type HubOrganisationResult =
  | { status: 'tenant_not_linked' | 'logo_unreachable' | 'members_failed' }
  | { status: 'ok'; applied: false; reason: 'unchanged' | 'stale' }
  | { status: 'ok'; applied: true; attached: number; refused: number };

// CONTRAT-HUB §5.19.6: one organisation document, set at the Hub. Additive: it never removes anyone, never changes the
// role of someone already there, never creates a workspace, and an empty field empties nothing.
@Injectable()
export class VeridianHubOrganisationService {
  private readonly logger = new Logger(VeridianHubOrganisationService.name);

  constructor(
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(KeyValuePairEntity)
    private readonly keyValuePairRepository: Repository<KeyValuePairEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly veridianHubSsoService: VeridianHubSsoService,
    private readonly veridianHubRoleService: VeridianHubRoleService,
    private readonly fileCorePictureService: FileCorePictureService,
    private readonly coreEntityCacheService: CoreEntityCacheService,
    private readonly cacheLockService: CacheLockService,
  ) {}

  async readVersion(hubTenantId: string): Promise<number | null> {
    const workspaceId =
      await this.veridianHubSsoService.findWorkspaceIdByTenant(hubTenantId);

    return workspaceId
      ? ((await this.findStored(workspaceId))?.value.version ?? 0)
      : null;
  }

  async apply(organisation: HubOrganisation): Promise<HubOrganisationResult> {
    const workspaceId =
      await this.veridianHubSsoService.findWorkspaceIdByTenant(
        organisation.hubTenantId,
      );

    if (!workspaceId) {
      return { status: 'tenant_not_linked' };
    }

    return this.cacheLockService.withLock(
      () => this.applyLocked(workspaceId, organisation),
      `veridian-hub-organisation:${workspaceId}`,
    );
  }

  private async applyLocked(
    workspaceId: string,
    organisation: HubOrganisation,
  ): Promise<HubOrganisationResult> {
    const workspace = await this.workspaceRepository.findOne({
      where: { id: workspaceId },
    });

    if (!workspace) {
      return { status: 'tenant_not_linked' };
    }

    const stored = await this.findStored(workspaceId);

    if (stored && organisation.version <= stored.value.version) {
      return {
        status: 'ok',
        applied: false,
        reason:
          organisation.version === stored.value.version ? 'unchanged' : 'stale',
      };
    }

    // Members first, the version last: a failure is replayed by the Hub, never remembered as done.
    const { attached, refused, failed } = await this.attachMembers(
      workspaceId,
      organisation,
    );

    if (failed > 0) {
      return { status: 'members_failed' };
    }

    if (
      organisation.chosenName &&
      organisation.chosenName !== workspace.displayName
    ) {
      await this.workspaceRepository.update(workspaceId, {
        displayName: organisation.chosenName,
      });
      await this.coreEntityCacheService.invalidate(
        'workspaceEntity',
        workspaceId,
      );
    }

    const logo = await this.applyLogo(
      workspace,
      organisation.logoUrl,
      stored?.value,
    );

    if (!logo) {
      return { status: 'logo_unreachable' };
    }

    await this.keyValuePairRepository.save({
      ...(stored ? { id: stored.id } : {}),
      key: HUB_ORGANISATION_KEY,
      userId: null,
      workspaceId,
      value: { version: organisation.version, ...logo } as unknown as JSON,
      type: KeyValuePairType.USER_VARIABLE,
    });
    this.logger.log(
      `Hub organisation tenant=${organisation.hubTenantId} version=${organisation.version} attached=${attached} refused=${refused}`,
    );

    return { status: 'ok', applied: true, attached, refused };
  }

  private async attachMembers(
    workspaceId: string,
    { hubTenantId, members, refused: malformed }: HubOrganisation,
  ) {
    const count = { attached: 0, present: 0, refused: malformed, failed: 0 };

    for (const member of members) {
      try {
        count[await this.attachOne(workspaceId, hubTenantId, member)]++;
      } catch (error) {
        count.failed++;
        this.logger.warn(
          `Hub organisation member failed tenant=${hubTenantId} sub=${member.hubUserId}: ${error}`,
        );
      }
    }

    return count;
  }

  private async attachOne(
    workspaceId: string,
    hubTenantId: string,
    member: HubOrganisationMember,
  ): Promise<'attached' | 'refused' | 'present'> {
    const { hubUserId, email, joinedAt } = member;
    const membership = await this.veridianHubSsoService.describeMembership({
      workspaceId,
      hubUserId,
      email,
    });

    if (membership.isMember) {
      return 'present';
    }

    // Someone removed here only comes back through an adhesion newer than the removal.
    if (
      membership.isDisabled ||
      (membership.removedAt && joinedAt <= membership.removedAt)
    ) {
      return 'refused';
    }

    const result = await this.veridianHubSsoService.attachMember({
      workspaceId,
      hubUserId,
      email,
    });

    if (result.status !== 'ok') {
      return 'refused';
    }

    // Same clock as the Hub's own role channel, so a later change of role still wins.
    if (await this.veridianHubRoleService.isCarried(workspaceId)) {
      await this.veridianHubRoleService.applyRole({
        hubTenantId,
        hubUserId,
        role: member.role,
        version: joinedAt.getTime(),
      });
    }

    return 'attached';
  }

  // Returns what to remember, or null when the Hub did not serve the image.
  private async applyLogo(
    workspace: WorkspaceEntity,
    logoUrl: string | null,
    stored: StoredOrganisation | undefined,
  ): Promise<Pick<StoredOrganisation, 'logoUrl' | 'logoFileId'> | null> {
    if (!logoUrl) {
      return {
        logoUrl: stored?.logoUrl ?? null,
        logoFileId: stored?.logoFileId ?? null,
      };
    }

    const replacedLogoFileId = workspace.logoFileId;

    if (
      stored?.logoUrl === logoUrl &&
      stored.logoFileId &&
      stored.logoFileId === replacedLogoFileId
    ) {
      return { logoUrl, logoFileId: stored.logoFileId };
    }

    const file = await this.fileCorePictureService.uploadWorkspaceLogoFromUrl({
      imageUrl: logoUrl,
      workspaceId: workspace.id,
    });

    if (!file) {
      return null;
    }

    await this.workspaceRepository.update(workspace.id, {
      logoFileId: file.id,
    });
    await this.coreEntityCacheService.invalidate(
      'workspaceEntity',
      workspace.id,
    );

    if (replacedLogoFileId) {
      await this.fileCorePictureService.deleteCorePicture({
        fileId: replacedLogoFileId,
        workspaceId: workspace.id,
      });
    }

    return { logoUrl, logoFileId: file.id };
  }

  private async findStored(workspaceId: string) {
    const pair = await this.keyValuePairRepository.findOne({
      where: { key: HUB_ORGANISATION_KEY, workspaceId, userId: IsNull() },
    });

    return pair
      ? { id: pair.id, value: pair.value as unknown as StoredOrganisation }
      : null;
  }
}
