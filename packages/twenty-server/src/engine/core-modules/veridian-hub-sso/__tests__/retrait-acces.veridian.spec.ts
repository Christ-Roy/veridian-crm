jest.mock('src/engine/core-modules/cache-storage/services/cache-storage.service', () => ({
  CacheStorageService: class {},
}));
jest.mock('src/engine/core-modules/user-session/services/user-session.service', () => ({
  UserSessionService: class {},
}));
jest.mock('src/engine/subscriptions/event-stream.service', () => ({
  EventStreamService: class {},
}));
jest.mock('src/engine/core-modules/app-token/app-token.entity', () => ({
  AppTokenEntity: class {},
  AppTokenType: { RefreshToken: 'REFRESH_TOKEN' },
}));

import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { VeridianHubMemberAccessService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-member-access.service';

// Mesuré le 25/11/2026 : 60 s après un retrait, jeton, REST, MCP, cookie et flux en direct lisaient encore l'espace.
// Le vrai cache, deux processus, une seule base et un seul Redis.
const APPARTENANCE = '55555555-5555-4555-8555-555555555555';
const attendre = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const monter = () => {
  const redis = new Map<string, unknown>();
  let presente: object | null = { id: APPARTENANCE, workspaceId: 'ws' };
  let retenue: Promise<void> | null = null;
  const stockage = {
    get: async (cle: string) => redis.get(cle),
    mget: async (cles: string[]) => cles.map((cle) => redis.get(cle)),
    mset: async (entrees: { key: string; value: unknown }[]) =>
      entrees.forEach(({ key, value }) => redis.set(key, value)),
    mdel: async (cles: string[]) => cles.forEach((cle) => redis.delete(cle)),
  };
  const processus = () => {
    const cache = new (CoreEntityCacheService as never as new (
      ...args: unknown[]
    ) => CoreEntityCacheService)(stockage, {}, {});

    (cache as never as { coreEntityCacheProviders: Map<string, unknown> }).coreEntityCacheProviders.set(
      'userWorkspaceEntity',
      {
        computeForCache: async () => {
          const lue = presente;

          await retenue;

          return lue;
        },
      },
    );

    return {
      cache,
      ouvert: async () =>
        (await cache.get('userWorkspaceEntity', APPARTENANCE)) !== null,
    };
  };
  const a = processus();
  const b = processus();
  const flux = new Map<string, { authContext: { userId?: string } }>([
    ['ws/sien', { authContext: { userId: 'u' } }],
    ['ws/autre', { authContext: { userId: 'v' } }],
    ['ws/cle', { authContext: {} }],
    ['ailleurs/sien', { authContext: { userId: 'u' } }],
  ]);
  const revokeAllSessionsForUser = jest.fn();
  const requetes: Record<string, unknown>[] = [];
  const constructeur = {
    update: () => constructeur,
    set: (champs: Record<string, () => string>) => {
      requetes.push({
        revokedAt: champs.revokedAt(),
        context: champs.context(),
      });

      return constructeur;
    },
    where: (condition: object) => {
      Object.assign(requetes[requetes.length - 1], condition);

      return constructeur;
    },
    setParameters: (parametres: object) => {
      Object.assign(requetes[requetes.length - 1], parametres);

      return constructeur;
    },
    execute: async () => undefined,
  };
  const service = new (VeridianHubMemberAccessService as never as new (
    ...args: unknown[]
  ) => VeridianHubMemberAccessService)(
    a.cache,
    { revokeAllSessionsForUser },
    {
      getActiveStreamIds: async (workspaceId: string) =>
        [...flux.keys()]
          .filter((cle) => cle.startsWith(`${workspaceId}/`))
          .map((cle) => cle.split('/')[1]),
      getStreamsData: async (workspaceId: string, ids: string[]) =>
        new Map(ids.map((id) => [id, flux.get(`${workspaceId}/${id}`)])),
      destroyEventStream: async ({
        workspaceId,
        eventStreamChannelId,
      }: {
        workspaceId: string;
        eventStreamChannelId: string;
      }) => flux.delete(`${workspaceId}/${eventStreamChannelId}`),
    },
    { createQueryBuilder: () => constructeur },
  );

  return {
    a,
    b,
    flux,
    requetes,
    revokeAllSessionsForUser,
    retirer: () => {
      presente = null;
    },
    fermer: () =>
      service.close('u', [{ id: APPARTENANCE, workspaceId: 'ws' }]),
    fermerRien: () => service.close('u', []),
    retenir: () => {
      let lacher = () => {};

      retenue = new Promise((resolve) => (lacher = resolve));

      return () => {
        retenue = null;
        lacher();
      };
    },
  };
};

describe('retrait d’un membre : ce qu’il tient ouvert se ferme', () => {
  // Le temps est le sujet : jest le fige partout ailleurs.
  beforeEach(() => {
    jest.useRealTimers();
  });

  it('le premier vidage coupe tout de suite, sans attendre la fin', async () => {
    const m = monter();

    expect(await m.b.ouvert()).toBe(true);
    m.retirer();
    const fermeture = m.fermer();

    await attendre(800);
    expect([await m.a.ouvert(), await m.b.ouvert()]).toEqual([false, false]);
    await fermeture;
  }, 20_000);

  it.each(['a', 'b'] as const)(
    'une lecture en vol sur le serveur %s ne rouvre pas l espace',
    async (serveur) => {
      const m = monter();
      const lacher = m.retenir();
      const enVol = m[serveur].ouvert();

      await attendre(20);
      m.retirer();
      const fermeture = m.fermer();

      await attendre(300);
      lacher();
      expect(await enVol).toBe(true);
      let fini = false;
      const lecteurs = [m.a, m.b].map(async ({ ouvert }) => {
        while (!fini) {
          await ouvert();
          await attendre(20);
        }
      });

      await fermeture;
      const etats = [await m.a.ouvert(), await m.b.ouvert()];

      fini = true;
      await Promise.all(lecteurs);
      expect(etats).toEqual([false, false]);
    },
    20_000,
  );

  it('sessions et rafraîchissement : les siens, dans cet espace seulement', async () => {
    const m = monter();

    await m.fermer();
    expect(m.revokeAllSessionsForUser.mock.calls).toEqual([
      [{ userId: 'u', workspaceId: 'ws', reason: 'USER_REVOKED' }],
    ]);
    expect(m.requetes).toHaveLength(1);
    expect(m.requetes[0]).toMatchObject({
      userId: 'u',
      workspaceId: 'ws',
      type: 'REFRESH_TOKEN',
      revokedAt: 'COALESCE("revokedAt", now())',
      revokedReason: 'USER_REVOKED',
    });
    expect(m.requetes[0].context).toContain("'revokedReason', :revokedReason");
  }, 20_000);

  it('flux en direct : les siens dans cet espace, celui ouvert entre-temps compris', async () => {
    const m = monter();
    const fermeture = m.fermer();

    await attendre(200);
    expect([...m.flux.keys()]).toEqual(['ws/autre', 'ws/cle', 'ailleurs/sien']);
    m.flux.set('ws/tardif', { authContext: { userId: 'u' } });
    await fermeture;
    expect([...m.flux.keys()]).toEqual(['ws/autre', 'ws/cle', 'ailleurs/sien']);
  }, 20_000);

  it('jamais venu : rien à fermer, rien à attendre', async () => {
    const m = monter();
    const debut = Date.now();

    await m.fermerRien();
    expect(Date.now() - debut).toBeLessThan(500);
    expect(m.revokeAllSessionsForUser).not.toHaveBeenCalled();
  });
});
