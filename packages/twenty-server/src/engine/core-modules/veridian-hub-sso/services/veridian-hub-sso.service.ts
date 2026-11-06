import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { AppPath } from 'twenty-shared/types';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { Repository } from 'typeorm';

import { LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { ThrottlerService } from 'src/engine/core-modules/throttler/throttler.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';

const RATE_LIMIT_PER_MINUTE = 10;
const ONE_MINUTE_MS = 60 * 1000;

@Injectable()
export class VeridianHubSsoService {
  constructor(
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly loginTokenService: LoginTokenService,
    private readonly workspaceDomainsService: WorkspaceDomainsService,
    private readonly throttlerService: ThrottlerService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  // Never creates a workspace (CONTRAT-HUB §6bis.8.3): returns null when the
  // email has no active workspace here, and the Hub handles the signup flow.
  async issueMagicLinkUrl(rawEmail: string): Promise<string | null> {
    const email = rawEmail.toLowerCase();

    await this.throttlerService.tokenBucketThrottleOrThrow(
      `veridian-hub-sso:issue-magic-link:${email}`,
      1,
      RATE_LIMIT_PER_MINUTE,
      ONE_MINUTE_MS,
    );

    const user = await this.userRepository.findOne({ where: { email } });

    if (!user || user.disabled) {
      return null;
    }

    const lastActiveMembership = await this.userWorkspaceRepository
      .createQueryBuilder('userWorkspace')
      .innerJoin('userWorkspace.workspace', 'workspace')
      .leftJoin(
        'core.userSession',
        'session',
        'session."userWorkspaceId" = "userWorkspace"."id"',
      )
      .select('userWorkspace.workspaceId', 'workspaceId')
      .where('userWorkspace.userId = :userId', { userId: user.id })
      .andWhere('workspace.activationStatus = :status', {
        status: WorkspaceActivationStatus.ACTIVE,
      })
      .groupBy('userWorkspace.workspaceId')
      .addGroupBy('userWorkspace.createdAt')
      .orderBy('MAX(session."lastActiveAt")', 'DESC', 'NULLS LAST')
      .addOrderBy('userWorkspace.createdAt', 'DESC')
      .getRawOne<{ workspaceId: string }>();

    if (!lastActiveMembership) {
      return null;
    }

    const { token } = await this.loginTokenService.generateLoginToken(
      user.email,
      lastActiveMembership.workspaceId,
      AuthProviderEnum.Password,
    );

    const url = new URL(
      `/auth/token`,
      this.twentyConfigService.get('SERVER_URL'),
    );

    url.searchParams.set('t', token);

    return url.toString();
  }

  // The token stays unconsumed here: /verify on the workspace domain consumes it.
  async resolveRedirectUrl(token: string): Promise<string | null> {
    try {
      const { workspaceId } =
        await this.loginTokenService.verifyLoginToken(token);

      const workspace = await this.workspaceRepository.findOne({
        where: { id: workspaceId },
      });

      if (!workspace) {
        return null;
      }

      return this.workspaceDomainsService
        .buildWorkspaceURL({
          workspace,
          pathname: AppPath.Verify,
          searchParams: { loginToken: token },
        })
        .toString();
    } catch {
      return null;
    }
  }
}
