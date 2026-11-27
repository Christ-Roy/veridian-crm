// Chargé pour de vrai, il tire twenty-client-sdk, non construit en CI : éprouvé dans app-deleguee.veridian.spec.ts.
jest.mock(
  'src/engine/core-modules/veridian-hub-mcp/services/veridian-delegated-app.service',
  () => ({ VeridianDelegatedAppService: class {} }),
);

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
  {
    subject = SUB,
    ...claims
  }: Record<string, unknown> & { subject?: string } = {},
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
      subject,
      noTimestamp: sansIat,
    },
  );
};

const appel = (
  name = 'app_envoyer_au_crm',
  args: unknown = { siren: '1' },
) => ({
  id: 1,
  method: 'tools/call',
  params: { name, arguments: args },
});

const monter = ({
  workspaceDuTenant = 'ws-1' as string | null,
  app = { kind: 'ok', applicationId: 'app-1' } as object,
  espaceActif = true,
} = {}) => {
  const ensureInstalled = jest.fn(async () => app);
  const generateApplicationAccessToken = jest.fn(async () => ({
    token: 'jeton-app',
  }));
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
          workspace: {
            activationStatus: espaceActif
              ? WorkspaceActivationStatus.ACTIVE
              : WorkspaceActivationStatus.SUSPENDED,
          },
        },
      ]),
    } as never,
    {
      setIfAbsent: jest.fn(async (cle: string) =>
        vus.has(cle) ? false : Boolean(vus.add(cle)),
      ),
    } as never,
    { ensureInstalled } as never,
    { generateApplicationAccessToken } as never,
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

  return {
    passer,
    generateAccessToken,
    generateApplicationAccessToken,
    ensureInstalled,
  };
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

  it('pose l’app de l’outil dans l’espace du jeton avant de passer', async () => {
    const { passer, ensureInstalled } = monter();

    expect((await passer(jeton(), appel())).passe).toBe(true);
    expect(ensureInstalled).toHaveBeenCalledTimes(1);
    expect(ensureInstalled).toHaveBeenCalledWith({
      applicationUniversalIdentifier: '1a1ab23e-60e5-4eca-be1f-718c96055c79',
      workspaceId: 'ws-1',
    });
  });

  it('app non posée : refus nommé, la requête ne passe pas', async () => {
    const { passer } = monter({
      app: {
        kind: 'refused',
        status: 403,
        error: 'app_not_available',
        message: 'x',
      },
    });

    expect(await passer(jeton(), appel())).toMatchObject({
      passe: false,
      refus: { status: 403, error: 'app_not_available' },
    });
  });

  it.each([
    ['une portée refusée', jeton({ scope: 'crm:tache.ecrire' }), {}],
    ['un autre outil', jeton(), { corps: appel('delete_one_company') }],
    ['un espace interdit', jeton(), { workspaceDuTenant: 'ws-autre' }],
    ['un espace non lié', jeton(), { workspaceDuTenant: null }],
    ['un jeton sans act', jeton({ act: undefined }), {}],
    ['aucun jeton', undefined, {}],
  ] as const)('ne pose rien pour %s', async (_nom, token, options) => {
    const { corps = appel(), ...reste } = options as {
      corps?: unknown;
      workspaceDuTenant?: string | null;
    };
    const { passer, ensureInstalled } = monter(reste);

    await passer(token, corps);
    expect(ensureInstalled).not.toHaveBeenCalled();
  });

  it('ne pose rien au rejeu d’un jeton', async () => {
    const { passer, ensureInstalled } = monter();
    const token = jeton();

    await passer(token, appel());
    await passer(token, appel());
    expect(ensureInstalled).toHaveBeenCalledTimes(1);
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
    [
      'l’outil générique',
      appel('execute_tool', { toolName: 'app_envoyer_au_crm' }),
    ],
    ['un nom hérité', appel('toString')],
    ['la liste des outils', { id: 1, method: 'tools/list' }],
    [
      'une autre méthode sous le bon nom',
      { ...appel(), method: 'resources/read' },
    ],
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
    [
      'act en chaîne',
      { act: { sub: 'app:prospection', act: { sub: 'app:x' } } },
    ],
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
    expect(await erreur(jeton({ tenant_id: undefined }))).toBe(
      'tenant_required',
    );
  });

  it('règles d’espace du contrat MCP', async () => {
    expect(
      (await monter({ workspaceDuTenant: null }).passer(jeton(), appel()))
        .refus,
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

  describe('dossier Mail relayé sans membre (app_evenements_mail)', () => {
    const MAIL = {
      subject: 'integration:t-1',
      act: { sub: 'app:notifuse' },
      scope: 'crm:mail.ecrire',
    };
    const evenements = () =>
      appel('app_evenements_mail', { evenements: [{ type: 'sent', email: 'a@b.fr', rfc_message_id: '<m@b.fr>' }] });

    it('agit avec le jeton court de l’app, sous son rôle', async () => {
      const e = monter();
      const { req, passe } = await e.passer(jeton(MAIL), evenements());

      expect(passe).toBe(true);
      expect(req.headers.authorization).toBe('Bearer jeton-app');
      expect(e.generateAccessToken).not.toHaveBeenCalled();
    });

    it.each([
      ['la portée des tâches seule', { scope: 'crm:tache.ecrire' }],
      ['une autre app', { act: { sub: 'app:prospection' } }],
      ['un membre', { subject: SUB }],
    ])('refuse : %s', async (_nom, claims) => {
      const e = monter();

      expect((await e.passer(jeton({ ...MAIL, ...claims }), evenements())).refus?.error).toBe(
        'delegation_forbidden',
      );
      expect(e.generateApplicationAccessToken).not.toHaveBeenCalled();
    });

    it('sa portée n’ouvre pas les réponses humaines', async () => {
      expect(
        (await monter().passer(jeton(MAIL), appel('app_reponse_humaine', { email: 'a@b.fr', thread_id: 't' }))).refus?.error,
      ).toBe('delegation_forbidden');
    });
  });

  describe('dossier Visites relayé sans membre (app_evenements_visite, VER-273)', () => {
    const VISITE = {
      subject: 'integration:t-1',
      act: { sub: 'app:analytics' },
      scope: 'crm:visite.ecrire',
    };
    const visites = () =>
      appel('app_evenements_visite', {
        kind: 'visite',
        visites: [{ session_id: 's-0001-aaaa', contact_email: 'a@b.fr' }],
      });

    it('agit avec le jeton court de l’app, sous son rôle', async () => {
      const e = monter();
      const { req, passe } = await e.passer(jeton(VISITE), visites());

      expect(passe).toBe(true);
      expect(req.headers.authorization).toBe('Bearer jeton-app');
      expect(e.generateAccessToken).not.toHaveBeenCalled();
    });

    it.each([
      ['la portée des tâches seule', { scope: 'crm:tache.ecrire' }],
      ['la portée du journal Mail', { scope: 'crm:mail.ecrire' }],
      ['l’app Mail', { act: { sub: 'app:notifuse' } }],
      ['un membre', { subject: SUB }],
    ])('refuse : %s', async (_nom, claims) => {
      const e = monter();

      expect((await e.passer(jeton({ ...VISITE, ...claims }), visites())).refus?.error).toBe(
        'delegation_forbidden',
      );
      expect(e.generateApplicationAccessToken).not.toHaveBeenCalled();
    });

    it('sa portée n’ouvre pas le dossier Mail', async () => {
      expect(
        (await monter().passer(jeton(VISITE), appel('app_evenements_mail', { evenements: [{ type: 'sent' }] }))).refus?.error,
      ).toBe('delegation_forbidden');
    });
  });

  describe('événement relayé sans membre (integration:<espace>)', () => {
    const MAIL = {
      subject: 'integration:t-1',
      act: { sub: 'app:notifuse' },
      scope: 'crm:tache.ecrire',
    };
    const reponse = () =>
      appel('app_reponse_humaine', { email: 'a@b.fr', thread_id: 't' });

    it('agit avec le jeton court de l’app, jamais celui d’un membre', async () => {
      const e = monter();
      const { req, passe } = await e.passer(jeton(MAIL), reponse());

      expect(passe).toBe(true);
      expect(req.headers.authorization).toBe('Bearer jeton-app');
      expect(req.body.params.arguments._veridian).toEqual({
        app: 'app:notifuse',
        jti: 'j1',
      });
      expect(e.generateAccessToken).not.toHaveBeenCalled();
      expect(e.generateApplicationAccessToken).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        applicationId: 'app-1',
        expiresIn: '3m',
      });
      expect(e.ensureInstalled).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws-1' }),
      );
    });

    it('un seul usage', async () => {
      const { passer } = monter();

      expect((await passer(jeton(MAIL), reponse())).passe).toBe(true);
      expect((await passer(jeton(MAIL), reponse())).refus?.error).toBe(
        'token_replayed',
      );
    });

    it.each([
      ['un autre outil que le sien', {}, appel(), 'delegation_forbidden'],
      [
        'une autre app',
        { act: { sub: 'app:prospection' } },
        reponse(),
        'delegation_forbidden',
      ],
      [
        'sans sa portée',
        { scope: 'crm:societe.ecrire' },
        reponse(),
        'delegation_forbidden',
      ],
      [
        'un autre espace que le sien',
        { subject: 'integration:t-2' },
        reponse(),
        'tenant_forbidden',
      ],
      [
        'un membre sur l’outil sans membre',
        { subject: SUB },
        reponse(),
        'delegation_forbidden',
      ],
    ])('refuse : %s', async (_nom, claims, corps, erreur) => {
      const e = monter();

      expect(
        (await e.passer(jeton({ ...MAIL, ...claims }), corps)).refus?.error,
      ).toBe(erreur);
      expect(e.generateApplicationAccessToken).not.toHaveBeenCalled();
      expect(e.ensureInstalled).not.toHaveBeenCalled();
    });

    it('jamais sur l’envoi d’un membre', async () => {
      expect(
        (await monter().passer(jeton({ subject: 'integration:t-1' }), appel()))
          .refus?.error,
      ).toBe('delegation_forbidden');
    });

    it('espace non lié, espace suspendu, app fermée : rien n’est émis', async () => {
      for (const [options, erreur] of [
        [{ workspaceDuTenant: null }, 'tenant_not_linked'],
        [{ espaceActif: false }, 'workspace_inactive'],
        [
          {
            app: {
              kind: 'refused',
              status: 403,
              error: 'app_not_available',
              message: 'x',
            },
          },
          'app_not_available',
        ],
      ] as const) {
        const e = monter(options as never);

        expect((await e.passer(jeton(MAIL), reponse())).refus?.error).toBe(
          erreur,
        );
        expect(e.generateApplicationAccessToken).not.toHaveBeenCalled();
      }
    });

    it('sans act, un sujet d’intégration n’est personne', async () => {
      const e = monter();

      await e.passer(jeton({ ...MAIL, act: undefined }), reponse());
      expect(e.generateApplicationAccessToken).not.toHaveBeenCalled();
    });
  });
});
