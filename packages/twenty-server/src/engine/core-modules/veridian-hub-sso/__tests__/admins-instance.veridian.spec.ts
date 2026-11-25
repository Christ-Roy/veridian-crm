import { VeridianHubSsoService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service';
import { parseServerAdmins } from 'src/engine/core-modules/veridian-hub-sso/utils/parse-server-admins.util';

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



// L'administrateur d'instance se désigne par hub_user_id : une adresse change de main, le droit non.
const ADMIN = '53245ae1-6bf8-4ec6-870f-32d75b7c0281';
const AUTRE = '22222222-2222-4222-8222-222222222222';
const ADRESSE = 'admin@liste.fr';

const juger = async (
  hubUserId: string,
  droits: { canAccessFullAdminPanel: boolean; canImpersonate: boolean },
) => {
  const update = jest.fn();
  const service = Object.assign(Object.create(VeridianHubSsoService.prototype), {
    userRepository: { update },
    coreEntityCacheService: { invalidate: jest.fn() },
    logger: { error: jest.fn() },
  });

  await service.applyServerAdminFlag(
    { id: 'u', email: ADRESSE, ...droits },
    hubUserId,
  );

  return update.mock.calls[0]?.[1];
};
const NU = { canAccessFullAdminPanel: false, canImpersonate: false };
const PLEIN = { canAccessFullAdminPanel: true, canImpersonate: true };

describe('administrateur d instance par hub_user_id', () => {
  beforeEach(() => {
    process.env.HUB_SERVER_ADMIN_EMAILS = ADRESSE;
    process.env.HUB_SERVER_ADMIN_HUB_USER_IDS = ` ${ADMIN.toUpperCase()} `;
  });

  afterEach(() => {
    delete process.env.HUB_SERVER_ADMIN_EMAILS;
    delete process.env.HUB_SERVER_ADMIN_HUB_USER_IDS;
  });

  it('celui qui prend l adresse listée n obtient rien', async () => {
    expect(await juger(AUTRE, NU)).toBeUndefined();
  });

  it('celui qui l aurait eue par son adresse la perd', async () => {
    expect(await juger(AUTRE, PLEIN)).toEqual(NU);
  });

  it('la bonne personne l a, et la garde', async () => {
    expect(await juger(ADMIN, NU)).toEqual(PLEIN);
    expect(await juger(ADMIN, PLEIN)).toBeUndefined();
  });

  it.each([undefined, '', ' , ', ADRESSE, `${ADMIN},${ADRESSE}`])(
    'liste illisible (%s) : personne n est promu ni déchu',
    async (liste) => {
      if (liste === undefined) {
        delete process.env.HUB_SERVER_ADMIN_HUB_USER_IDS;
      } else {
        process.env.HUB_SERVER_ADMIN_HUB_USER_IDS = liste;
      }

      expect(parseServerAdmins(process.env.HUB_SERVER_ADMIN_HUB_USER_IDS)).toBeNull();
      expect(await juger(ADMIN, NU)).toBeUndefined();
      expect(await juger(ADMIN, PLEIN)).toBeUndefined();
    },
  );

  it('plusieurs identités', () => {
    expect(parseServerAdmins(`${ADMIN}, ${AUTRE}`)).toEqual(
      new Set([ADMIN, AUTRE]),
    );
  });

  it('la liste des comptes dit qui administre l instance', async () => {
    const service = Object.assign(
      Object.create(VeridianHubSsoService.prototype),
      {
        userRepository: {
          query: async () => [
            { key: `veridian.hub_user:${ADMIN}`, email: ADRESSE, firstName: 'A', lastName: 'B', serverAdmin: true },
          ],
        },
      },
    );

    expect(await service.listUsers()).toEqual([
      { hub_user_id: ADMIN, email: ADRESSE, name: 'A B', server_admin: true },
    ]);
  });
});
