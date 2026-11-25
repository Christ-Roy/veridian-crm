import { createHmac } from 'crypto';

import { VeridianDelegationService } from 'src/engine/core-modules/veridian-delegation/services/veridian-delegation.service';

const HUB = 'https://hub.staging.veridian.site';
const TENANT = '4fb9fef0-1111-4222-8333-444444444444';
const TOKEN = 'jeton-signe-par-le-hub-120-secondes';
const ACTOR = { userId: 'user-1', workspaceId: 'workspace-1' };

type Call = {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
};

const answer = (status: number, body: unknown) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const grantService = (
  grant: string | null = 'poignee',
  tenant: string | null = TENANT,
) => ({
  read: jest.fn().mockResolvedValue(grant),
  forget: jest.fn().mockResolvedValue(undefined),
  findHubTenantId: jest.fn().mockResolvedValue(tenant),
});

const run = async (
  answers: unknown[],
  grants = grantService(),
  extra: Record<string, unknown> = {},
) => {
  const calls: Call[] = [];

  global.fetch = jest.fn().mockImplementation(async (url, init) => {
    calls.push({ url, init });
    const next = answers[calls.length - 1];

    if (next instanceof Error) {
      throw next;
    }

    return next;
  }) as never;

  const result = await new VeridianDelegationService(grants as never).act({
    ...ACTOR,
    target: 'notifuse',
    action: 'contacts.importer',
    scope: 'notifuse:contacts.ecrire',
    payload: { list_ids: ['l'], contacts: [{ email: 'a@b.fr' }] },
    idempotencyKey: 'geste-12345678',
    ...extra,
  });

  return { result, calls, grants };
};

const exchanged = (over: Record<string, unknown> = {}) =>
  answer(200, {
    access_token: TOKEN,
    tenant_id: TENANT,
    url: 'https://notifuse.staging.veridian.site/api/veridian/actions',
    ...over,
  });

describe('appel du CRM vers une autre app (CONTRAT-HUB §5.19.5)', () => {
  beforeEach(() => {
    process.env.HUB_URL = HUB;
    process.env.HUB_API_SECRET = 'secret-de-test';
  });

  it('échange la poignée contre un jeton, signé, puis agit avec lui seul', async () => {
    const { result, calls } = await run([
      exchanged(),
      answer(200, { resultat: { created: 1 } }),
    ]);

    expect(result).toEqual({ status: 200, body: { resultat: { created: 1 } } });
    expect(calls[0].url).toBe(`${HUB}/api/delegation/jeton`);

    const { headers, body } = calls[0].init;

    expect(headers['X-Veridian-App']).toBe('crm');
    expect(headers['X-Veridian-Nonce']).toMatch(/^[0-9a-f]{32}$/);
    expect(headers['X-Veridian-Hub-Signature']).toBe(
      createHmac('sha256', 'secret-de-test')
        .update(
          `${headers['X-Veridian-Timestamp']}.${headers['X-Veridian-Nonce']}.${body}`,
        )
        .digest('hex'),
    );
    expect(JSON.parse(body as string)).toMatchObject({
      subject_grant: 'poignee',
      audience: 'notifuse',
      scope: 'notifuse:contacts.ecrire',
    });
    expect(calls[1].url).toBe(
      'https://notifuse.staging.veridian.site/api/veridian/actions/contacts.importer',
    );
    expect(calls[1].init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[1].init.headers['Idempotency-Key']).toBe('geste-12345678');
    expect(calls[1].init.body).not.toContain('poignee');
    expect(calls[1].init.redirect).toBe('error');
  });

  it('demande la portée de l action et pas une autre', async () => {
    const { calls } = await run(
      [exchanged(), answer(200, {})],
      grantService(),
      {
        target: 'prospection',
        action: 'entreprises.chercher',
        scope: 'prospection:entreprise.lire',
      },
    );

    expect(JSON.parse(calls[0].init.body as string).scope).toBe(
      'prospection:entreprise.lire',
    );
  });

  it.each([
    'https://notifuse.evil.com/api',
    'http://notifuse.app.veridian.site/api',
    'https://veridian.site.evil.com/api',
    'https://user:pass@notifuse.app.veridian.site/api',
    'https://notifuse.app.veridian.site:8443/api',
    undefined,
  ])('ne donne jamais le jeton à %s', async (url) => {
    const { result, calls } = await run([exchanged({ url }), answer(200, {})]);

    expect(result.status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  it('refuse un jeton d une autre organisation, rien ne part', async () => {
    const { result, calls } = await run([
      exchanged({ tenant_id: '99999999-1111-4222-8333-444444444444' }),
      answer(200, {}),
    ]);

    expect(result).toEqual({ status: 403, body: { error: 'other_tenant' } });
    expect(calls).toHaveLength(1);
  });

  it('sans poignée ou sans organisation, le Hub n est pas appelé', async () => {
    const withoutGrant = await run([], grantService(null));
    const withoutTenant = await run([], grantService('poignee', null));

    expect(withoutGrant.result.body.error).toBe('sign_in_again');
    expect(withoutTenant.result.body.error).toBe('tenant_not_linked');
    expect(withoutGrant.calls).toHaveLength(0);
    expect(withoutTenant.calls).toHaveLength(0);
  });

  it('une poignée refusée par le Hub est oubliée', async () => {
    const { result, grants } = await run([
      answer(403, { error: 'grant_invalid' }),
    ]);

    expect(result).toEqual({ status: 409, body: { error: 'sign_in_again' } });
    expect(grants.forget).toHaveBeenCalledWith('user-1', 'workspace-1');
  });

  it('une liaison éteinte est dite telle quelle, la poignée gardée', async () => {
    const { result, grants, calls } = await run([
      answer(403, { error: 'integration_off' }),
    ]);

    expect(result).toEqual({ status: 403, body: { error: 'integration_off' } });
    expect(grants.forget).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('une app muette ou illisible n est jamais un succès', async () => {
    const mute = await run([exchanged(), new Error('timeout')]);
    const unreadable = await run([exchanged(), answer(200, '<html>')]);
    const hubMute = await run([new Error('timeout')]);

    expect(mute.result).toEqual({
      status: 503,
      body: { error: 'target_unreachable' },
    });
    expect(unreadable.result.status).toBe(502);
    expect(hubMute.result.body.error).toBe('hub_unreachable');
  });

  it('un refus de la cible garde son code', async () => {
    const { result } = await run([
      exchanged(),
      answer(409, {
        error: 'refus_de_l_app',
        detail: { code: 'would_trigger' },
      }),
    ]);

    expect(result.status).toBe(409);
    expect(result.body.error).toBe('refus_de_l_app');
  });

  it.each([
    ['éteinte en dernier', ['allumee', 'eteinte']],
    ['éteinte en premier', ['eteinte', 'allumee']],
  ])(
    'état : deux interrupteurs vers la même app, séquences %s',
    async (_nom, ordre) => {
      const contacts = {
        audience: 'notifuse',
        etat: 'allumee',
        portees: ['notifuse:contacts.ecrire', 'notifuse:contacts.lire'],
      };
      const sequences = {
        audience: 'notifuse',
        etat: 'eteinte',
        portees: ['notifuse:sequences.inscrire', 'academy:avancement.lire'],
      };

      global.fetch = jest.fn().mockResolvedValue(
        answer(200, {
          paires:
            ordre[0] === 'allumee'
              ? [contacts, sequences]
              : [sequences, contacts],
        }),
      ) as never;

      expect(
        await new VeridianDelegationService(grantService() as never).describe(
          ACTOR,
        ),
      ).toEqual({
        notifuse: 'allumee',
        prospection: 'unknown',
        academy: 'unknown',
        'notifuse:contacts.ecrire': 'allumee',
        'notifuse:contacts.lire': 'allumee',
        'notifuse:sequences.inscrire': 'eteinte',
      });
    },
  );

  it('état : ne dit que les liaisons du registre', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      answer(200, {
        paires: [
          { audience: 'notifuse', etat: 'allumee' },
          { audience: 'crm', etat: 'allumee' },
        ],
      }),
    ) as never;

    expect(
      await new VeridianDelegationService(grantService() as never).describe(
        ACTOR,
      ),
    ).toEqual({
      notifuse: 'allumee',
      prospection: 'unknown',
      academy: 'unknown',
    });
  });
});
