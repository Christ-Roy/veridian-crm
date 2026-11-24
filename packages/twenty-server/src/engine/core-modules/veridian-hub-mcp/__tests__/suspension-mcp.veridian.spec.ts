import { generateKeyPairSync } from 'crypto';

import { type Request, type Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { VeridianHubMcpAuthMiddleware } from 'src/engine/core-modules/veridian-hub-mcp/middlewares/veridian-hub-mcp-auth.middleware';
import { VeridianHubMcpAuthService } from 'src/engine/core-modules/veridian-hub-mcp/services/veridian-hub-mcp-auth.service';

// CONTRAT-HUB §5.4 : un espace suspendu n'obtient aucun jeton du CRM par le Hub, ni jeton complet ni jeton d'action (act).
const ISSUER = 'https://hub.staging.veridian.site';
const AUDIENCE = 'https://crm.staging.veridian.site/mcp';
const SUB = '0b9f3c1e-7d2a-4c55-9f1e-2a6b8c4d5e6f';
const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });

const jeton = (claims: Record<string, unknown> = {}, jti = 'j1') => {
  const iat = Math.floor(Date.now() / 1000);

  return jwt.sign(
    { tenant_id: 't-1', exp: iat + 120, iat, jti, ...claims },
    keys.privateKey,
    {
      algorithm: 'ES256',
      keyid: 'epreuve',
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: SUB,
    },
  );
};

const jetonAct = (jti = 'a1') =>
  jeton(
    {
      act: { sub: 'app:prospection' },
      scope: 'crm:societe.ecrire crm:tache.ecrire',
    },
    jti,
  );

const appel = {
  id: 1,
  method: 'tools/call',
  params: { name: 'app_envoyer_au_crm', arguments: { siren: '1' } },
};

const monter = (statuts: WorkspaceActivationStatus[], tenantWorkspace = 'ws-0') => {
  const generateAccessToken = jest.fn(async () => ({ token: 'twenty' }));
  const vus = new Set<string>();
  const service = new VeridianHubMcpAuthService(
    { generateAccessToken } as never,
    {
      findOne: jest.fn(async ({ where }: { where: { key: string } }) =>
        where.key.startsWith('veridian.hub_user:')
          ? { userId: 'u' }
          : { workspaceId: tenantWorkspace },
      ),
    } as never,
    {
      find: jest.fn(async () =>
        statuts.map((activationStatus, i) => ({
          workspaceId: `ws-${i}`,
          workspace: { activationStatus },
        })),
      ),
    } as never,
    {
      setIfAbsent: jest.fn(async (cle: string) =>
        vus.has(cle) ? false : Boolean(vus.add(cle)),
      ),
    } as never,
  );
  const middleware = new VeridianHubMcpAuthMiddleware(service);
  const passer = async (token: string, body: unknown) => {
    const req = {
      headers: { authorization: `Bearer ${token}` },
      body,
    } as unknown as Request;
    let refus: { status: number; error: string } | undefined;
    const res = {
      status: (status: number) => ({
        json: (r: { error: { data: { error: string } } }) => {
          refus = { status, error: r.error.data.error };
        },
      }),
    } as unknown as Response;
    const next = jest.fn();

    await middleware.use(req, res, next);

    return { refus, passe: next.mock.calls.length === 1 };
  };

  return { passer, generateAccessToken };
};

const { ACTIVE, SUSPENDED } = WorkspaceActivationStatus;

describe('suspension Veridian : jetons du Hub sur /mcp', () => {
  beforeEach(() => {
    process.env.VERIDIAN_HUB_MCP_ISSUER = ISSUER;
    process.env.VERIDIAN_HUB_MCP_AUDIENCE = AUDIENCE;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'epreuve' }],
      }),
    })) as never;
  });

  afterEach(() => {
    delete process.env.VERIDIAN_HUB_MCP_ISSUER;
    delete process.env.VERIDIAN_HUB_MCP_AUDIENCE;
  });

  it('jeton complet visant l espace suspendu : refusé nommément, aucun jeton Twenty', async () => {
    const { passer, generateAccessToken } = monter([SUSPENDED, ACTIVE]);
    const { refus, passe } = await passer(jeton(), appel);

    expect(passe).toBe(false);
    expect(refus).toEqual({ status: 403, error: 'tenant_forbidden' });
    expect(generateAccessToken).not.toHaveBeenCalled();
  });

  it('jeton d action visant l espace suspendu : refusé nommément, aucun jeton Twenty', async () => {
    const { passer, generateAccessToken } = monter([SUSPENDED, ACTIVE]);
    const { refus, passe } = await passer(jetonAct(), appel);

    expect(passe).toBe(false);
    expect(refus).toEqual({ status: 403, error: 'tenant_forbidden' });
    expect(generateAccessToken).not.toHaveBeenCalled();
  });

  it('sans tenant_id, tous les espaces suspendus : no_workspace, jamais un espace suspendu', async () => {
    const { passer, generateAccessToken } = monter([SUSPENDED, SUSPENDED]);
    const { refus } = await passer(jeton({ tenant_id: undefined }), appel);

    expect(refus).toEqual({ status: 403, error: 'no_workspace' });
    expect(generateAccessToken).not.toHaveBeenCalled();
  });

  it('contrôle positif : le même jeton passe quand l espace visé est actif', async () => {
    const { passer, generateAccessToken } = monter([ACTIVE, SUSPENDED]);

    expect((await passer(jeton(), appel)).passe).toBe(true);
    expect((await passer(jetonAct('a2'), appel)).passe).toBe(true);
    expect(generateAccessToken).toHaveBeenCalledTimes(2);
  });
});
