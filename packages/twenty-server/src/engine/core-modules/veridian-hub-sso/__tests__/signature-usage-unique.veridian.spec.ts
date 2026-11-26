import { createHash, createHmac } from 'crypto';

import { VeridianHubSsoController } from 'src/engine/core-modules/veridian-hub-sso/controllers/veridian-hub-sso.controller';
import { VeridianHubSsoService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service';

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

// CONTRAT-HUB §6bis.8.0, sans navigateur ni base : chaque cas casse si le comportement disparaît.

// Veridian (26/11/2026) : une requête signée par le Hub ne passe qu'une fois, et la v2 lie méthode, chemin, requête et
// corps (CONTRAT-HUB §6.1, Hub `lib/hmac/signature-hub.ts`, Notifuse `veridianHubMACv2`). Une signature captée ne se rejoue
// ni sur sa route ni sur une autre ; VERIDIAN_HMAC_REQUIRE_V2=true refuse la v1.
const SECRET = 'secret-de-test';

const signerV1 = (corps: Buffer, ts = String(Date.now())) => ({
  ts,
  signature: createHmac('sha256', SECRET).update(`${ts}.`).update(corps).digest('hex'),
});

const signerV2 = (methode: string, url: string, corps: Buffer, ts = String(Date.now())) => {
  const [chemin, ...requete] = url.split('?');
  const canon = [ts, methode, chemin, requete.join('?'), createHash('sha256').update(corps).digest('hex')].join('\n');

  return { ts, signature: createHmac('sha256', SECRET).update(canon).digest('hex') };
};

const fauxResponse = () => {
  const response = {
    statut: 0,
    corps: undefined as unknown,
    status(code: number) {
      response.statut = code;

      return response;
    },
    json(corps: unknown) {
      response.corps = corps;

      return response;
    },
  };

  return response;
};

const requete = (
  ts: string,
  signature: string,
  rawBody: Buffer,
  { methode = 'POST', url = '/api/tenants/x/sync-member', v2 = false } = {},
) =>
  ({
    headers: {
      'x-veridian-timestamp': ts,
      'x-veridian-hub-signature': signature,
      ...(v2 ? { 'x-veridian-sig-version': '2' } : {}),
    },
    method: methode,
    originalUrl: url,
    rawBody,
  }) as never;

type Porte = {
  isAuthenticHubCall: (request: never, response: never, signedPayload?: Buffer) => Promise<boolean>;
};

const controleur = (): Porte => {
  const vues = new Set<string>();
  const service = {
    consumeHubSignature: async (signature: string) => {
      if (vues.has(signature)) {
        return false;
      }
      vues.add(signature);

      return true;
    },
  };

  return new VeridianHubSsoController(
    service as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  ) as unknown as Porte;
};

describe('Veridian : signature du Hub à usage unique, v2 liée à la route', () => {
  const avant = { secret: process.env.HUB_API_SECRET, v2: process.env.VERIDIAN_HMAC_REQUIRE_V2 };

  beforeEach(() => {
    process.env.HUB_API_SECRET = SECRET;
    delete process.env.VERIDIAN_HMAC_REQUIRE_V2;
  });

  afterAll(() => {
    process.env.HUB_API_SECRET = avant.secret;
    process.env.VERIDIAN_HMAC_REQUIRE_V2 = avant.v2;
  });

  it('accepte une requête v1 signée la première fois (témoin)', async () => {
    const corps = Buffer.from('{"a":1}');
    const { ts, signature } = signerV1(corps);
    const response = fauxResponse();

    await expect(controleur().isAuthenticHubCall(requete(ts, signature, corps), response as never)).resolves.toBe(true);
    expect(response.statut).toBe(0);
  });

  it('refuse la même requête v1 rejouée', async () => {
    const corps = Buffer.from('{"a":1}');
    const { ts, signature } = signerV1(corps);
    const c = controleur();

    await c.isAuthenticHubCall(requete(ts, signature, corps), fauxResponse() as never);
    const rejeu = fauxResponse();

    await expect(c.isAuthenticHubCall(requete(ts, signature, corps), rejeu as never)).resolves.toBe(false);
    expect(rejeu.statut).toBe(401);
    expect(rejeu.corps).toEqual({ error: 'signature_already_used' });
  });

  it('refuse une signature v1 sans corps (lecture) rejouée sur une suppression', async () => {
    const vide = Buffer.alloc(0);
    const { ts, signature } = signerV1(vide);
    const c = controleur();

    await expect(
      c.isAuthenticHubCall(requete(ts, signature, vide, { methode: 'GET', url: '/api/hub/users' }), fauxResponse() as never, vide),
    ).resolves.toBe(true);
    const suppression = fauxResponse();

    await expect(
      c.isAuthenticHubCall(requete(ts, signature, vide, { methode: 'DELETE', url: '/api/tenants/t1' }), suppression as never, vide),
    ).resolves.toBe(false);
    expect(suppression.statut).toBe(401);
  });

  it('accepte deux appels distincts du Hub, chacun signé à nouveau', async () => {
    const corps = Buffer.from('{"a":1}');
    const c = controleur();
    const premier = signerV1(corps, String(Date.now()));
    const second = signerV1(corps, String(Date.now() + 1));

    await expect(c.isAuthenticHubCall(requete(premier.ts, premier.signature, corps), fauxResponse() as never)).resolves.toBe(true);
    await expect(c.isAuthenticHubCall(requete(second.ts, second.signature, corps), fauxResponse() as never)).resolves.toBe(true);
  });

  it('refuse toujours une signature fausse', async () => {
    const corps = Buffer.from('{"a":1}');
    const { ts } = signerV1(corps);
    const response = fauxResponse();

    await expect(controleur().isAuthenticHubCall(requete(ts, 'f'.repeat(64), corps), response as never)).resolves.toBe(false);
    expect(response.corps).toEqual({ error: 'invalid_signature' });
  });

  it('accepte une signature v2 sur sa route, requête comprise (témoin)', async () => {
    const vide = Buffer.alloc(0);
    const url = '/api/users/by-email?email=a%40b.fr';
    const { ts, signature } = signerV2('GET', url, vide);

    await expect(
      controleur().isAuthenticHubCall(requete(ts, signature, vide, { methode: 'GET', url, v2: true }), fauxResponse() as never, vide),
    ).resolves.toBe(true);
  });

  it('refuse une signature v2 neuve présentée sur une autre route, une autre méthode ou une autre requête', async () => {
    const vide = Buffer.alloc(0);
    const { ts, signature } = signerV2('GET', '/api/hub/users', vide);

    for (const [methode, url] of [
      ['DELETE', '/api/tenants/t1'],
      ['DELETE', '/api/hub/users'],
      ['GET', '/api/hub/users?x=1'],
    ]) {
      const response = fauxResponse();

      await expect(
        controleur().isAuthenticHubCall(requete(ts, signature, vide, { methode, url, v2: true }), response as never, vide),
      ).resolves.toBe(false);
      expect(response.corps).toEqual({ error: 'invalid_signature' });
    }
  });

  it('refuse une signature v2 dont le corps a changé', async () => {
    const url = '/api/tenants/t1/remove-member';
    const { ts, signature } = signerV2('POST', url, Buffer.from('{"a":1}'));
    const response = fauxResponse();

    await expect(
      controleur().isAuthenticHubCall(requete(ts, signature, Buffer.from('{"a":2}'), { url, v2: true }), response as never),
    ).resolves.toBe(false);
  });

  it('refuse la même requête v2 rejouée', async () => {
    const url = '/api/tenants/t1/remove-member';
    const corps = Buffer.from('{"a":1}');
    const { ts, signature } = signerV2('POST', url, corps);
    const c = controleur();

    await expect(c.isAuthenticHubCall(requete(ts, signature, corps, { url, v2: true }), fauxResponse() as never)).resolves.toBe(true);
    const rejeu = fauxResponse();

    await expect(c.isAuthenticHubCall(requete(ts, signature, corps, { url, v2: true }), rejeu as never)).resolves.toBe(false);
    expect(rejeu.corps).toEqual({ error: 'signature_already_used' });
  });

  it('VERIDIAN_HMAC_REQUIRE_V2=true refuse la v1 et garde la v2', async () => {
    process.env.VERIDIAN_HMAC_REQUIRE_V2 = 'true';
    const corps = Buffer.from('{"a":1}');
    const v1 = signerV1(corps);
    const refus = fauxResponse();

    await expect(controleur().isAuthenticHubCall(requete(v1.ts, v1.signature, corps), refus as never)).resolves.toBe(false);
    expect(refus.corps).toEqual({ error: 'signature_v2_required' });

    const url = '/api/tenants/x/sync-member';
    const v2 = signerV2('POST', url, corps);

    await expect(
      controleur().isAuthenticHubCall(requete(v2.ts, v2.signature, corps, { url, v2: true }), fauxResponse() as never),
    ).resolves.toBe(true);
  });

  it("le service ne laisse passer une signature qu'une fois, par un verrou Redis qui expire après la fenêtre", async () => {
    const poses = new Map<string, number>();
    const service = Object.assign(Object.create(VeridianHubSsoService.prototype), {
      cacheStorage: {
        setIfAbsent: async (cle: string, _valeur: unknown, ttl: number) => {
          if (poses.has(cle)) {
            return false;
          }
          poses.set(cle, ttl);

          return true;
        },
      },
    }) as VeridianHubSsoService;

    await expect(service.consumeHubSignature('a'.repeat(64))).resolves.toBe(true);
    await expect(service.consumeHubSignature('a'.repeat(64))).resolves.toBe(false);
    await expect(service.consumeHubSignature('b'.repeat(64))).resolves.toBe(true);
    expect([...poses.values()].every((ttl) => ttl >= 10 * 60 * 1000)).toBe(true);
    expect([...poses.keys()].every((cle) => !cle.includes('a'.repeat(64)))).toBe(true);
  });
});
