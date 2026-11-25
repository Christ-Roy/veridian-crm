import {
  DELEGATING_APP,
  findDelegatedAction,
} from 'src/engine/core-modules/veridian-delegation/constants/delegated-targets.constant';
import { VeridianDelegationController } from 'src/engine/core-modules/veridian-delegation/controllers/veridian-delegation.controller';

// Allowed to run here, and still not the app whose screens act.
const OTHER_APP = 'f7baf702-cc85-4d4a-a3f2-0ceb42516d68';
const WORKSPACE = '38627be0-428f-4924-aa67-4a35884ba7b4';

const request = (over: Record<string, unknown> = {}) => ({
  application: {
    universalIdentifier: DELEGATING_APP,
    applicationRegistrationId: 'r',
    sourceType: 'tarball',
  },
  workspace: { id: WORKSPACE },
  user: { id: 'user-1' },
  userWorkspaceId: 'uw-1',
  body: {
    payload: { list_ids: ['l'], contacts: [] },
    idempotency_key: 'geste-12345678',
  },
  ...over,
});

const post = async (
  req: Record<string, unknown>,
  target = 'notifuse',
  action = 'contacts.importer',
  registration: unknown = null,
) => {
  const act = jest.fn().mockResolvedValue({ status: 200, body: { ok: true } });
  const controller = new VeridianDelegationController(
    { act } as never,
    {
      manager: { getRepository: () => ({ findOne: async () => registration }) },
    } as never,
  );
  const sent: { code?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      sent.code = code;

      return response;
    },
    json(body: unknown) {
      sent.body = body;

      return response;
    },
  };

  await controller.act(req as never, response as never, target, action);

  return { ...sent, act };
};

describe('entrée de l appel entre apps : une personne, par l écran de Liaisons', () => {
  beforeEach(() => {
    process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW = `${WORKSPACE}:${DELEGATING_APP},${WORKSPACE}:${OTHER_APP}`;
  });

  it('laisse passer un clic (témoin positif)', async () => {
    const { code, act } = await post(request());

    expect(code).toBe(200);
    expect(act).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: WORKSPACE,
        target: 'notifuse',
        idempotencyKey: 'geste-12345678',
      }),
    );
  });

  it.each([
    ['une clé API ou une session (aucune app)', { application: undefined }],
    ['une app sans personne', { user: undefined }],
    ['une app sans appartenance', { userWorkspaceId: undefined }],
    ['un agent', { agentId: 'agent-1' }],
    ['une session d emprunt', { impersonationContext: {} }],
    ['une autre app', { application: { universalIdentifier: OTHER_APP } }],
  ])('refuse %s', async (_nom, over) => {
    const { code, act } = await post(request(over));

    expect(code).toBe(403);
    expect(act).not.toHaveBeenCalled();
  });

  it('refuse une app locale qui porte notre identifiant', async () => {
    process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW = '';
    const { code, act } = await post(
      request({
        application: {
          universalIdentifier: DELEGATING_APP,
          applicationRegistrationId: null,
          sourceType: 'local',
        },
      }),
    );

    expect(code).toBe(403);
    expect(act).not.toHaveBeenCalled();
  });

  it('laisse passer l app du catalogue d instance', async () => {
    process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW = '';
    const { code } = await post(request(), 'notifuse', 'contacts.importer', {
      universalIdentifier: DELEGATING_APP,
      sourceType: 'tarball',
      isListed: true,
      isPreInstalled: false,
    });

    expect(code).toBe(200);
  });

  it.each([
    ['crm', 'contacts.importer'],
    ['notifuse', 'contacts.supprimer'],
    ['notifuse', 'constructor'],
    ['__proto__', 'listes.lister'],
    ['prospection', 'contacts.importer'],
  ])('registre fermé : %s %s', async (target, action) => {
    const { code, act } = await post(request(), target, action);

    expect(code).toBe(404);
    expect(act).not.toHaveBeenCalled();
  });

  it.each([
    ['sans corps', undefined],
    ['corps tableau', { payload: [] }],
    ['écriture sans clé de geste', { payload: { contacts: [] } }],
    ['clé de geste illisible', { payload: {}, idempotency_key: 'a b' }],
    [
      'trop gros',
      {
        payload: { x: 'x'.repeat(300_000) },
        idempotency_key: 'geste-12345678',
      },
    ],
  ])('refuse %s', async (_nom, body) => {
    const { code, act } = await post(request({ body }));

    expect(code).toBe(400);
    expect(act).not.toHaveBeenCalled();
  });

  it('une simulation et une lecture n exigent pas de clé de geste', async () => {
    expect(
      (await post(request({ body: { payload: { dry_run: true } } }))).code,
    ).toBe(200);
    expect(
      (
        await post(
          request({ body: { payload: {} } }),
          'notifuse',
          'listes.lister',
        )
      ).code,
    ).toBe(200);
  });

  it('aucune action du registre ne supprime ni n envoie', () => {
    for (const action of [
      'contacts.supprimer',
      'message.envoyer',
      'societes.ecrire',
    ]) {
      expect(findDelegatedAction('notifuse', action)).toBeNull();
      expect(findDelegatedAction('prospection', action)).toBeNull();
    }
  });
});
