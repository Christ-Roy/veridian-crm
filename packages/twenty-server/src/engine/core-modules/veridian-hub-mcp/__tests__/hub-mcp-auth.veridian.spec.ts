import { generateKeyPairSync } from 'crypto';

import { type Request, type Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { VeridianHubMcpAuthMiddleware } from 'src/engine/core-modules/veridian-hub-mcp/middlewares/veridian-hub-mcp-auth.middleware';
import { VeridianHubMcpAuthService } from 'src/engine/core-modules/veridian-hub-mcp/services/veridian-hub-mcp-auth.service';

const ISSUER = 'https://app.veridian.site';
const AUDIENCE = 'https://crm.app.veridian.site/mcp';
const HUB_USER_ID = '0b9f3c1e-7d2a-4c55-9f1e-2a6b8c4d5e6f';
const USER_ID = 'user-1';

const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwks = {
  keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'hub-1' }],
};

const sign = (claims: Record<string, unknown> = {}, jwtid = 'jti-1') =>
  jwt.sign({ email: 'agent@veridian.site', ...claims }, keys.privateKey, {
    algorithm: 'ES256',
    keyid: 'hub-1',
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: HUB_USER_ID,
    expiresIn: 300,
    jwtid,
  });

const membership = (
  workspaceId: string,
  status = WorkspaceActivationStatus.ACTIVE,
) => ({
  workspaceId,
  workspace: { activationStatus: status },
});

const setup = ({
  linkedUserId = USER_ID as string | null,
  memberships = [membership('ws-own'), membership('ws-other')],
  tenantWorkspaceId = null as string | null,
} = {}) => {
  const keyValuePairRepository = {
    findOne: jest.fn(async ({ where }: { where: { key: string } }) => {
      if (where.key === `veridian.hub_user:${HUB_USER_ID}`) {
        return linkedUserId ? { userId: linkedUserId } : null;
      }

      if (where.key.startsWith('veridian.hub_tenant:')) {
        return tenantWorkspaceId ? { workspaceId: tenantWorkspaceId } : null;
      }

      return null;
    }),
  };
  const userWorkspaceRepository = { find: jest.fn(async () => memberships) };
  const accessTokenService = {
    generateAccessToken: jest.fn(
      async ({ workspaceId }: { workspaceId: string }) => ({
        token: `twenty-token-for-${workspaceId}`,
      }),
    ),
  };
  const service = new VeridianHubMcpAuthService(
    accessTokenService as never,
    keyValuePairRepository as never,
    userWorkspaceRepository as never,
  );

  return { service, accessTokenService };
};

describe('VeridianHubMcpAuthService (CONTRAT-MCP)', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    process.env.VERIDIAN_HUB_MCP_ISSUER = ISSUER;
    process.env.VERIDIAN_HUB_MCP_AUDIENCE = AUDIENCE;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => jwks });
    global.fetch = fetchMock as never;
  });

  afterEach(() => {
    delete process.env.VERIDIAN_HUB_MCP_ISSUER;
    delete process.env.VERIDIAN_HUB_MCP_AUDIENCE;
  });

  it('turns the Hub identity into the user own Twenty token, first workspace', async () => {
    const { service, accessTokenService } = setup();

    expect(await service.authenticate(sign())).toEqual({
      kind: 'ok',
      accessToken: 'twenty-token-for-ws-own',
    });
    expect(accessTokenService.generateAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, workspaceId: 'ws-own' }),
    );
  });

  it('refuses an unknown Hub user with a clear 401 and creates nothing', async () => {
    const { service, accessTokenService } = setup({ linkedUserId: null });

    expect(await service.authenticate(sign())).toMatchObject({
      kind: 'refused',
      status: 401,
      error: 'hub_user_unknown',
    });
    expect(accessTokenService.generateAccessToken).not.toHaveBeenCalled();
  });

  it('skips workspaces that are not active', async () => {
    const { service } = setup({
      memberships: [
        membership('ws-pending', WorkspaceActivationStatus.PENDING_CREATION),
        membership('ws-live'),
      ],
    });

    expect(await service.authenticate(sign())).toMatchObject({
      accessToken: 'twenty-token-for-ws-live',
    });
  });

  it('honours a Hub-signed tenant only if the user is a member of it', async () => {
    expect(
      await setup({ tenantWorkspaceId: 'ws-other' }).service.authenticate(
        sign({ tenant_id: 't-1' }),
      ),
    ).toMatchObject({ accessToken: 'twenty-token-for-ws-other' });

    expect(
      await setup({ tenantWorkspaceId: 'ws-stranger' }).service.authenticate(
        sign({ tenant_id: 't-2' }),
      ),
    ).toMatchObject({ kind: 'refused', status: 403 });
  });

  it('refuses a token for another audience', async () => {
    process.env.VERIDIAN_HUB_MCP_AUDIENCE =
      'https://crm.staging.veridian.site/mcp';

    expect(await setup().service.authenticate(sign())).toMatchObject({
      kind: 'refused',
      status: 401,
      error: 'invalid_hub_token',
    });
  });

  it('serves one MCP exchange from one JWT and one JWKS read', async () => {
    const { service, accessTokenService } = setup();
    const token = sign();

    await service.authenticate(token);
    await service.authenticate(token);
    await service.authenticate(sign({}, 'jti-2'));

    expect(accessTokenService.generateAccessToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${ISSUER}/.well-known/jwks.json`,
      expect.anything(),
    );
  });

  it('answers 503 when the Hub keys cannot be read', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    expect(await setup().service.authenticate(sign())).toMatchObject({
      kind: 'refused',
      status: 503,
    });
  });

  it('stays off when the issuer is not configured', async () => {
    delete process.env.VERIDIAN_HUB_MCP_ISSUER;

    expect(await setup().service.authenticate(sign())).toEqual({
      kind: 'not_hub',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('VeridianHubMcpAuthMiddleware', () => {
  const run = async (
    result: Awaited<ReturnType<VeridianHubMcpAuthService['authenticate']>>,
  ) => {
    const middleware = new VeridianHubMcpAuthMiddleware({
      authenticate: jest.fn(async () => result),
    } as never);
    const req = {
      headers: { authorization: 'Bearer hub-jwt' },
      body: { id: 7 },
    } as unknown as Request;
    const json = jest.fn();
    const res = {
      status: jest.fn(() => ({ json })),
    } as unknown as Response;
    const next = jest.fn();

    await middleware.use(req, res, next);

    return { req, res, json, next };
  };

  it('swaps the Hub JWT for the Twenty token and lets the native guard run', async () => {
    const { req, next } = await run({ kind: 'ok', accessToken: 'twenty' });

    expect(req.headers.authorization).toBe('Bearer twenty');
    expect(next).toHaveBeenCalled();
  });

  it('answers the refusal itself, as JSON-RPC, without reaching MCP', async () => {
    const { res, json, next } = await run({
      kind: 'refused',
      status: 401,
      error: 'hub_user_unknown',
      message: 'no account',
    });

    expect(res.status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 7,
        error: expect.objectContaining({ data: { error: 'hub_user_unknown' } }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('leaves non-Hub tokens untouched', async () => {
    const { req, next } = await run({ kind: 'not_hub' });

    expect(req.headers.authorization).toBe('Bearer hub-jwt');
    expect(next).toHaveBeenCalled();
  });
});
