import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { AppPath } from 'twenty-shared/types';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { IsNull, Like, Repository } from 'typeorm';

import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { ApiKeyService } from 'src/engine/core-modules/api-key/services/api-key.service';
import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import {
  KeyValuePairEntity,
  KeyValuePairType,
} from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { OnboardingService } from 'src/engine/core-modules/onboarding/onboarding.service';
import { ThrottlerService } from 'src/engine/core-modules/throttler/throttler.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { UserService } from 'src/engine/core-modules/user/services/user.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { fromUserEntityToFlat } from 'src/engine/core-modules/user/utils/from-user-entity-to-flat.util';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { type WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

const RATE_LIMIT_PER_MINUTE = 10;
const ONE_MINUTE_MS = 60 * 1000;
const PROVISION_LOCK_MS = 5 * 60 * 1000;
const API_KEY_EXPIRES_AT = new Date('2099-01-01T00:00:00.000Z');

// The Hub is the only source of identity. These links live in core.keyValuePair so
// the fork carries no schema of its own: one key per Hub user, one key per tenant.
const hubUserKey = (hubUserId: string) => `veridian.hub_user:${hubUserId}`;
const hubTenantKey = (tenantId: string) => `veridian.hub_tenant:${tenantId}`;

type TenantLink = { ownerEmail: string; apiKeyId: string | null };

export type ProvisionResult =
  | { status: 'conflict' | 'in_progress' | 'identity_conflict' }
  | {
      status: 'ok';
      created: boolean;
      workspaceId: string;
      ownerUserId: string;
      apiKey: string | null;
      magicLink: string;
    };

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
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(KeyValuePairEntity)
    private readonly keyValuePairRepository: Repository<KeyValuePairEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    @InjectCacheStorage(CacheStorageNamespace.EngineAuthSession)
    private readonly cacheStorage: CacheStorageService,
    private readonly loginTokenService: LoginTokenService,
    private readonly workspaceDomainsService: WorkspaceDomainsService,
    private readonly throttlerService: ThrottlerService,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly signInUpService: SignInUpService,
    private readonly workspaceService: WorkspaceService,
    private readonly onboardingService: OnboardingService,
    private readonly userService: UserService,
    private readonly userWorkspaceService: UserWorkspaceService,
    private readonly apiKeyService: ApiKeyService,
    private readonly coreEntityCacheService: CoreEntityCacheService,
    private readonly workspaceOrmManager: WorkspaceOrmManager,
  ) {}

  // ── Identity: hub_user_id first, email only to bind an account with no link yet.
  private async findUserByHubUserId(hubUserId: string) {
    const link = await this.keyValuePairRepository.findOne({
      where: { key: hubUserKey(hubUserId), workspaceId: IsNull() },
    });

    return link?.userId
      ? this.userRepository.findOne({ where: { id: link.userId } })
      : null;
  }

  private async bindHubUser(userId: string, hubUserId: string) {
    await this.keyValuePairRepository.save({
      key: hubUserKey(hubUserId),
      userId,
      workspaceId: null,
      value: {} as JSON,
      type: KeyValuePairType.USER_VARIABLE,
    });
  }

  // Returns null when the email belongs to an account bound to another Hub user:
  // an email alone must never open an account that the Hub attributes to someone else.
  private async resolveUser(
    hubUserId: string,
    rawEmail: string,
  ): Promise<UserEntity | null | undefined> {
    const linked = await this.findUserByHubUserId(hubUserId);

    if (linked) {
      return linked;
    }

    const byEmail = await this.userRepository.findOne({
      where: { email: rawEmail.toLowerCase() },
    });

    if (!byEmail) {
      return undefined;
    }

    const otherLink = await this.keyValuePairRepository.findOne({
      where: {
        key: Like('veridian.hub_user:%'),
        userId: byEmail.id,
        workspaceId: IsNull(),
      },
    });

    if (otherLink) {
      return null;
    }

    await this.bindHubUser(byEmail.id, hubUserId);

    return byEmail;
  }

  private async buildMagicLink(email: string, workspaceId: string) {
    const { token } = await this.loginTokenService.generateLoginToken(
      email,
      workspaceId,
      AuthProviderEnum.Password,
    );

    const url = new URL(
      '/auth/token',
      this.twentyConfigService.get('SERVER_URL'),
    );

    url.searchParams.set('t', token);

    return url.toString();
  }

  // CONTRAT-HUB §6bis.8.3: never creates anything, null lets the Hub run its signup flow.
  async issueMagicLinkUrl(
    hubUserId: string,
    rawEmail: string,
  ): Promise<string | null> {
    await this.throttlerService.tokenBucketThrottleOrThrow(
      `veridian-hub-sso:issue-magic-link:${hubUserId}`,
      1,
      RATE_LIMIT_PER_MINUTE,
      ONE_MINUTE_MS,
    );

    const user = await this.resolveUser(hubUserId, rawEmail);

    if (!user || user.disabled) {
      return null;
    }

    const [lastActiveMembership] = await this.userWorkspaceRepository.query(
      `SELECT uw."workspaceId"
         FROM core."userWorkspace" uw
         JOIN core.workspace w ON w.id = uw."workspaceId"
         LEFT JOIN core."userSession" s ON s."userWorkspaceId" = uw.id
        WHERE uw."userId" = $1
          AND uw."deletedAt" IS NULL
          AND w."deletedAt" IS NULL
          AND w."activationStatus" = $2
        GROUP BY uw."workspaceId", uw."createdAt"
        ORDER BY MAX(s."lastActiveAt") DESC NULLS LAST, uw."createdAt" DESC
        LIMIT 1`,
      [user.id, WorkspaceActivationStatus.ACTIVE],
    );

    return lastActiveMembership
      ? this.buildMagicLink(user.email, lastActiveMembership.workspaceId)
      : null;
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

  // Twenty offers server admin to the first account ever created. Here admins come
  // from the Hub side, by configuration, never from the order of provisioning.
  private async applyServerAdminFlag(user: UserEntity) {
    const isAdmin = (process.env.HUB_SERVER_ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .includes(user.email.toLowerCase());

    if (
      user.canAccessFullAdminPanel === isAdmin &&
      user.canImpersonate === isAdmin
    ) {
      return;
    }

    await this.userRepository.update(user.id, {
      canAccessFullAdminPanel: isAdmin,
      canImpersonate: isAdmin,
    });
    await this.coreEntityCacheService.invalidate('user', user.id);
  }

  private async clearOnboarding(userId: string, workspaceId: string) {
    const step = { userId, workspaceId, value: false };

    await this.onboardingService.setOnboardingCreateProfilePending(step);
    await this.onboardingService.setOnboardingConnectAccountPending(step);
    await this.onboardingService.setOnboardingInviteTeamPending(step);
    await this.onboardingService.setOnboardingBookCallPending(step);
  }

  private newUserPayload(rawEmail: string) {
    const email = rawEmail.toLowerCase();

    return {
      type: 'newUserWithPicture' as const,
      newUserWithPicture: {
        email,
        firstName: email.split('@')[0],
        lastName: '',
        isEmailVerified: true,
      },
    };
  }

  private async findTenant(tenantId: string) {
    const link = await this.keyValuePairRepository.findOne({
      where: { key: hubTenantKey(tenantId), userId: IsNull() },
    });

    return link?.workspaceId
      ? {
          workspaceId: link.workspaceId,
          value: link.value as unknown as TenantLink,
        }
      : null;
  }

  // CONTRAT-HUB §5.1.
  async provisionTenant({
    tenantId,
    ownerEmail,
    workspaceName,
    hubUserId,
  }: {
    tenantId: string;
    ownerEmail: string;
    workspaceName: string;
    hubUserId: string;
  }): Promise<ProvisionResult> {
    const existing = await this.findTenant(tenantId);

    if (existing) {
      if (existing.value.ownerEmail !== ownerEmail.toLowerCase()) {
        return { status: 'conflict' };
      }

      const owner = await this.resolveUser(hubUserId, ownerEmail);

      if (!owner) {
        return { status: 'identity_conflict' };
      }

      return {
        status: 'ok',
        created: false,
        workspaceId: existing.workspaceId,
        ownerUserId: owner.id,
        apiKey: await this.issueApiKeyToken(
          existing.workspaceId,
          existing.value.apiKeyId,
        ),
        magicLink: await this.buildMagicLink(owner.email, existing.workspaceId),
      };
    }

    // Creating a workspace takes tens of seconds: a Hub retry must not create a second one.
    const isFirstCall = await this.cacheStorage.setIfAbsent(
      `veridian-hub-sso:provision:${tenantId}`,
      true,
      PROVISION_LOCK_MS,
    );

    if (!isFirstCall) {
      return { status: 'in_progress' };
    }

    try {
      const known = await this.resolveUser(hubUserId, ownerEmail);

      if (known === null) {
        return { status: 'identity_conflict' };
      }

      const { user, workspace } =
        await this.signInUpService.signUpOnNewWorkspace(
          known
            ? { type: 'existingUser', existingUser: known }
            : this.newUserPayload(ownerEmail),
          { displayName: workspaceName },
        );

      if (!known) {
        await this.bindHubUser(user.id, hubUserId);
      }

      await this.applyServerAdminFlag(user);

      const activated = await this.workspaceService.activateWorkspace(
        fromUserEntityToFlat(user),
        workspace,
      );

      if (!activated) {
        throw new Error(`Workspace ${workspace.id} could not be activated`);
      }

      await this.workspaceRepository.update(workspace.id, {
        isPublicInviteLinkEnabled: false,
      });
      await this.coreEntityCacheService.invalidate(
        'workspaceEntity',
        workspace.id,
      );
      await this.clearOnboarding(user.id, workspace.id);

      // The tenant link is written first: a failure below must not create a second workspace.
      const tenantLink = await this.keyValuePairRepository.save({
        key: hubTenantKey(tenantId),
        userId: null,
        workspaceId: workspace.id,
        value: {
          ownerEmail: ownerEmail.toLowerCase(),
          apiKeyId: null,
        } as unknown as JSON,
        type: KeyValuePairType.USER_VARIABLE,
      });

      // Member roles cannot hold an API key in Twenty: the key takes the first role allowed to.
      const apiKeyRole = await this.roleRepository.findOne({
        where: { workspaceId: workspace.id, canBeAssignedToApiKeys: true },
        order: { createdAt: 'ASC' },
      });

      const apiKey = apiKeyRole
        ? await this.apiKeyService.create({
            name: 'Hub Veridian',
            expiresAt: API_KEY_EXPIRES_AT,
            revokedAt: undefined,
            roleId: apiKeyRole.id,
            workspaceId: workspace.id,
          })
        : null;

      if (apiKey) {
        await this.keyValuePairRepository.update(tenantLink.id as string, {
          value: {
            ownerEmail: ownerEmail.toLowerCase(),
            apiKeyId: apiKey.id,
          } as never,
        });
      }

      return {
        status: 'ok',
        created: true,
        workspaceId: workspace.id,
        ownerUserId: user.id,
        apiKey: await this.issueApiKeyToken(workspace.id, apiKey?.id ?? null),
        magicLink: await this.buildMagicLink(user.email, workspace.id),
      };
    } finally {
      await this.cacheStorage.del(`veridian-hub-sso:provision:${tenantId}`);
    }
  }

  private async issueApiKeyToken(
    workspaceId: string,
    apiKeyId: string | null,
  ) {
    if (!apiKeyId) {
      return null;
    }

    const issued = await this.apiKeyService.generateApiKeyToken(
      workspaceId,
      apiKeyId,
      API_KEY_EXPIRES_AT,
    );

    return issued?.token ?? null;
  }

  // CONTRAT-HUB §5.18.3 and §5.22.2. Additive and idempotent: a member stays a member.
  async attachMember({
    workspaceId,
    hubUserId,
    email,
  }: {
    workspaceId: string;
    hubUserId: string;
    email: string;
  }): Promise<
    | { status: 'workspace_not_found' | 'identity_conflict' }
    | {
        status: 'ok';
        userId: string;
        alreadyMember: boolean;
        loginUrl: string;
      }
  > {
    const workspace = await this.workspaceRepository.findOne({
      where: { id: workspaceId },
    });

    if (!workspace) {
      return { status: 'workspace_not_found' };
    }

    const known = await this.resolveUser(hubUserId, email);

    if (known === null) {
      return { status: 'identity_conflict' };
    }

    const alreadyMember = known
      ? Boolean(
          await this.userWorkspaceService.checkUserWorkspaceExists(
            known.id,
            workspace.id,
          ),
        )
      : false;

    const user = await this.signInUpService.signInUpOnExistingWorkspace({
      workspace,
      userData: known
        ? { type: 'existingUser', existingUser: known }
        : this.newUserPayload(email),
    });

    if (!known) {
      await this.bindHubUser(user.id, hubUserId);
      await this.applyServerAdminFlag(user);
    }

    if (!alreadyMember) {
      await this.clearOnboarding(user.id, workspace.id);
    }

    return {
      status: 'ok',
      userId: user.id,
      alreadyMember,
      loginUrl: await this.buildMagicLink(user.email, workspace.id),
    };
  }

  async findWorkspaceIdByTenant(tenantId: string) {
    return (await this.findTenant(tenantId))?.workspaceId ?? null;
  }

  // CONTRAT-HUB §5.19.2: soft delete, the member's records stay in the workspace.
  async removeMember(workspaceId: string, email: string) {
    const user = await this.userRepository.findOne({
      where: { email: email.toLowerCase() },
    });
    const membership = user
      ? await this.userWorkspaceRepository.findOne({
          where: { userId: user.id, workspaceId },
        })
      : null;

    if (membership) {
      await this.userWorkspaceService.deleteUserWorkspace({
        userWorkspaceId: membership.id,
        workspaceId,
        softDelete: true,
      });
    }

    return Boolean(membership);
  }

  // Hub to Twenty profile copy. Email and name only change through here.
  async syncProfile({
    hubUserId,
    email,
    firstName,
    lastName,
  }: {
    hubUserId: string;
    email?: string;
    firstName?: string;
    lastName?: string;
  }) {
    const user = await this.findUserByHubUserId(hubUserId);

    if (!user) {
      return false;
    }

    if (email && email.toLowerCase() !== user.email) {
      await this.userService.updateEmailFromVerificationToken(
        user.id,
        email.toLowerCase(),
      );
    }

    if (firstName === undefined && lastName === undefined) {
      return true;
    }

    const name = {
      firstName: firstName ?? user.firstName,
      lastName: lastName ?? user.lastName,
    };

    await this.userRepository.update(user.id, name);
    await this.coreEntityCacheService.invalidate('user', user.id);

    const memberships = await this.userWorkspaceRepository.find({
      where: { userId: user.id },
    });

    for (const { workspaceId } of memberships) {
      await this.workspaceOrmManager.executeInWorkspaceContext(async () => {
        const repository =
          this.workspaceOrmManager.getRepositoryWithoutPermissionChecks<WorkspaceMemberWorkspaceEntity>(
            'workspaceMember',
          );

        await repository.update({ userId: user.id }, { name });
      }, buildSystemAuthContext(workspaceId));
    }

    return true;
  }
}
