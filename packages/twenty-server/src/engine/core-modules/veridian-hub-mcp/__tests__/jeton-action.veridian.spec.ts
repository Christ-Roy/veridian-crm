import { generateKeyPairSync } from 'crypto';

import { type Request, type Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { VeridianHubMcpAuthMiddleware } from 'src/engine/core-modules/veridian-hub-mcp/middlewares/veridian-hub-mcp-auth.middleware';
import { VeridianHubMcpAuthService } from 'src/engine/core-modules/veridian-hub-mcp/services/veridian-hub-mcp-auth.service';

// INTEGRATIONS-NATIVES §2.3 : le jeton d'action (claim act), signé ici par une clé d'épreuve.
const ISSUER = 'https://hub.staging.veridian.site';
const AUDIENCE = 'https://crm.staging.veridian.site/mcp';
const SUB = '0b9f3c1e-7d2a-4c55-9f1e-2a6b8c4d5e6f';
const SCOPE = 'crm:societe.ecrire crm:tache.ecrire';
const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });

const jeton = (
  claims: Record<string, unknown> = {},
  { jti = 'j1', duree = 120, sansIat = false } = {},
) => {
  const iat = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      act: { sub: 'app:prospection' },
      scope: SCOPE,
      tenant_id: 't-1',
      exp: iat + duree,
      ...(sansIat ? {} : { iat }),
      ...(jti ? { jti } : {}),
      ...claims,
    },
    keys.privateKey,
    {
      algorithm: 'ES256',
      keyid: 'epreuve',
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: SUB,
      noTimestamp: sansIat,
    },
  );
};

const appel = (name = 'app_envoyer_au_crm', args: unknown = { siren: '1' }) => ({
  id: 1,
  method: 'tools/call',
  params: { name, arguments: args },
});

const monter = ({ workspaceDuTenant = 'ws-1' as string | null } = {}) => {
  const vus = new Set<string>();
  const generateAccessToken = jest.fn(async () => ({ token: 'twenty' }));
  const service = new VeridianHubMcpAuthService(
    { generateAccessToken } as never,
    {
      findOne: jest.fn(async ({ where }: { where: { key: string } }) =>
        where.key.startsWith('veridian.hub_user:')
          ? { userId: 'u' }
          : workspaceDuTenant
            ? { workspaceId: workspaceDuTenant }
            : null,
      ),
    } as never,
    {
      find: jest.fn(async () => [
        {
          workspaceId: 'ws-1',
          workspace: { activationStatus: WorkspaceActivationStatus.ACTIVE },
        },
      ]),
    } as never,
    {
      setIfAbsent: jest.fn(async (cle: string) =>
        vus.has(cle) ? false : Boolean(vus.add(cle)),
      ),
    } as never,
  );
  const middleware = new VeridianHubMcpAuthMiddleware(service);
  const passer = async (token: string | undefined, body: unknown) => {
    const req = {
      headers: token ? { authorization: `Bearer ${token}` } : {},
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

    return { req, refus, passe: next.mock.calls.length === 1 };
  };

  return { passer, generateAccessToken };
};

describe('jeton d’action du Hub (act)', () => {
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

  it('passe sous l’identité du membre, dans l’espace du jeton, avec l’origine attestée', async () => {
    const { passer, generateAccessToken } = monter();
    const { req, passe } = await passer(jeton(), appel());

    expect(passe).toBe(true);
    expect(req.headers.authorization).toBe('Bearer twenty');
    expect(req.body.params.arguments).toEqual({
      siren: '1',
      _veridian: { app: 'app:prospection', jti: 'j1' },
    });
    expect(generateAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u', workspaceId: 'ws-1' }),
    );
  });

  it('un jeton sert une fois', async () => {
    const { passer } = monter();

    expect((await passer(jeton(), appel())).passe).toBe(true);
    expect((await passer(jeton(), appel())).refus).toEqual({
      status: 401,
      error: 'token_replayed',
    });
  });

  it.each([
    ['un autre outil', appel('delete_one_company')],
    ['l’outil générique', appel('execute_tool', { toolName: 'app_envoyer_au_crm' })],
    ['un nom hérité', appel('toString')],
    ['la liste des outils', { id: 1, method: 'tools/list' }],
    ['initialize', { id: 1, method: 'initialize' }],
    ['un lot', [appel()]],
    ['un corps vide', undefined],
  ])('refuse %s', async (_nom, body) => {
    const { passer, generateAccessToken } = monter();

    expect((await passer(jeton(), body)).refus).toEqual({
      status: 403,
      error: 'delegation_forbidden',
    });
    expect(generateAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    ['portée incomplète', { scope: 'crm:societe.ecrire' }],
    ['portée absente', { scope: undefined }],
    ['autre app', { act: { sub: 'app:notifuse' } }],
  ])('refuse : %s', async (_nom, claims) => {
    expect((await monter().passer(jeton(claims), appel())).refus?.error).toBe(
      'delegation_forbidden',
    );
  });

  it.each([
    ['act vide', { act: {} }],
    ['act nul', { act: null }],
    ['act texte', { act: 'app:prospection' }],
    ['act en chaîne', { act: { sub: 'app:prospection', act: { sub: 'app:x' } } }],
    ['act sans préfixe', { act: { sub: 'prospection' } }],
  ])('jamais un jeton complet : %s', async (_nom, claims) => {
    expect((await monter().passer(jeton(claims), appel())).refus).toEqual({
      status: 401,
      error: 'invalid_act',
    });
  });

  it('exige jti, iat, 120 s au plus et un espace', async () => {
    const { passer } = monter();
    const erreur = async (t: string) => (await passer(t, appel())).refus?.error;

    expect(await erreur(jeton({}, { jti: '' }))).toBe('invalid_act');
    expect(await erreur(jeton({}, { sansIat: true }))).toBe('invalid_act');
    expect(await erreur(jeton({}, { duree: 300 }))).toBe('invalid_act');
    expect(await erreur(jeton({ tenant_id: undefined }))).toBe('tenant_required');
  });

  it('règles d’espace du contrat MCP', async () => {
    expect(
      (await monter({ workspaceDuTenant: null }).passer(jeton(), appel())).refus,
    ).toEqual({ status: 403, error: 'tenant_not_linked' });
    expect(
      (await monter({ workspaceDuTenant: 'ws-autre' }).passer(jeton(), appel()))
        .refus,
    ).toEqual({ status: 403, error: 'tenant_forbidden' });
  });

  it('une origine forgée est retirée, quel que soit le jeton', async () => {
    const { passer } = monter();
    const forge = { _veridian: { app: 'app:prospection', jti: 'x' } };

    for (const token of [undefined, 'cle-api', jeton({ act: undefined })]) {
      const { req, passe } = await passer(token, {
        ...appel('execute_tool', { toolName: 'x', arguments: { ...forge } }),
        ...forge,
      });

      expect(passe).toBe(true);
      expect(JSON.stringify(req.body)).not.toContain('_veridian');
    }
  });
});
