import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { VeridianHubSsoService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service';

jest.mock(
  'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-role.service',
  () => ({ VeridianHubRoleService: class VeridianHubRoleService {} }),
);
jest.mock(
  'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-member-access.service',
  () => ({ VeridianHubMemberAccessService: class {} }),
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

// CONTRAT-HUB §5.19.2 et §3.8 : une fiche vivante sans appartenance vivante ferme l'espace à tous les autres (VER-203).
const fauxService = ({
  membership = { id: 'uw', userId: 'u', workspaceId: 'ws' } as unknown,
  memberships = [membership] as unknown[],
  activationStatus = WorkspaceActivationStatus.ACTIVE,
  disparu = false,
} = {}) => {
  const journal: string[] = [];
  const user = { id: 'u', email: 'b@b.fr', disabled: false };
  const workspace = { id: 'ws', activationStatus };
  const ecrire = (nom: string) =>
    jest.fn(async (...args: unknown[]) => {
      journal.push(`${nom} ${JSON.stringify(args)}`);
    });
  const repository = {
    softDelete: ecrire('fiche.softDelete'),
    restore: ecrire('fiche.restore'),
    update: ecrire('fiche.update'),
  };
  const service = new (VeridianHubSsoService as never as new (
    ...args: unknown[]
  ) => VeridianHubSsoService)(
    { findOne: jest.fn().mockResolvedValue(user), update: ecrire('user.update') },
    {
      findOne: jest.fn().mockResolvedValue(membership),
      find: jest.fn().mockResolvedValue(memberships),
    },
    { findOne: jest.fn().mockResolvedValue(disparu ? null : workspace) },
    { findOne: jest.fn().mockResolvedValue({ userId: 'u' }) },
    {},
    { generateLoginToken: jest.fn().mockResolvedValue({ token: 'jeton' }) },
    {},
    {},
    { get: () => 'https://crm.staging.veridian.site' },
    {
      signInUpOnExistingWorkspace: jest.fn(async () => {
        journal.push('signInUp');

        return user;
      }),
    },
    {},
    {
      setOnboardingConnectAccountPending: jest.fn(),
      setOnboardingInviteTeamPending: jest.fn(),
      setOnboardingCreateProfilePending: jest.fn(),
    },
    {},
    {
      deleteUserWorkspace: ecrire('appartenance.delete'),
      checkUserWorkspaceExists: jest.fn().mockResolvedValue(membership),
    },
    { invalidate: jest.fn() },
    {
      executeInWorkspaceContext: jest.fn(async (fn: () => unknown) => fn()),
      getRepositoryWithoutPermissionChecks: () => repository,
    },
    { revokeAllSessionsForUser: ecrire('sessions') },
    { invalidateAndRecompute: ecrire('cache') },
    { forgetRole: ecrire('role.oublie') },
    { close: ecrire('acces.ferme') },
  );

  (service as unknown as { clearOnboarding: unknown }).clearOnboarding =
    jest.fn();

  return { service, journal };
};

const FICHE = 'fiche.softDelete [{"userId":"u"}]';
const APPARTENANCE =
  'appartenance.delete [{"userWorkspaceId":"uw","workspaceId":"ws","softDelete":true}]';
const ACCES = 'acces.ferme ["u",[{"id":"uw","userId":"u","workspaceId":"ws"}]]';
const CACHE = 'cache ["ws",["flatWorkspaceMemberMaps"]]';

describe('retrait et retour d’un membre par le Hub', () => {
  it('remove-member retire la fiche et l’appartenance, et relit le cache', async () => {
    const { service, journal } = fauxService();

    expect(await service.removeMember('ws', 'h')).toBe(true);
    expect(journal).toEqual([FICHE, CACHE, APPARTENANCE, ACCES]);
  });

  it('remove-member dit combien de clés API ouvrent encore l’espace, et où les couper', async () => {
    const query = jest.fn().mockResolvedValue([{ count: 2 }]);
    const buildWorkspaceURL = jest.fn(
      ({ pathname }: { pathname: string }) =>
        new URL(pathname, 'https://espace.crm.staging.veridian.site'),
    );
    const service = Object.assign(
      Object.create(VeridianHubSsoService.prototype),
      {
        userRepository: { query },
        workspaceRepository: { findOneByOrFail: async () => ({ id: 'ws' }) },
        workspaceDomainsService: { buildWorkspaceURL },
      },
    ) as VeridianHubSsoService;

    expect(await service.describeApiKeys('ws')).toEqual({
      active_api_keys: 2,
      api_keys_url:
        'https://espace.crm.staging.veridian.site/settings/developers',
    });
    expect(query.mock.calls[0][0]).toContain('"revokedAt" IS NULL');
    expect(query.mock.calls[0][0]).toContain('"expiresAt" > now()');
    expect(query.mock.calls[0][1]).toEqual(['ws']);
  });

  it('remove-member rejoué répare une fiche orpheline et finit de fermer l’accès', async () => {
    const { service, journal } = fauxService({
      membership: null,
      memberships: [{ id: 'uw', userId: 'u', workspaceId: 'ws' }],
    });

    expect(await service.removeMember('ws', 'h')).toBe(false);
    expect(journal).toEqual([FICHE, CACHE, ACCES]);
  });

  it('users/sync deleted coupe l’accès avant de retirer les fiches', async () => {
    const { service, journal } = fauxService();

    await service.syncUser({ hubUserId: 'h', deleted: true });

    expect(journal[0]).toContain('user.update');
    expect(journal[1]).toContain('sessions');
    expect(journal.slice(2)).toEqual([FICHE, CACHE, APPARTENANCE, ACCES]);
  });

  it('un espace sans schéma ou supprimé n’empêche pas la coupure', async () => {
    for (const options of [
      { activationStatus: WorkspaceActivationStatus.PENDING_CREATION },
      { disparu: true },
    ]) {
      const { service, journal } = fauxService(options);

      await service.syncUser({ hubUserId: 'h', deleted: true });

      expect(journal).not.toContain(FICHE);
      expect(journal).toContain(APPARTENANCE);
    }
  });

  it('attach-member d’un ancien membre restaure sa fiche avant de le rattacher', async () => {
    const { service, journal } = fauxService({ membership: null });

    await service.attachMember({ workspaceId: 'ws', hubUserId: 'h', email: 'b@b.fr', emailProven: true });

    expect(journal).toEqual([
      'fiche.update [{"userId":"u"},{"userEmail":"b@b.fr"}]',
      'fiche.restore [{"userId":"u"}]',
      CACHE,
      'signInUp',
      'role.oublie ["ws","u"]',
    ]);
  });

  it('attach-member d’un membre en place ne touche pas à sa fiche', async () => {
    const { service, journal } = fauxService();

    await service.attachMember({ workspaceId: 'ws', hubUserId: 'h', email: 'b@b.fr', emailProven: true });

    expect(journal).toEqual(['signInUp']);
  });
});

describe('appartenance lue pour le document du Hub (CONTRAT-HUB §5.19.6)', () => {
  const lire = (memberships: unknown[]) =>
    fauxService({ memberships }).service.describeMembership({
      workspaceId: 'ws',
      hubUserId: 'hub',
    });

  it('présent, jamais venu, ou retiré à sa dernière date', async () => {
    expect(await lire([{ deletedAt: null }])).toEqual({
      isMember: true,
      isDisabled: false,
      removedAt: null,
    });
    expect(await lire([])).toEqual({
      isMember: false,
      isDisabled: false,
      removedAt: null,
    });
    expect(
      await lire([
        { deletedAt: new Date('2026-11-01') },
        { deletedAt: new Date('2026-11-09') },
        { deletedAt: new Date('2026-11-03') },
      ]),
    ).toEqual({
      isMember: false,
      isDisabled: false,
      removedAt: new Date('2026-11-09'),
    });
  });

  it('revenu après un retrait : présent', async () => {
    expect(
      await lire([{ deletedAt: new Date('2026-11-01') }, { deletedAt: null }]),
    ).toMatchObject({ isMember: true });
  });
});
