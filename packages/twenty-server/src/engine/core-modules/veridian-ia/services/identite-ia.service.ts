import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Like, Repository } from 'typeorm';

import { KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { enregistrerResolutionHubUserId } from 'src/engine/core-modules/veridian-ia/utils/identite-ia.middleware';

const PREFIXE_LIEN_HUB = 'veridian.hub_user:';
const DUREE_CACHE_MS = 5 * 60 * 1000;

// Le membre Twenty -> son hub_user_id, par le lien posé au rebond du Hub (veridian-hub-sso), mis en cache 5 min.
@Injectable()
export class IdentiteIaService implements OnModuleInit, OnModuleDestroy {
  private readonly cache = new Map<string, { hubUserId: string | null; jusqua: number }>();

  constructor(
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    @InjectRepository(KeyValuePairEntity)
    private readonly keyValuePairRepository: Repository<KeyValuePairEntity>,
  ) {}

  onModuleInit() {
    enregistrerResolutionHubUserId((userWorkspaceId) => this.hubUserIdDe(userWorkspaceId));
  }

  onModuleDestroy() {
    enregistrerResolutionHubUserId(null);
  }

  async hubUserIdDe(userWorkspaceId: string): Promise<string | null> {
    const enCache = this.cache.get(userWorkspaceId);

    if (enCache && enCache.jusqua > Date.now()) {
      return enCache.hubUserId;
    }

    const membre = await this.userWorkspaceRepository.findOne({ where: { id: userWorkspaceId } });
    const lien = membre
      ? await this.keyValuePairRepository.findOne({
          where: { userId: membre.userId, workspaceId: IsNull(), key: Like(`${PREFIXE_LIEN_HUB}%`) },
        })
      : null;
    const hubUserId = lien ? lien.key.slice(PREFIXE_LIEN_HUB.length) : null;

    this.cache.set(userWorkspaceId, { hubUserId, jusqua: Date.now() + DUREE_CACHE_MS });

    return hubUserId;
  }
}
