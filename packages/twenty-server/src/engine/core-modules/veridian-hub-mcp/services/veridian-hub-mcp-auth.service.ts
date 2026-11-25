import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { IsNull, Repository } from 'typeorm';

import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { ApplicationTokenService } from 'src/engine/core-modules/auth/token/services/application-token.service';
import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { VeridianDelegatedAppService } from 'src/engine/core-modules/veridian-hub-mcp/services/veridian-delegated-app.service';
import {
  type HubDelegation,
  findDelegatedApplication,
  isDelegatedCallAllowed,
  readDelegation,
} from 'src/engine/core-modules/veridian-hub-mcp/utils/read-delegation.util';
import {
  type HubJwk,
  type HubMcpClaims,
  isHubMcpToken,
  verifyHubMcpToken,
} from 'src/engine/core-modules/veridian-hub-mcp/utils/verify-hub-mcp-token.util';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';

const JWKS_MAX_AGE_MS = 60 * 60 * 1000;
const JWKS_MIN_REFRESH_MS = 60 * 1000;
const JWKS_FETCH_TIMEOUT_MS = 5000;
const MAX_CACHED_TOKENS = 1000;
const USED_JTI_TTL_MS = 5 * 60 * 1000;
// Longer than the 120 s a function may run, no more.
const INTEGRATION_TOKEN_EXPIRES_IN = '3m';

export type HubMcpAuthResult =
  | { kind: 'not_hub' }
  | {
      kind: 'ok';
      accessToken: string;
      workspaceId: string;
      delegation?: HubDelegation;
    }
  | {
      kind: 'refused';
      status: 401 | 403 | 503;
      error: string;
      message: string;
    };

@Injectable()
export class VeridianHubMcpAuthService {
  private readonly logger = new Logger(VeridianHubMcpAuthService.name);
  private jwks: { keys: HubJwk[]; fetchedAt: number } | null = null;
  // One Hub JWT serves a whole MCP exchange (initialize, tools/list, tools/call) for 5 min.
  private readonly accessTokensByJti = new Map<
    string,
    { accessToken: string; workspaceId: string; expiresAt: number }
  >();

  constructor(
    private readonly accessTokenService: AccessTokenService,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(KeyValuePairEntity)
    private readonly keyValuePairRepository: Repository<KeyValuePairEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    @InjectCacheStorage(CacheStorageNamespace.EngineAuthSession)
    private readonly cacheStorage: CacheStorageService,
    private readonly delegatedAppService: VeridianDelegatedAppService,
    private readonly applicationTokenService: ApplicationTokenService,
  ) {}

  private get issuer() {
    return process.env.VERIDIAN_HUB_MCP_ISSUER ?? '';
  }

  private get audience() {
    return process.env.VERIDIAN_HUB_MCP_AUDIENCE ?? '';
  }

  async authenticate(
    token: string,
    body?: Parameters<typeof isDelegatedCallAllowed>[1],
  ): Promise<HubMcpAuthResult> {
    if (!this.issuer || !this.audience || !isHubMcpToken(token, this.issuer)) {
      return { kind: 'not_hub' };
    }

    const check = await this.verify(token);

    if (!check.ok) {
      this.logger.warn(`Hub MCP token refused: ${check.reason}`);

      return check.unavailable
        ? {
            kind: 'refused',
            status: 503,
            error: 'hub_jwks_unavailable',
            message: 'Hub signing keys are unreachable, retry later.',
          }
        : {
            kind: 'refused',
            status: 401,
            error: 'invalid_hub_token',
            message: `Hub token refused: ${check.reason}.`,
          };
    }

    const { claims } = check;
    const delegationCheck = readDelegation(claims);

    if (delegationCheck.kind === 'refused') {
      this.logger.warn(`Hub action token refused: ${delegationCheck.error}`);

      return delegationCheck;
    }

    if (delegationCheck.kind === 'ok') {
      return this.authenticateAction(claims, delegationCheck.delegation, body);
    }

    const cached = claims.jti ? this.accessTokensByJti.get(claims.jti) : null;

    if (cached && cached.expiresAt > Date.now()) {
      return {
        kind: 'ok',
        accessToken: cached.accessToken,
        workspaceId: cached.workspaceId,
      };
    }

    const result = await this.mintAccessToken(claims);

    if (result.kind === 'ok' && claims.jti) {
      this.remember(claims.jti, result, claims.exp * 1000);
    }

    return result;
  }

  // One action token, one call: bounded to its tool by app and scope, never cached, never replayed.
  private async authenticateAction(
    claims: HubMcpClaims,
    delegation: HubDelegation,
    body: Parameters<typeof isDelegatedCallAllowed>[1],
  ): Promise<HubMcpAuthResult> {
    const trace = `app=${delegation.app} jti=${delegation.jti} sub=${claims.sub} tenant=${claims.tenant_id}`;

    if (!isDelegatedCallAllowed(delegation, body)) {
      this.logger.warn(`Hub action refused: delegation_forbidden ${trace}`);

      return {
        kind: 'refused',
        status: 403,
        error: 'delegation_forbidden',
        message: 'This action token does not allow this call.',
      };
    }

    const isFirstUse = await this.cacheStorage.setIfAbsent(
      `veridian-hub-act:${delegation.jti}`,
      true,
      USED_JTI_TTL_MS,
    );

    if (!isFirstUse) {
      this.logger.warn(`Hub action refused: token_replayed ${trace}`);

      return {
        kind: 'refused',
        status: 401,
        error: 'token_replayed',
        message: 'This action token was already used.',
      };
    }

    const result =
      delegation.subject === 'integration'
        ? await this.resolveIntegrationWorkspace(claims)
        : await this.mintAccessToken(claims);

    this.logger.log(`Hub action ${result.kind} ${trace}`);

    if (result.kind !== 'ok') {
      return result;
    }

    const applicationUniversalIdentifier = findDelegatedApplication(
      body?.params?.name,
    );

    if (applicationUniversalIdentifier) {
      const app = await this.delegatedAppService.ensureInstalled({
        applicationUniversalIdentifier,
        workspaceId: result.workspaceId,
      });

      if (app.kind === 'refused') {
        this.logger.warn(`Hub action refused: ${app.error} ${trace}`);

        return app;
      }

      if (delegation.subject === 'integration') {
        const { token } =
          await this.applicationTokenService.generateApplicationAccessToken({
            workspaceId: result.workspaceId,
            applicationId: app.applicationId,
            expiresIn: INTEGRATION_TOKEN_EXPIRES_IN,
          });

        return { ...result, accessToken: token, delegation };
      }
    }

    return { ...result, delegation };
  }

  private async verify(
    token: string,
  ): Promise<
    | { ok: true; claims: HubMcpClaims }
    | { ok: false; reason: string; unavailable?: boolean }
  > {
    const keys = await this.getKeys(false);

    if (!keys) {
      return { ok: false, reason: 'jwks_unreachable', unavailable: true };
    }

    const check = verifyHubMcpToken({
      token,
      keys,
      issuer: this.issuer,
      audience: this.audience,
    });

    if (check.ok || !check.unknownKid) {
      return check;
    }

    // Key rotation at the Hub: re-read the JWKS once, at most every minute.
    const refreshed = await this.getKeys(true);

    if (!refreshed) {
      return { ok: false, reason: 'jwks_unreachable', unavailable: true };
    }

    return verifyHubMcpToken({
      token,
      keys: refreshed,
      issuer: this.issuer,
      audience: this.audience,
    });
  }

  private async getKeys(forceRefresh: boolean): Promise<HubJwk[] | null> {
    const age = this.jwks ? Date.now() - this.jwks.fetchedAt : Infinity;

    if (
      this.jwks &&
      age < JWKS_MAX_AGE_MS &&
      (!forceRefresh || age < JWKS_MIN_REFRESH_MS)
    ) {
      return this.jwks.keys;
    }

    try {
      const response = await fetch(`${this.issuer}/.well-known/jwks.json`, {
        signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const body = (await response.json()) as { keys?: HubJwk[] };

      this.jwks = { keys: body.keys ?? [], fetchedAt: Date.now() };

      return this.jwks.keys;
    } catch (error) {
      this.logger.warn(
        `Hub JWKS unreachable: ${error instanceof Error ? error.message : error}`,
      );

      // A known key stays usable past its hour rather than cutting every agent off.
      return this.jwks?.keys ?? null;
    }
  }

  private async mintAccessToken(
    claims: HubMcpClaims,
  ): Promise<HubMcpAuthResult> {
    const link = await this.keyValuePairRepository.findOne({
      where: { key: `veridian.hub_user:${claims.sub}`, workspaceId: IsNull() },
    });

    // The Hub creates accounts; an unknown user is refused, never created here.
    if (!link?.userId) {
      return {
        kind: 'refused',
        status: 401,
        error: 'hub_user_unknown',
        message:
          'No Veridian CRM account for this Hub user yet: open the CRM once from the Hub.',
      };
    }

    const workspace = await this.resolveWorkspace(link.userId, claims);

    if (workspace.kind === 'refused') {
      return workspace;
    }

    const { workspaceId } = workspace;

    try {
      const { token } = await this.accessTokenService.generateAccessToken({
        userId: link.userId,
        workspaceId,
        authProvider: AuthProviderEnum.Password,
      });

      return { kind: 'ok', accessToken: token, workspaceId };
    } catch (error) {
      this.logger.warn(
        `Hub MCP access token refused: ${error instanceof Error ? error.message : error}`,
      );

      return {
        kind: 'refused',
        status: 403,
        error: 'not_a_workspace_member',
        message: 'This Hub user is not a member of the Veridian CRM workspace.',
      };
    }
  }

  // An integration has no member: its workspace is the one the Hub space is linked to, and it must be active. The token is
  // only minted once the app is there, see authenticateAction.
  private async resolveIntegrationWorkspace(
    claims: HubMcpClaims,
  ): Promise<HubMcpAuthResult> {
    const tenant = await this.keyValuePairRepository.findOne({
      where: {
        key: `veridian.hub_tenant:${claims.tenant_id}`,
        userId: IsNull(),
      },
    });

    if (!tenant?.workspaceId) {
      return {
        kind: 'refused',
        status: 403,
        error: 'tenant_not_linked',
        message: 'This Hub space has no Veridian CRM workspace.',
      };
    }

    const [membership] = await this.userWorkspaceRepository.find({
      where: { workspaceId: tenant.workspaceId },
      relations: { workspace: true },
      take: 1,
    });

    if (
      membership?.workspace?.activationStatus !==
      WorkspaceActivationStatus.ACTIVE
    ) {
      return {
        kind: 'refused',
        status: 403,
        error: 'workspace_inactive',
        message: 'This Veridian CRM workspace is not active.',
      };
    }

    return { kind: 'ok', accessToken: '', workspaceId: tenant.workspaceId };
  }

  // Rule shared by every app (parente, 09/11/2026): no tenant_id, the user's default workspace;
  // a tenant_id the AI chose is honoured or refused by name, never swapped for another workspace.
  private async resolveWorkspace(
    userId: string,
    claims: HubMcpClaims,
  ): Promise<
    | { kind: 'ok'; workspaceId: string }
    | Extract<HubMcpAuthResult, { kind: 'refused' }>
  > {
    const memberships = await this.userWorkspaceRepository.find({
      where: { userId },
      relations: { workspace: true },
      order: { createdAt: 'ASC' },
    });
    const activeWorkspaceIds = memberships
      .filter(
        (membership) =>
          membership.workspace?.activationStatus ===
          WorkspaceActivationStatus.ACTIVE,
      )
      .map((membership) => membership.workspaceId);

    if (!claims.tenant_id) {
      return activeWorkspaceIds[0]
        ? { kind: 'ok', workspaceId: activeWorkspaceIds[0] }
        : {
            kind: 'refused',
            status: 403,
            error: 'no_workspace',
            message: 'This Hub user has no active Veridian CRM workspace.',
          };
    }

    const tenant = await this.keyValuePairRepository.findOne({
      where: {
        key: `veridian.hub_tenant:${claims.tenant_id}`,
        userId: IsNull(),
      },
    });

    if (!tenant?.workspaceId) {
      return {
        kind: 'refused',
        status: 403,
        error: 'tenant_not_linked',
        message: 'This Hub space has no Veridian CRM workspace.',
      };
    }

    if (!activeWorkspaceIds.includes(tenant.workspaceId)) {
      return {
        kind: 'refused',
        status: 403,
        error: 'tenant_forbidden',
        message:
          'This Hub user is not a member of that Veridian CRM workspace.',
      };
    }

    return { kind: 'ok', workspaceId: tenant.workspaceId };
  }

  private remember(
    jti: string,
    { accessToken, workspaceId }: { accessToken: string; workspaceId: string },
    expiresAt: number,
  ) {
    if (this.accessTokensByJti.size >= MAX_CACHED_TOKENS) {
      const now = Date.now();

      for (const [key, value] of this.accessTokensByJti) {
        if (value.expiresAt <= now) {
          this.accessTokensByJti.delete(key);
        }
      }

      if (this.accessTokensByJti.size >= MAX_CACHED_TOKENS) {
        const oldest = this.accessTokensByJti.keys().next().value;

        if (oldest !== undefined) {
          this.accessTokensByJti.delete(oldest);
        }
      }
    }

    this.accessTokensByJti.set(jti, { accessToken, workspaceId, expiresAt });
  }
}
