import {
  decidePlanUpdate,
  type PlanUpdateDecision,
  type PlanUpdateRequest,
  type StoredPlan,
} from 'src/engine/core-modules/veridian-hub-sso/utils/decide-plan-update.util';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { AppPath, SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import {
  isWorkspaceProvisioned,
  WorkspaceActivationStatus,
} from 'twenty-shared/workspace';
import { IsNull, Like, Repository } from 'typeorm';

import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { isMagicLinkRefusedForSuspension } from 'src/engine/core-modules/veridian-hub-sso/utils/is-magic-link-refused-for-suspension.util';
import { parseServerAdmins } from 'src/engine/core-modules/veridian-hub-sso/utils/parse-server-admins.util';
import { parseOwnUrl } from 'src/engine/core-modules/veridian-hub-sso/utils/parse-own-url.util';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import {
  KeyValuePairEntity,
  KeyValuePairType,
} from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { OnboardingService } from 'src/engine/core-modules/onboarding/onboarding.service';
import { ThrottlerService } from 'src/engine/core-modules/throttler/throttler.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserSessionService } from 'src/engine/core-modules/user-session/services/user-session.service';
import { UserSessionRevokedReason } from 'src/engine/core-modules/user-session/types/user-session-revoked-reason.type';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { UserService } from 'src/engine/core-modules/user/services/user.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { fromUserEntityToFlat } from 'src/engine/core-modules/user/utils/from-user-entity-to-flat.util';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { VeridianHubMemberAccessService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-member-access.service';
import { VeridianHubRoleService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-role.service';
import { HUB_ROLE_CARRIED_KEY } from 'src/engine/core-modules/veridian-hub-sso/utils/assert-role-not-carried-by-hub.util';
import { HUB_ROLE_KEY } from 'src/engine/core-modules/veridian-hub-sso/utils/parse-hub-organisations.util';
import { STANDARD_ROLE } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

const RATE_LIMIT_PER_MINUTE = 10;
const ONE_MINUTE_MS = 60 * 1000;
const POSTGRES_UNIQUE_VIOLATION = '23505';
const PROVISION_LOCK_MS = 5 * 60 * 1000;

// The Hub is the only source of identity. These links live in core.keyValuePair so
// the fork carries no schema of its own: one key per Hub user, one key per tenant.
export const WORKSPACE_SUSPENDED_LINK = 'workspace_suspended' as const;

const hubUserKey = (hubUserId: string) => `veridian.hub_user:${hubUserId}`;
export const hubTenantKey = (tenantId: string) =>
  `veridian.hub_tenant:${tenantId}`;

// ownerHubUserId: undefined = not converted yet, null = converted once with no match, never guessed again.
type TenantLink = {
  ownerEmail: string;
  ownerHubUserId?: string | null;
} & StoredPlan;

export type ProvisionResult =
  | { status: 'owner_mismatch' | 'in_progress' | 'hub_user_conflict' }
  | {
      status: 'ok';
      created: boolean;
      workspaceId: string;
      ownerUserId: string;
      magicLink: string;
    };

@Injectable()
export class VeridianHubSsoService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VeridianHubSsoService.name);

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
    private readonly coreEntityCacheService: CoreEntityCacheService,
    private readonly workspaceOrmManager: WorkspaceOrmManager,
    private readonly userSessionService: UserSessionService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly veridianHubRoleService: VeridianHubRoleService,
    private readonly veridianHubMemberAccessService: VeridianHubMemberAccessService,
  ) {}

  // CONTRAT-HUB §5.19.7: an owner recorded by email is converted once, by the linked local copy. A row with no match is
  // marked and counted, so that an email taken over later by someone else never makes them the owner.
  async onApplicationBootstrap() {
    try {
      const [rows] = await this.keyValuePairRepository.query(
        `UPDATE core."keyValuePair" k
            SET value = k.value || jsonb_build_object('ownerHubUserId',
                  (SELECT CASE WHEN count(*) = 1 THEN min(substr(l.key, $1)) END
                     FROM core."user" u
                     JOIN core."keyValuePair" l
                       ON l."userId" = u.id AND l."workspaceId" IS NULL AND l.key LIKE 'veridian.hub_user:%'
                    WHERE u.email = k.value->>'ownerEmail' AND u."deletedAt" IS NULL))
          WHERE k.key LIKE 'veridian.hub_tenant:%' AND k."userId" IS NULL AND NOT k.value ? 'ownerHubUserId'
      RETURNING k.value->>'ownerHubUserId' AS owner`,
        ['veridian.hub_user:'.length + 1],
      );

      if (rows.length > 0) {
        this.logger.log(
          `Hub owners converted: ${rows.length}, without a match: ${
            rows.filter(({ owner }: { owner: string | null }) => !owner).length
          }`,
        );
      }
    } catch (error) {
      this.logger.error(`Hub owners conversion failed: ${error}`);
    }
  }

  // ── Identity: by hub_user_id alone. An email only binds an account with no link yet, and only a proven one.
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

  // Returns null when the email belongs to an account bound to another Hub user, or to an account with no link when the
  // Hub did not say the email is proven: an email alone must never open someone else's account.
  private async resolveUser(
    hubUserId: string,
    rawEmail: string,
    emailProven: boolean,
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

    if (otherLink || !emailProven) {
      return null;
    }

    await this.bindHubUser(byEmail.id, hubUserId);

    return byEmail;
  }

  private async buildMagicLink(
    email: string,
    workspaceId: string,
    nextPath?: string,
  ) {
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

    if (nextPath) {
      url.searchParams.set('next', nextPath);
    }

    return url.toString();
  }

  // CONTRAT-HUB §6bis.8.3: never creates anything, null lets the Hub run its signup flow.
  async issueMagicLinkUrl(
    hubUserId: string,
    rawEmail: string,
    next?: unknown,
    emailProven = false,
  ): Promise<string | null | typeof WORKSPACE_SUSPENDED_LINK> {
    await this.throttlerService.tokenBucketThrottleOrThrow(
      `veridian-hub-sso:issue-magic-link:${hubUserId}`,
      1,
      RATE_LIMIT_PER_MINUTE,
      ONE_MINUTE_MS,
    );

    const user = await this.resolveUser(hubUserId, rawEmail, emailProven);

    if (!user || user.disabled) {
      return null;
    }

    const ownNext = parseOwnUrl(
      next,
      this.twentyConfigService.get('SERVER_URL'),
    );

    const requestedSubdomain = ownNext?.subdomain ?? null;

    // CONTRAT-HUB §5.21 : 423 seulement si l'espace demandé est suspendu, ou si tous les espaces du membre le sont.
    // Un membre qui a un espace actif entre toujours, dans celui-là.
    const memberships: { subdomain: string; activationStatus: string }[] =
      await this.userWorkspaceRepository.query(
        `SELECT w.subdomain, w."activationStatus"
           FROM core."userWorkspace" uw
           JOIN core.workspace w ON w.id = uw."workspaceId"
          WHERE uw."userId" = $1 AND uw."deletedAt" IS NULL AND w."deletedAt" IS NULL`,
        [user.id],
      );

    if (isMagicLinkRefusedForSuspension(memberships, requestedSubdomain)) {
      return WORKSPACE_SUSPENDED_LINK;
    }

    // The workspace the user asked for wins, if he belongs to it. Otherwise the last active one.
    const [lastActiveMembership] = await this.userWorkspaceRepository.query(
      `SELECT uw."workspaceId"
         FROM core."userWorkspace" uw
         JOIN core.workspace w ON w.id = uw."workspaceId"
         LEFT JOIN core."userSession" s ON s."userWorkspaceId" = uw.id
        WHERE uw."userId" = $1
          AND uw."deletedAt" IS NULL
          AND w."deletedAt" IS NULL
          AND w."activationStatus" = $2
        GROUP BY uw."workspaceId", uw."createdAt", w.subdomain
        ORDER BY (w.subdomain = $3) DESC NULLS LAST,
                 MAX(s."lastActiveAt") DESC NULLS LAST,
                 uw."createdAt" DESC
        LIMIT 1`,
      [user.id, WorkspaceActivationStatus.ACTIVE, requestedSubdomain],
    );

    return lastActiveMembership
      ? this.buildMagicLink(
          user.email,
          lastActiveMembership.workspaceId,
          ownNext?.path,
        )
      : null;
  }

  // The token stays unconsumed here: /verify on the workspace domain consumes it.
  async resolveRedirectUrl(
    token: string,
    nextPath?: string,
  ): Promise<string | null> {
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
          searchParams: {
            loginToken: token,
            ...(nextPath?.startsWith('/') && !nextPath.startsWith('//')
              ? { returnToPath: nextPath }
              : {}),
          },
        })
        .toString();
    } catch {
      return null;
    }
  }

  // Twenty offers server admin to the first account ever created. Here admins come
  // from the Hub side, by configuration, never from the order of provisioning.
  // They are named by their hub_user_id: an email changes hands, the right must not.
  private async applyServerAdminFlag(user: UserEntity, hubUserId: string) {
    const admins = parseServerAdmins(process.env.HUB_SERVER_ADMIN_HUB_USER_IDS);

    if (!admins) {
      this.logger.error('HUB_SERVER_ADMIN_HUB_USER_IDS unreadable');

      return;
    }

    const isAdmin = admins.has(hubUserId.toLowerCase());

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
    // Set per workspace at sign-up, not per user: the user id must stay out of this one.
    await this.onboardingService.setOnboardingInviteTeamPending({
      workspaceId,
      value: false,
    });
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

  // CONTRAT-BILLING v2 §3: stored on the tenant link, read back by the Hub reconcile, limits nothing.
  async updateTenantPlan(body: PlanUpdateRequest): Promise<PlanUpdateDecision> {
    const tenantId = typeof body.tenant_id === 'string' ? body.tenant_id : '';
    const link = tenantId
      ? await this.keyValuePairRepository.findOne({
          where: { key: hubTenantKey(tenantId), userId: IsNull() },
        })
      : null;
    const current = (link?.value as unknown as TenantLink | undefined) ?? null;
    const decision = decidePlanUpdate(body, current, new Date());

    if (decision.kind === 'apply' && link) {
      await this.keyValuePairRepository.update(link.id, {
        value: { ...current, ...decision.next } as unknown as JSON,
      });
    }

    return decision;
  }

  // CONTRAT-HUB §5.1.
  async provisionTenant({
    tenantId,
    ownerEmail,
    workspaceName,
    hubUserId,
    plan,
    emailProven,
  }: {
    tenantId: string;
    ownerEmail: string;
    workspaceName: string;
    hubUserId: string;
    plan: string;
    emailProven: boolean;
  }): Promise<ProvisionResult> {
    const existing = await this.findTenant(tenantId);

    if (existing) {
      const owner = await this.findUserByHubUserId(hubUserId);

      if (!owner || existing.value.ownerHubUserId !== hubUserId) {
        return { status: 'owner_mismatch' };
      }

      return {
        status: 'ok',
        created: false,
        workspaceId: existing.workspaceId,
        ownerUserId: owner.id,
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
      const known = await this.resolveUser(hubUserId, ownerEmail, emailProven);

      if (known === null) {
        return { status: 'hub_user_conflict' };
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

      await this.applyServerAdminFlag(user, hubUserId);

      const activated = await this.workspaceService.activateWorkspace(
        fromUserEntityToFlat(user),
        workspace,
      );

      if (!activated) {
        throw new Error(`Workspace ${workspace.id} could not be activated`);
      }

      await this.workspaceRepository.update(workspace.id, {
        isPublicInviteLinkEnabled: false,
        isPasswordAuthEnabled: false,
        editableProfileFields: ['profilePicture'],
      });
      await this.coreEntityCacheService.invalidate(
        'workspaceEntity',
        workspace.id,
      );
      await this.clearOnboarding(user.id, workspace.id);

      await this.keyValuePairRepository.save({
        key: hubTenantKey(tenantId),
        userId: null,
        workspaceId: workspace.id,
        value: {
          ownerEmail: ownerEmail.toLowerCase(),
          ownerHubUserId: hubUserId,
          plan,
        } as unknown as JSON,
        type: KeyValuePairType.USER_VARIABLE,
      });

      return {
        status: 'ok',
        created: true,
        workspaceId: workspace.id,
        ownerUserId: user.id,
        magicLink: await this.buildMagicLink(user.email, workspace.id),
      };
    } finally {
      await this.cacheStorage.del(`veridian-hub-sso:provision:${tenantId}`);
    }
  }

  // CONTRAT-HUB §5.18.3 and §5.22.2. Additive and idempotent: a member stays a member.
  async attachMember({
    workspaceId,
    hubUserId,
    email,
    emailProven,
  }: {
    workspaceId: string;
    hubUserId: string;
    email: string;
    emailProven: boolean;
  }): Promise<
    | {
        status:
          | 'workspace_not_found'
          | 'workspace_suspended'
          | 'hub_user_conflict';
      }
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

    if (workspace.activationStatus === WorkspaceActivationStatus.SUSPENDED) {
      return { status: 'workspace_suspended' };
    }

    const known = await this.resolveUser(hubUserId, email, emailProven);

    if (known === null) {
      return { status: 'hub_user_conflict' };
    }

    const alreadyMember = known
      ? Boolean(
          await this.userWorkspaceService.checkUserWorkspaceExists(
            known.id,
            workspace.id,
          ),
        )
      : false;

    if (known && !alreadyMember) {
      await this.updateMemberRecord(workspace, known.id, 'restore', known.email);
    }

    const user = await this.signInUpService.signInUpOnExistingWorkspace({
      workspace,
      userData: known
        ? { type: 'existingUser', existingUser: known }
        : this.newUserPayload(email),
    });

    if (!known) {
      await this.bindHubUser(user.id, hubUserId);
      await this.applyServerAdminFlag(user, hubUserId);
    }

    if (!alreadyMember) {
      await this.veridianHubRoleService.forgetRole(workspace.id, user.id);
      await this.clearOnboarding(user.id, workspace.id);
    }

    return {
      status: 'ok',
      userId: user.id,
      alreadyMember,
      loginUrl: await this.buildMagicLink(user.email, workspace.id),
    };
  }

  // CONTRAT-HUB §5 (DELETE): the workspace and its data go, the link goes with them.
  async deleteTenant(tenantId: string) {
    const tenant = await this.findTenant(tenantId);

    if (!tenant) {
      return false;
    }

    await this.workspaceService.deleteWorkspace(tenant.workspaceId);
    await this.keyValuePairRepository.delete({
      key: hubTenantKey(tenantId),
      userId: IsNull(),
    });

    return true;
  }

  async findWorkspaceIdByTenant(tenantId: string) {
    return (await this.findTenant(tenantId))?.workspaceId ?? null;
  }

  async describeMembership({
    workspaceId,
    hubUserId,
  }: {
    workspaceId: string;
    hubUserId: string;
  }): Promise<{
    isMember: boolean;
    isDisabled: boolean;
    removedAt: Date | null;
  }> {
    const user = await this.findUserByHubUserId(hubUserId);

    if (!user) {
      return { isMember: false, isDisabled: false, removedAt: null };
    }

    const memberships = await this.userWorkspaceRepository.find({
      where: { userId: user.id, workspaceId },
      withDeleted: true,
    });
    const removals = memberships
      .filter(({ deletedAt }) => deletedAt)
      .map(({ deletedAt }) => new Date(deletedAt).getTime());

    return {
      isMember: memberships.some(({ deletedAt }) => !deletedAt),
      isDisabled: Boolean(user.disabled),
      removedAt: removals.length > 0 ? new Date(Math.max(...removals)) : null,
    };
  }

  // CONTRAT-HUB §5.19.2: soft delete, the member's records stay in the workspace.
  async removeMember(workspaceId: string, hubUserId: string) {
    const user = await this.findUserByHubUserId(hubUserId);
    const membership = user
      ? await this.userWorkspaceRepository.findOne({
          where: { userId: user.id, workspaceId },
        })
      : null;

    if (user) {
      await this.detachMember(user.id, workspaceId, membership?.id);
      // Past memberships too: replayed after a cut, it finishes closing what the first call left open.
      await this.veridianHubMemberAccessService.close(
        user.id,
        await this.userWorkspaceRepository.find({
          where: { userId: user.id, workspaceId },
          withDeleted: true,
        }),
      );
    }

    return Boolean(membership);
  }

  // Removing a member never cuts a key: the Hub tells the owner how many still open the workspace.
  async describeApiKeys(workspaceId: string) {
    const [{ count }] = await this.userRepository.query(
      `SELECT count(*)::int AS count FROM core."apiKey"
        WHERE "workspaceId" = $1 AND "revokedAt" IS NULL AND "expiresAt" > now()`,
      [workspaceId],
    );
    const workspace = await this.workspaceRepository.findOneByOrFail({
      id: workspaceId,
    });

    return {
      active_api_keys: count,
      api_keys_url: this.workspaceDomainsService
        .buildWorkspaceURL({
          workspace,
          pathname: getSettingsPath(SettingsPath.Developers),
        })
        .toString(),
    };
  }

  // CONTRAT-HUB §3.8: found by hub_user_id only, only the fields present are applied.
  async syncUser({
    hubUserId,
    email,
    name,
    deleted,
    revokeSessions,
  }: {
    hubUserId: string;
    email?: string;
    name?: string;
    deleted?: boolean;
    revokeSessions?: boolean;
  }): Promise<'synced' | 'user_not_in_app' | 'email_conflict'> {
    const user = await this.findUserByHubUserId(hubUserId);

    if (!user) {
      return 'user_not_in_app';
    }

    if (deleted === true) {
      await this.cutAccess(user.id);

      return 'synced';
    }

    // The email first: when another account holds it, nothing else of the call is written.
    if (
      email &&
      email.toLowerCase() !== user.email &&
      !(await this.moveEmail(user.id, email.toLowerCase()))
    ) {
      return 'email_conflict';
    }

    if (revokeSessions === true) {
      await this.userSessionService.revokeAllSessionsForUser({
        userId: user.id,
        reason: UserSessionRevokedReason.UserRevoked,
      });
    }

    if (name === undefined) {
      return 'synced';
    }

    const [firstName, ...others] = name.trim().split(/\s+/);
    const fullName = { firstName, lastName: others.join(' ') };

    await this.userRepository.update(user.id, fullName);
    await this.coreEntityCacheService.invalidate('user', user.id);
    await this.writeMemberRecords(user.id, { name: fullName });

    return 'synced';
  }

  private async writeMemberRecords(
    userId: string,
    fields: Partial<Pick<WorkspaceMemberWorkspaceEntity, 'name' | 'userEmail'>>,
  ) {
    // The record of someone who left follows too: natively it still holds its email against the next comer.
    const memberships = await this.userWorkspaceRepository.find({
      where: { userId },
      withDeleted: true,
    });

    for (const workspaceId of new Set(
      memberships.map((membership) => membership.workspaceId),
    )) {
      const workspace = await this.workspaceRepository.findOne({
        where: { id: workspaceId },
      });

      if (!workspace || !isWorkspaceProvisioned(workspace)) {
        continue;
      }

      await this.workspaceOrmManager.executeInWorkspaceContext(async () => {
        const repository =
          this.workspaceOrmManager.getRepositoryWithoutPermissionChecks<WorkspaceMemberWorkspaceEntity>(
            'workspaceMember',
          );

        await repository.update({ userId }, fields);
      }, buildSystemAuthContext(workspaceId));
    }
  }

  private async moveEmail(userId: string, email: string): Promise<boolean> {
    if (await this.userRepository.findOne({ where: { email } })) {
      return false;
    }

    try {
      await this.userService.updateEmailFromVerificationToken(userId, email);
    } catch (error) {
      // Taken between the read and the write: the unique index speaks.
      if (error?.code === POSTGRES_UNIQUE_VIOLATION) {
        return false;
      }

      throw error;
    }

    // Natively a background job: until it runs, whoever takes the old email over cannot enter the workspace.
    await this.writeMemberRecords(userId, { userEmail: email });

    return true;
  }

  private async cutAccess(userId: string) {
    await this.userRepository.update(userId, { disabled: true });
    await this.coreEntityCacheService.invalidate('user', userId);
    await this.userSessionService.revokeAllSessionsForUser({
      userId,
      reason: UserSessionRevokedReason.UserRevoked,
    });

    const memberships = await this.userWorkspaceRepository.find({
      where: { userId },
      withDeleted: true,
    });

    for (const { id, workspaceId, deletedAt } of memberships) {
      if (!deletedAt) {
        await this.detachMember(userId, workspaceId, id);
      }
    }

    await this.veridianHubMemberAccessService.close(userId, memberships);
  }

  // A live workspaceMember with no live userWorkspace breaks GetCurrentUser for the whole workspace: both go
  // together. Called again, it also repairs a record left behind.
  private async detachMember(
    userId: string,
    workspaceId: string,
    userWorkspaceId?: string,
  ) {
    const workspace = await this.workspaceRepository.findOne({
      where: { id: workspaceId },
    });

    if (workspace) {
      await this.updateMemberRecord(workspace, userId, 'softDelete');
    }

    if (userWorkspaceId) {
      await this.userWorkspaceService.deleteUserWorkspace({
        userWorkspaceId,
        workspaceId,
        softDelete: true,
      });
    }
  }

  private async updateMemberRecord(
    workspace: WorkspaceEntity,
    userId: string,
    action: 'softDelete' | 'restore',
    email?: string,
  ) {
    if (!isWorkspaceProvisioned(workspace)) {
      return;
    }

    await this.workspaceOrmManager.executeInWorkspaceContext(async () => {
      const repository =
        this.workspaceOrmManager.getRepositoryWithoutPermissionChecks<WorkspaceMemberWorkspaceEntity>(
          'workspaceMember',
        );

      // Gone while the address changed: the record comes back under the address of today, the old one may be taken.
      if (email) {
        await repository.update({ userId }, { userEmail: email });
      }

      await repository[action]({ userId });
    }, buildSystemAuthContext(workspace.id));

    await this.workspaceCacheService.invalidateAndRecompute(workspace.id, [
      'flatWorkspaceMemberMaps',
    ]);
  }

  // CONTRAT-HUB §3.8: humans only, the audit needs the accounts with no Hub link too.
  async listUsers() {
    const rows: {
      key: string | null;
      email: string;
      firstName: string;
      lastName: string;
      serverAdmin: boolean;
    }[] = await this.userRepository.query(
      `SELECT k.key, u.email, u."firstName", u."lastName",
              (u."canAccessFullAdminPanel" OR u."canImpersonate") AS "serverAdmin"
         FROM core."user" u
         LEFT JOIN core."keyValuePair" k
           ON k."userId" = u.id AND k."workspaceId" IS NULL AND k.key LIKE 'veridian.hub_user:%'
        WHERE u."deletedAt" IS NULL AND u.disabled = false`,
    );

    return rows.map(({ key, email, firstName, lastName, serverAdmin }) => ({
      hub_user_id: key ? key.slice('veridian.hub_user:'.length) : null,
      email,
      name: `${firstName} ${lastName}`.trim(),
      server_admin: serverAdmin,
    }));
  }

  // CONTRAT-HUB §5.12 and §5.19.7: hub_user_id first, the email only when it is absent.
  async listWorkspaces({
    hubUserId,
    email,
  }: {
    hubUserId?: string;
    email?: string;
  }) {
    const rows: {
      workspaceId: string;
      displayName: string;
      subdomain: string;
      activationStatus: string;
      tenantKey: string | null;
      link: TenantLink | null;
      hubRole: string | null;
      nativeAdmin: boolean;
      roleCarried: boolean;
      isOwner: boolean;
    }[] = await this.userRepository.query(
      `SELECT w.id AS "workspaceId", w."displayName", w.subdomain, w."activationStatus",
              k.key AS "tenantKey", k.value AS link, r.value->>'role' AS "hubRole",
              EXISTS (SELECT 1 FROM core."roleTarget" rt JOIN core.role ro ON ro.id = rt."roleId"
                       WHERE rt."userWorkspaceId" = uw.id AND ro."universalIdentifier" = $2) AS "nativeAdmin",
              EXISTS (SELECT 1 FROM core."keyValuePair" c
                       WHERE c."workspaceId" = w.id AND c."userId" IS NULL AND c.key = $4) AS "roleCarried",
              EXISTS (SELECT 1 FROM core."keyValuePair" o
                       WHERE o."userId" = u.id AND o."workspaceId" IS NULL
                         AND o.key = 'veridian.hub_user:' || (k.value->>'ownerHubUserId')) AS "isOwner"
         FROM core."user" u
         JOIN core."userWorkspace" uw ON uw."userId" = u.id AND uw."deletedAt" IS NULL
         JOIN core.workspace w ON w.id = uw."workspaceId" AND w."deletedAt" IS NULL
         LEFT JOIN core."keyValuePair" k
           ON k."workspaceId" = w.id AND k."userId" IS NULL AND k.key LIKE 'veridian.hub_tenant:%'
         LEFT JOIN core."keyValuePair" r
           ON r."workspaceId" = w.id AND r."userId" = u.id AND r.key = $3
        WHERE ${
          hubUserId
            ? `EXISTS (SELECT 1 FROM core."keyValuePair" p
                       WHERE p."userId" = u.id AND p."workspaceId" IS NULL AND p.key = $1)`
            : 'u.email = $1'
        }
          AND u."deletedAt" IS NULL AND u.disabled = false`,
      [
        hubUserId ? hubUserKey(hubUserId) : (email ?? '').toLowerCase(),
        STANDARD_ROLE.admin.universalIdentifier,
        HUB_ROLE_KEY,
        HUB_ROLE_CARRIED_KEY,
      ],
    );

    return rows.map(
      ({
        workspaceId,
        displayName,
        subdomain,
        activationStatus,
        tenantKey,
        link,
        hubRole,
        nativeAdmin,
        roleCarried,
        isOwner,
      }) => ({
        workspace_id: workspaceId,
        tenant_id: tenantKey
          ? tenantKey.slice('veridian.hub_tenant:'.length)
          : null,
        hub_tenant_id: tenantKey
          ? tenantKey.slice('veridian.hub_tenant:'.length)
          : null,
        workspace_name: displayName,
        subdomain,
        role: isOwner ? 'owner' : 'member',
        hub_role: hubRole,
        native_admin: nativeAdmin,
        role_carried: roleCarried,
        plan: link?.plan ?? null,
        plan_source: link?.planSource ?? null,
        trial_status: link?.trialStatus ?? null,
        trial_ends_at: link?.trialEndsAt ?? null,
        status: activationStatus.toLowerCase(),
      }),
    );
  }
}
