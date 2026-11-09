import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { IsNull, Repository } from 'typeorm';

import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
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

export type HubMcpAuthResult =
  | { kind: 'not_hub' }
  | { kind: 'ok'; accessToken: string }
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
    { accessToken: string; expiresAt: number }
  >();

  constructor(
    private readonly accessTokenService: AccessTokenService,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(KeyValuePairEntity)
    private readonly keyValuePairRepository: Repository<KeyValuePairEntity>,
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
  ) {}

  private get issuer() {
    return process.env.VERIDIAN_HUB_MCP_ISSUER ?? '';
  }

  private get audience() {
    return process.env.VERIDIAN_HUB_MCP_AUDIENCE ?? '';
  }

  async authenticate(token: string): Promise<HubMcpAuthResult> {
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
    const cached = claims.jti ? this.accessTokensByJti.get(claims.jti) : null;

    if (cached && cached.expiresAt > Date.now()) {
      return { kind: 'ok', accessToken: cached.accessToken };
    }

    const result = await this.mintAccessToken(claims);

    if (result.kind === 'ok' && claims.jti) {
      this.remember(claims.jti, result.accessToken, claims.exp * 1000);
    }

    return result;
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

    const workspaceId = await this.resolveWorkspaceId(link.userId, claims);

    if (!workspaceId) {
      return {
        kind: 'refused',
        status: 403,
        error: 'no_workspace',
        message: 'This Hub user has no active Veridian CRM workspace.',
      };
    }

    try {
      const { token } = await this.accessTokenService.generateAccessToken({
        userId: link.userId,
        workspaceId,
        authProvider: AuthProviderEnum.Password,
      });

      return { kind: 'ok', accessToken: token };
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

  // The workspace comes from the user's memberships (or the Hub-signed tenant), never from the AI.
  private async resolveWorkspaceId(
    userId: string,
    claims: HubMcpClaims,
  ): Promise<string | null> {
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

    if (claims.tenant_id) {
      const tenant = await this.keyValuePairRepository.findOne({
        where: {
          key: `veridian.hub_tenant:${claims.tenant_id}`,
          userId: IsNull(),
        },
      });

      return tenant?.workspaceId &&
        activeWorkspaceIds.includes(tenant.workspaceId)
        ? tenant.workspaceId
        : null;
    }

    return activeWorkspaceIds[0] ?? null;
  }

  private remember(jti: string, accessToken: string, expiresAt: number) {
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

    this.accessTokensByJti.set(jti, { accessToken, expiresAt });
  }
}
