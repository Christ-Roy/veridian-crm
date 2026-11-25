import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { MoreThan, type Repository } from 'typeorm';

import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import {
  AppTokenEntity,
  AppTokenType,
} from 'src/engine/core-modules/app-token/app-token.entity';
import { UserSessionService } from 'src/engine/core-modules/user-session/services/user-session.service';
import { UserSessionRevokedReason } from 'src/engine/core-modules/user-session/types/user-session-revoked-reason.type';
import { settleCoreEntityCache } from 'src/engine/core-modules/veridian-hub-sso/utils/settle-core-entity-cache.util';
import { EventStreamService } from 'src/engine/subscriptions/event-stream.service';

type Membership = { id: string; workspaceId: string };

// What someone holds open in a workspace goes with the membership, in every process, before the Hub is answered.
// Natively a removal only empties a cache, and theirs stays in the live stream of a screen left open.
@Injectable()
export class VeridianHubMemberAccessService {
  constructor(
    private readonly coreEntityCacheService: CoreEntityCacheService,
    private readonly userSessionService: UserSessionService,
    private readonly eventStreamService: EventStreamService,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(AppTokenEntity)
    private readonly appTokenRepository: Repository<AppTokenEntity>,
  ) {}

  async close(userId: string, memberships: Membership[]): Promise<void> {
    if (memberships.length === 0) {
      return;
    }

    const membershipIds = memberships.map(({ id }) => id);
    const workspaceIds = [
      ...new Set(memberships.map(({ workspaceId }) => workspaceId)),
    ];

    for (const id of membershipIds) {
      await this.coreEntityCacheService.invalidate('userWorkspaceEntity', id);
    }

    for (const workspaceId of workspaceIds) {
      await this.userSessionService.revokeAllSessionsForUser({
        userId,
        workspaceId,
        reason: UserSessionRevokedReason.UserRevoked,
      });
      await this.revokeRefreshTokens(userId, workspaceId);
      await this.closeStreams(userId, workspaceId);
    }

    await settleCoreEntityCache(
      this.coreEntityCacheService,
      'userWorkspaceEntity',
      membershipIds,
    );

    // A stream opened while the old membership was still served.
    for (const workspaceId of workspaceIds) {
      await this.closeStreams(userId, workspaceId);
    }
  }

  private async revokeRefreshTokens(userId: string, workspaceId: string) {
    await this.appTokenRepository
      .createQueryBuilder()
      .update()
      // The reason too: without it, a token already rotated is still renewable for a while.
      .set({
        revokedAt: () => `COALESCE("revokedAt", now())`,
        context: () =>
          `COALESCE("context", '{}'::jsonb) || jsonb_build_object('revokedReason', :revokedReason::text)`,
      })
      .where({
        userId,
        workspaceId,
        type: AppTokenType.RefreshToken,
        expiresAt: MoreThan(new Date()),
      })
      .setParameters({ revokedReason: UserSessionRevokedReason.UserRevoked })
      .execute();
  }

  private async closeStreams(userId: string, workspaceId: string) {
    const streams = await this.eventStreamService.getStreamsData(
      workspaceId,
      await this.eventStreamService.getActiveStreamIds(workspaceId),
    );

    for (const [eventStreamChannelId, stream] of streams) {
      if (stream?.authContext.userId === userId) {
        await this.eventStreamService.destroyEventStream({
          workspaceId,
          eventStreamChannelId,
        });
      }
    }
  }
}
