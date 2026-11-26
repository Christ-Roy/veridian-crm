import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { VeridianHubSsoController } from 'src/engine/core-modules/veridian-hub-sso/controllers/veridian-hub-sso.controller';
import { VeridianHubSsoService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service';

jest.mock(
  'src/engine/core-modules/application/application-install/services/application-lifecycle-job.service',
  () => ({ ApplicationLifecycleJobService: class ApplicationLifecycleJobService {} }),
);

jest.mock(
  'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-member-access.service',
  () => ({ VeridianHubMemberAccessService: class {} }),
);
jest.mock(
  'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-role.service',
  () => ({ VeridianHubRoleService: class VeridianHubRoleService {} }),
);
jest.mock('src/engine/core-modules/auth/services/sign-in-up.service', () => ({
  SignInUpService: class SignInUpService {},
}));
jest.mock('src/engine/core-modules/auth/token/services/login-token.service', () => ({
  LoginTokenService: class LoginTokenService {},
}));
jest.mock('src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service', () => ({
  WorkspaceDomainsService: class WorkspaceDomainsService {},
}));
jest.mock('src/engine/core-modules/onboarding/onboarding.service', () => ({
  OnboardingService: class OnboardingService {},
}));
jest.mock('src/engine/core-modules/throttler/throttler.service', () => ({
  ThrottlerService: class ThrottlerService {},
}));
jest.mock('src/engine/core-modules/twenty-config/twenty-config.service', () => ({
  TwentyConfigService: class TwentyConfigService {},
}));
jest.mock('src/engine/core-modules/user-session/services/user-session.service', () => ({
  UserSessionService: class UserSessionService {},
}));
jest.mock('src/engine/core-modules/user-workspace/user-workspace.entity', () => ({
  UserWorkspaceEntity: class UserWorkspaceEntity {},
}));
jest.mock('src/engine/core-modules/user-workspace/user-workspace.service', () => ({
  UserWorkspaceService: class UserWorkspaceService {},
}));
jest.mock('src/engine/core-modules/user/services/user.service', () => ({
  UserService: class UserService {},
}));
jest.mock('src/engine/core-modules/user/user.entity', () => ({
  UserEntity: class UserEntity {},
}));
jest.mock('src/engine/core-modules/workspace/services/workspace.service', () => ({
  WorkspaceService: class WorkspaceService {},
}));
jest.mock('src/engine/core-modules/workspace/workspace.entity', () => ({
  WorkspaceEntity: class WorkspaceEntity {},
}));
jest.mock('src/engine/core-modules/cache-storage/services/cache-storage.service', () => ({
  CacheStorageService: class CacheStorageService {},
}));
jest.mock('src/engine/core-modules/key-value-pair/key-value-pair.entity', () => ({
  KeyValuePairEntity: class KeyValuePairEntity {},
  KeyValuePairType: { USER_VARIABLE: 'USER_VARIABLE' },
}));
jest.mock('src/engine/core-entity-cache/services/core-entity-cache.service', () => ({
  CoreEntityCacheService: class CoreEntityCacheService {},
}));
jest.mock('src/engine/workspace-cache/services/workspace-cache.service', () => ({
  WorkspaceCacheService: class WorkspaceCacheService {},
}));
jest.mock('src/engine/twenty-orm/workspace-orm.manager', () => ({
  WorkspaceOrmManager: class WorkspaceOrmManager {},
}));
jest.mock('src/engine/twenty-orm/utils/build-system-auth-context.util', () => ({
  buildSystemAuthContext: () => ({}),
}));
jest.mock('src/engine/guards/no-permission.guard', () => ({
  NoPermissionGuard: class NoPermissionGuard {},
}));
jest.mock('src/engine/guards/public-endpoint.guard', () => ({
  PublicEndpointGuard: class PublicEndpointGuard {},
}));


jest.mock(
  'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-organisation.service',
  () => ({ VeridianHubOrganisationService: class {} }),
);
jest.mock(
  'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-suspension.service',
  () => ({ VeridianHubSuspensionService: class {} }),
);

// CONTRAT-HUB §5.19.7 : une personne se désigne par hub_user_id, l'adresse n'est qu'une information.
const JEAN = '11111111-1111-4111-8111-111111111111';
const NEUF = '22222222-2222-4222-8222-222222222222';
const INCONNU = '33333333-3333-4333-8333-333333333333';
const TENANT = '44444444-4444-4444-8444-444444444444';
const ANCIENNE = 'jean@ancienne.fr';

// Jean a changé d'adresse au Hub ; un compte neuf a repris l'ancienne.
const monter = ({
  proprietaire = JEAN as string | null | undefined,
  sansLien = false,
  espacesQuittes = false,
} = {}) => {
  const comptes = [
    { id: 'jean', email: 'jean@nouvelle.fr', disabled: false },
    { id: 'neuf', email: ANCIENNE, disabled: false },
  ];
  const liens: Record<string, string> = { [JEAN]: 'jean' };

  if (!sansLien) {
    liens[NEUF] = 'neuf';
  }

  const fil: string[] = [];
  const tenant = {
    workspaceId: 'ws',
    value: { ownerEmail: ANCIENNE, plan: 'pro', ownerHubUserId: proprietaire },
  };
  const requetes = jest.fn(async (_sql: string, _valeurs: unknown[]) => []);
  const conversion = jest.fn();
  const maj = jest.fn();
  const service = new (VeridianHubSsoService as never as new (
    ...args: unknown[]
  ) => VeridianHubSsoService)(
    {
      findOne: jest.fn(async ({ where }: { where: Record<string, string> }) =>
        comptes.find(
          (compte) =>
            compte.id === where.id ||
            (where.email !== undefined && compte.email === where.email),
        ) ?? null,
      ),
      query: requetes,
      update: jest.fn(async (id: string, champs: object) => {
        fil.push(`compte ${id} ${JSON.stringify(champs)}`);
      }),
    },
    {
      findOne: jest.fn(async ({ where }: { where: { userId: string } }) => ({
        id: `uw-${where.userId}`,
      })),
      // Parti d'un espace (deux fois), présent dans un autre.
      find: jest.fn(
        async ({
          where,
          withDeleted,
        }: {
          where: { userId: string };
          withDeleted?: boolean;
        }) => [
          { workspaceId: `ws-${where.userId}`, deletedAt: null },
          ...(withDeleted && espacesQuittes
            ? [
                { workspaceId: 'quitte', deletedAt: new Date() },
                { workspaceId: 'quitte', deletedAt: new Date() },
                { workspaceId: 'disparu', deletedAt: new Date() },
                { workspaceId: 'sans-schema', deletedAt: new Date() },
              ]
            : []),
        ],
      ),
    },
    {
      findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'disparu'
          ? null
          : {
              id: where.id,
              activationStatus:
                where.id === 'sans-schema'
                  ? WorkspaceActivationStatus.PENDING_CREATION
                  : WorkspaceActivationStatus.ACTIVE,
            },
      ),
    },
    {
      query: conversion,
      save: jest.fn(async (entree: { key: string; userId: string }) => {
        fil.push(`lien ${entree.key} ${entree.userId}`);
      }),
      findOne: jest.fn(
        async ({ where }: { where: { key: unknown; userId?: string } }) => {
          if (where.key === `veridian.hub_tenant:${TENANT}`) {
            return tenant;
          }

          if (typeof where.key === 'string') {
            const userId = liens[where.key.slice('veridian.hub_user:'.length)];

            return userId ? { userId } : null;
          }

          return Object.values(liens).includes(where.userId as string)
            ? { id: 'autre lien' }
            : null;
        },
      ),
    },
    {},
    { generateLoginToken: jest.fn(async () => ({ token: 'jeton' })) },
    {},
    { tokenBucketThrottleOrThrow: jest.fn() },
    { get: () => 'https://crm.staging.veridian.site' },
    {
      signInUpOnExistingWorkspace: jest.fn(async ({ userData }: never) => {
        const { type, existingUser } = userData as {
          type: string;
          existingUser?: { id: string; email: string };
        };

        fil.push(`entrée ${existingUser?.id ?? type}`);

        return existingUser ?? { id: 'cree', email: 'x' };
      }),
    },
    {},
    {
      setOnboardingConnectAccountPending: jest.fn(),
      setOnboardingInviteTeamPending: jest.fn(),
      setOnboardingCreateProfilePending: jest.fn(),
      setOnboardingBookCallPending: jest.fn(),
    },
    { updateEmailFromVerificationToken: maj },
    {
      deleteUserWorkspace: jest.fn(async ({ userWorkspaceId }: never) => {
        fil.push(`retrait ${userWorkspaceId}`);
      }),
      checkUserWorkspaceExists: jest.fn(async () => true),
    },
    { invalidate: jest.fn() },
    {
      executeInWorkspaceContext: jest.fn(async (fn: () => unknown) => fn()),
      getRepositoryWithoutPermissionChecks: () => ({
        softDelete: jest.fn(async ({ userId }: never) => {
          fil.push(`fiche ${userId}`);
        }),
        update: jest.fn(async ({ userId }: never, champs: object) => {
          fil.push(`fiche ${userId} ${JSON.stringify(champs)}`);
        }),
      }),
    },
    {
      revokeAllSessionsForUser: jest.fn(async () => {
        fil.push('sessions');
      }),
    },
    { invalidateAndRecompute: jest.fn() },
    { forgetRole: jest.fn() },
    {
      close: jest.fn(async (userId: string) => {
        fil.push(`accès ${userId}`);
      }),
    },
  );

  return { service, fil, requetes, conversion, maj };
};

const rattacher = (m: ReturnType<typeof monter>, champs: object) =>
  m.service.attachMember({
    workspaceId: 'ws',
    hubUserId: JEAN,
    email: ANCIENNE,
    emailProven: true,
    ...champs,
  });

describe('identité par hub_user_id (CONTRAT-HUB §5.19.7)', () => {
  it('retrait : la personne visée, jamais celle qui a repris son ancienne adresse', async () => {
    const m = monter();

    expect(await m.service.removeMember('ws', JEAN)).toBe(true);
    expect(m.fil).toEqual(['fiche jean', 'retrait uw-jean', 'accès jean']);
  });

  it('retrait d un inconnu : faux, rien n est touché', async () => {
    const m = monter();

    expect(await m.service.removeMember('ws', INCONNU)).toBe(false);
    expect(m.fil).toEqual([]);
  });

  it('rattachement : le compte relié, même sous une autre adresse', async () => {
    const m = monter();

    expect(await rattacher(m, {})).toMatchObject({ status: 'ok', userId: 'jean' });
    expect(m.fil).toEqual(['entrée jean']);
  });

  it('rattachement : une adresse portée par un compte relié à un autre est refusée', async () => {
    const m = monter();

    expect(await rattacher(m, { hubUserId: INCONNU })).toEqual({
      status: 'hub_user_conflict',
    });
    expect(m.fil).toEqual([]);
  });

  it.each([
    [false, 'hub_user_conflict', []],
    [
      true,
      'ok',
      [`lien veridian.hub_user:${INCONNU} neuf`, 'entrée neuf'],
    ],
  ])('compte sans lien, adresse prouvée %s : %s', async (emailProven, status, fil) => {
    const m = monter({ sansLien: true });

    expect(
      await rattacher(m, { hubUserId: INCONNU, emailProven }),
    ).toMatchObject({ status });
    expect(m.fil).toEqual(fil);
  });

  it('appartenance : jamais lue par l adresse', async () => {
    const m = monter();

    expect(
      await m.service.describeMembership({ workspaceId: 'ws', hubUserId: INCONNU }),
    ).toEqual({ isMember: false, isDisabled: false, removedAt: null });
  });

  it('rebond : une adresse prise par un autre n ouvre rien', async () => {
    const m = monter();

    expect(
      await m.service.issueMagicLinkUrl(INCONNU, ANCIENNE, undefined, true),
    ).toBeNull();
  });

  it('rebond : un compte sans lien ne s ouvre que si l adresse est prouvée', async () => {
    const m = monter({ sansLien: true });

    expect(
      await m.service.issueMagicLinkUrl(INCONNU, ANCIENNE),
    ).toBeNull();
    expect(m.fil).toEqual([]);
  });

  it.each([
    ['le même, autre adresse', JEAN, JEAN, 'ok'],
    ['le neuf, avec l ancienne adresse', JEAN, NEUF, 'owner_mismatch'],
    ['propriétaire jamais retrouvé', null, JEAN, 'owner_mismatch'],
    ['inconnu', JEAN, INCONNU, 'owner_mismatch'],
    ['propriétaire sans copie locale', INCONNU, INCONNU, 'owner_mismatch'],
  ])('création rejouée, %s', async (_, proprietaire, hubUserId, status) => {
    const m = monter({ proprietaire });

    expect(
      await m.service.provisionTenant({
        tenantId: TENANT,
        ownerEmail: 'peu@importe.fr',
        workspaceName: 'x',
        hubUserId: hubUserId as string,
        plan: 'pro',
        emailProven: true,
      }),
    ).toMatchObject({ status });
    expect(m.fil).toEqual([]);
  });

  it('changement d adresse vers celle d un autre : refusé, ni sessions ni nom', async () => {
    const m = monter();

    expect(
      await m.service.syncUser({
        hubUserId: JEAN,
        email: 'JEAN@ancienne.fr',
        name: 'Jean Neuf',
        revokeSessions: true,
      }),
    ).toBe('email_conflict');
    expect(m.maj).not.toHaveBeenCalled();
    expect(m.fil).toEqual([]);
  });

  it('la fiche d un espace quitté suit l adresse aussi, une fois, les espaces morts sont sautés', async () => {
    const m = monter({ espacesQuittes: true });

    await m.service.syncUser({ hubUserId: JEAN, email: 'libre@x.fr' });
    expect(m.fil).toEqual([
      'fiche jean {"userEmail":"libre@x.fr"}',
      'fiche jean {"userEmail":"libre@x.fr"}',
    ]);
  });

  it('adresse prise entre la lecture et l écriture : même refus', async () => {
    const m = monter();

    m.maj.mockRejectedValue(Object.assign(new Error('x'), { code: '23505' }));
    expect(
      await m.service.syncUser({
        hubUserId: JEAN,
        email: 'libre@x.fr',
        revokeSessions: true,
      }),
    ).toBe('email_conflict');
    expect(m.fil).toEqual([]);
  });

  it('une autre panne n est pas maquillée en conflit', async () => {
    const m = monter();

    m.maj.mockRejectedValue(new Error('base'));
    await expect(
      m.service.syncUser({ hubUserId: JEAN, email: 'libre@x.fr' }),
    ).rejects.toThrow('base');
  });

  it('adresse libre, nom : écrits ; sans champ : rien ; inconnu : dit', async () => {
    const m = monter();

    expect(
      await m.service.syncUser({
        hubUserId: JEAN,
        email: 'Libre@x.fr',
        name: 'Jean Neuf',
      }),
    ).toBe('synced');
    expect(m.maj).toHaveBeenCalledWith('jean', 'libre@x.fr');
    expect(m.fil).toEqual([
      'fiche jean {"userEmail":"libre@x.fr"}',
      'compte jean {"firstName":"Jean","lastName":"Neuf"}',
      'fiche jean {"name":{"firstName":"Jean","lastName":"Neuf"}}',
    ]);

    const vide = monter();

    expect(await vide.service.syncUser({ hubUserId: JEAN })).toBe('synced');
    expect(vide.fil).toEqual([]);
    expect(await vide.service.syncUser({ hubUserId: INCONNU })).toBe(
      'user_not_in_app',
    );
  });

  it('liste : par hub_user_id d abord, l adresse seulement sans lui, propriétaire par son lien', async () => {
    const m = monter();

    m.requetes.mockResolvedValue([
      { tenantKey: null, activationStatus: 'ACTIVE', isOwner: true, link: { ownerEmail: 'x' } },
      { tenantKey: null, activationStatus: 'ACTIVE', isOwner: false, link: { ownerEmail: ANCIENNE } },
    ] as never);
    const lus = await m.service.listWorkspaces({ hubUserId: JEAN, email: ANCIENNE });

    expect(lus.map(({ role }) => role)).toEqual(['owner', 'member']);
    expect(m.requetes.mock.calls[0][1][0]).toBe(`veridian.hub_user:${JEAN}`);
    expect(m.requetes.mock.calls[0][0]).not.toContain('u.email = $1');
    expect(m.requetes.mock.calls[0][0]).toContain("k.value->>'ownerHubUserId'");

    await m.service.listWorkspaces({ email: 'Jean@x.fr' });
    expect(m.requetes.mock.calls[1][1][0]).toBe('jean@x.fr');
    expect(m.requetes.mock.calls[1][0]).toContain('u.email = $1');
  });

  it('conversion des propriétaires : une seule fois, sans lien unique rien n est deviné', async () => {
    const m = monter();

    m.conversion.mockResolvedValue([[{ owner: JEAN }, { owner: null }], 2]);
    await m.service.onApplicationBootstrap();

    const sql = m.conversion.mock.calls[0][0] as string;

    expect(sql).toContain("NOT k.value ? 'ownerHubUserId'");
    expect(sql).toContain('CASE WHEN count(*) = 1 THEN');
    expect(m.conversion.mock.calls[0][1]).toEqual([19]);
    m.conversion.mockRejectedValue(new Error('base fermée'));
    await expect(m.service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});

describe('routes : hub_user_id obligatoire (CONTRAT-HUB §5.19.7)', () => {
  const route = (service: object) => {
    const controller = Object.create(
      VeridianHubSsoController.prototype,
    ) as VeridianHubSsoController;

    Object.assign(controller, {
      veridianHubSsoService: service,
      isAuthenticHubCall: () => true,
    });

    return controller;
  };
  const repondre = () => {
    const r = { code: 0, corps: {} as Record<string, unknown> };

    return {
      r,
      response: {
        status: (code: number) => {
          r.code = code;

          return { json: (corps: never) => (r.corps = corps) };
        },
      } as never,
    };
  };

  it.each([
    ['removeMember', [TENANT], { email: ANCIENNE }],
    ['syncMember', [TENANT], { user_email: ANCIENNE }],
    ['attachMember', [TENANT], { hub_user_email: ANCIENNE }],
    ['syncUser', [], { email: ANCIENNE }],
    ['syncUser', [], { hub_user_id: JEAN, email: 12 }],
  ])('%s sans hub_user_id lisible : 400 invalid_payload', async (nom, params, body) => {
    const { r, response } = repondre();

    await (route({}) as never as Record<string, (...a: unknown[]) => unknown>)[
      nom
    ](...params, { body }, response);
    expect(r).toEqual({ code: 400, corps: { error: 'invalid_payload' } });
  });

  it('remove-member ignore l adresse et rend la personne', async () => {
    const removeMember = jest.fn(async () => true);
    const { r, response } = repondre();

    await route({
      findWorkspaceIdByTenant: async () => 'ws',
      removeMember,
      describeApiKeys: async () => ({ active_api_keys: 0 }),
    }).removeMember(
      TENANT,
      { body: { hub_user_id: JEAN, email: ANCIENNE } } as never,
      response,
    );
    expect(removeMember).toHaveBeenCalledWith('ws', JEAN);
    expect(r.corps).toMatchObject({
      hub_user_id: JEAN,
      removed: true,
      removed_at: expect.any(String),
    });
  });

  it.each([
    ['email_conflict', 409],
    ['user_not_in_app', 404],
    ['synced', 200],
  ])('users/sync %s : %s', async (issue, code) => {
    const { r, response } = repondre();

    await route({ syncUser: async () => issue }).syncUser(
      { body: { hub_user_id: JEAN } } as never,
      response,
    );
    expect(r.code).toBe(code);
  });

  it('provision : owner_hub_user_id passe avant metadata, l adresse prouvée est transmise', async () => {
    const provisionTenant = jest.fn(async () => ({ status: 'owner_mismatch' }));
    const { r, response } = repondre();

    await route({ provisionTenant }).provision(
      {
        body: {
          tenant_id: TENANT,
          owner_email: ANCIENNE,
          workspace_name: 'x',
          plan: 'pro',
          owner_hub_user_id: JEAN,
          email_proven: true,
          metadata: { hub_user_id: NEUF },
        },
      } as never,
      response,
    );
    expect(provisionTenant).toHaveBeenCalledWith(
      expect.objectContaining({ hubUserId: JEAN, emailProven: true }),
    );
    expect(r).toEqual({ code: 409, corps: { error: 'owner_mismatch' } });

    await route({ provisionTenant }).provision(
      {
        body: {
          tenant_id: TENANT,
          owner_email: ANCIENNE,
          workspace_name: 'x',
          plan: 'pro',
          email_proven: 'true',
          metadata: { hub_user_id: NEUF },
        },
      } as never,
      response,
    );
    expect(provisionTenant).toHaveBeenLastCalledWith(
      expect.objectContaining({ hubUserId: NEUF, emailProven: false }),
    );
  });

  it.each([
    ['attachMember', 'hub_user_email'],
    ['syncMember', 'user_email'],
  ])('%s : adresse prouvée seulement si le Hub le dit', async (nom, champ) => {
    for (const email_proven of [true, 'true', undefined]) {
      const attachMember = jest.fn(async () => ({ status: 'hub_user_conflict' }));
      const { r, response } = repondre();

      await (
        route({
          attachMember,
          findWorkspaceIdByTenant: async () => TENANT,
        }) as never as Record<string, (...a: unknown[]) => unknown>
      )[nom](
        TENANT,
        { body: { hub_user_id: JEAN, [champ]: ANCIENNE, email_proven } },
        response,
      );
      expect(attachMember).toHaveBeenCalledWith(
        expect.objectContaining({ emailProven: email_proven === true }),
      );
      expect(r.code).toBe(409);
    }
  });

  it('by-email : un hub_user_id illisible est refusé, jamais ignoré au profit de l adresse', async () => {
    const { r, response } = repondre();

    await route({}).usersByEmail('x', ANCIENNE, {} as never, response);
    expect(r.code).toBe(400);
  });
});
