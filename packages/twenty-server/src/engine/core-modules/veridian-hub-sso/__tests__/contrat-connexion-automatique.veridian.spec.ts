import { METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';

// La source et non `twenty-shared/utils` : le paquet compilé masquerait un sabotage de la garde.
import { createSingleNavigation } from '../../../../../../twenty-shared/src/utils/navigation/createSingleNavigation';

import { VeridianHubSsoController } from 'src/engine/core-modules/veridian-hub-sso/controllers/veridian-hub-sso.controller';
import { VeridianHubSsoService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service';

// Les voisins sont des bouchons, pour un test rapide : contrôleur, service et règles restent réels.
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

// CONTRAT-HUB §6bis.8.0, sans navigateur ni base : chaque cas casse si le comportement disparaît.
const SERVER = 'https://crm.staging.veridian.site';
const HUB = 'https://hub.staging.veridian.site';
const PREPARE = `${HUB}/api/auth/bounce/prepare`;

const fauxResponse = () => {
  const r = {
    code: 200,
    location: undefined as string | undefined,
    html: undefined as string | undefined,
    body: undefined as unknown,
    cookies: {} as Record<string, unknown>,
    status(code: number) {
      r.code = code;

      return r;
    },
    type() {
      return r;
    },
    send(html: string) {
      r.html = html;

      return r;
    },
    json(body: unknown) {
      r.body = body;

      return r;
    },
    redirect(url: string) {
      r.code = 302;
      r.location = url;

      return r;
    },
    cookie(name: string, value: unknown) {
      r.cookies[name] = value;

      return r;
    },
    clearCookie() {
      return r;
    },
  };

  return r;
};

const config = { get: () => SERVER } as never;

const welcome = async ({
  logout,
  next,
  returnToPath,
  headers = {},
}: {
  logout?: string;
  next?: string;
  returnToPath?: string;
  headers?: Record<string, string>;
}) => {
  const response = fauxResponse();
  const controller = new VeridianHubSsoController({} as never, config);

  await controller.welcome(
    logout as string,
    next as string,
    returnToPath as string,
    {
      protocol: 'https',
      headers: { host: 'crm.staging.veridian.site', ...headers },
    } as never,
    response as never,
  );

  return response;
};

const encoded = (url: string) => encodeURIComponent(url);

describe('CONTRAT-HUB §6bis.8.0', () => {
  beforeEach(() => {
    process.env.HUB_URL = HUB;
  });

  describe('1. sans session, navigation GET', () => {
    it('part vers prepare avec auto=1 et le chemin demandé (returnToPath)', async () => {
      const r = await welcome({ returnToPath: '/settings/profile' });

      expect(r.code).toBe(302);
      expect(r.location).toBe(
        `${PREPARE}?next=${encoded(`${SERVER}/settings/profile`)}&auto=1`,
      );
    });

    it('suit un next de la même origine', async () => {
      const next = 'https://acme.crm.staging.veridian.site/objects/people';
      const r = await welcome({ next });

      expect(r.location).toBe(`${PREPARE}?next=${encoded(next)}&auto=1`);
    });

    it('ignore un next étranger et un returnToPath hors chemin', async () => {
      const r = await welcome({
        next: 'https://evil.example/x',
        returnToPath: '//evil.example',
      });

      expect(r.location).toBe(`${PREPARE}?next=${encoded(SERVER)}&auto=1`);
    });

    it("pose le cookie d'essai avant de partir", async () => {
      const r = await welcome({});

      expect(r.cookies.veridian_hub_try).toBe('1');
    });
  });

  describe('2. après déconnexion', () => {
    it('page de connexion, cookie posé, pas de départ vers le Hub', async () => {
      const r = await welcome({ logout: '1' });

      expect(r.location).toBeUndefined();
      expect(r.cookies.veridian_signed_out).toBe('1');
      expect(r.html).toContain('Continuer');
      expect(r.html).not.toContain('auto=1');
    });

    it('le cookie de déconnexion bloque les passages suivants', async () => {
      const r = await welcome({ headers: { cookie: 'veridian_signed_out=1' } });

      expect(r.location).toBeUndefined();
      expect(r.html).toContain(PREPARE.replace(/&/g, '&amp;'));
      expect(r.html).not.toContain('auto=1');
    });
  });

  it("3. cookie d'essai présent au retour : page de connexion, pas de second départ", async () => {
    const r = await welcome({ headers: { cookie: 'veridian_hub_try=1' } });

    expect(r.location).toBeUndefined();
    expect(r.html).toContain('Continuer');
    expect(r.cookies.veridian_hub_try).toBeUndefined();
  });

  describe('4. jamais de rebond automatique', () => {
    it('en iframe', async () => {
      const r = await welcome({
        headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate' },
      });

      expect(r.location).toBeUndefined();
      expect(r.html).not.toContain('auto=1');
    });

    it('sur une requête qui n’est pas une navigation : 401', async () => {
      const r = await welcome({
        headers: { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' },
      });

      expect(r.code).toBe(401);
      expect(r.location).toBeUndefined();
    });

    it('sur un POST : la route ne répond qu’au GET', () => {
      expect(
        Reflect.getMetadata(
          METHOD_METADATA,
          VeridianHubSsoController.prototype.welcome,
        ),
      ).toBe(RequestMethod.GET);
    });
  });

  describe('5 et 6. service', () => {
    const fauxService = () => {
      const generateLoginToken = jest.fn().mockResolvedValue({ token: 'jeton' });
      const revokeAllSessionsForUser = jest.fn();
      const query = jest.fn().mockResolvedValue([{ workspaceId: 'ws' }]);
      const user = { id: 'u', email: 'a@b.fr', disabled: false };
      const service = new (VeridianHubSsoService as never as new (
        ...args: unknown[]
      ) => VeridianHubSsoService)(
        { findOne: jest.fn().mockResolvedValue(user) },
        { query },
        {},
        {
          findOne: jest.fn().mockResolvedValue({ userId: 'u' }),
        },
        {},
        { generateLoginToken },
        {},
        { tokenBucketThrottleOrThrow: jest.fn() },
        config,
        {},
        {},
        {},
        {},
        {},
        {},
        {},
        { revokeAllSessionsForUser },
      );

      return { service, query, revokeAllSessionsForUser };
    };

    it('5. issue-magic-link ignore un next d’une autre origine', async () => {
      const { service, query } = fauxService();
      const lien = await service.issueMagicLinkUrl(
        'h',
        'a@b.fr',
        'https://evil.example/x',
      );

      expect(lien).toBe(`${SERVER}/auth/token?t=jeton`);
      expect(query.mock.calls[0][1][2]).toBeNull();
    });

    it('5. issue-magic-link suit un next de son origine et son espace', async () => {
      const { service, query } = fauxService();
      const lien = await service.issueMagicLinkUrl(
        'h',
        'a@b.fr',
        'https://acme.crm.staging.veridian.site/objects/people',
      );

      expect(lien).toBe(
        `${SERVER}/auth/token?t=jeton&next=%2Fobjects%2Fpeople`,
      );
      expect(query.mock.calls[0][1][2]).toBe('acme');
    });

    it('6. revoke_sessions coupe les sessions de l’utilisateur', async () => {
      const { service, revokeAllSessionsForUser } = fauxService();

      await service.syncUser({ hubUserId: 'h', revokeSessions: true });

      expect(revokeAllSessionsForUser).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u' }),
      );
    });

    it('6. sans revoke_sessions, aucune session n’est coupée', async () => {
      const { service, revokeAllSessionsForUser } = fauxService();

      await service.syncUser({ hubUserId: 'h' });

      expect(revokeAllSessionsForUser).not.toHaveBeenCalled();
    });
  });

  describe('domaine nu : pas de boucle de navigation', () => {
    it('15 rendus sur la même URL ne lancent qu’une navigation', () => {
      const open = jest.fn();
      const navigate = createSingleNavigation(open);

      for (let rendu = 0; rendu < 15; rendu++) {
        navigate('https://app.crm.staging.veridian.site/welcome');
      }

      expect(open).toHaveBeenCalledTimes(1);
    });

    it('une autre URL navigue, et un autre onglet n’est jamais retenu', () => {
      const open = jest.fn();
      const navigate = createSingleNavigation(open);

      navigate('https://a/');
      navigate('https://b/');
      navigate('https://c/', '_blank');
      navigate('https://c/', '_blank');

      expect(open).toHaveBeenCalledTimes(4);
    });
  });
});
