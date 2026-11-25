import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

jest.mock(
  'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service',
  () => ({ hubTenantKey: (tenantId: string) => `veridian.hub_tenant:${tenantId}` }),
);
jest.mock(
  'src/engine/core-modules/workspace/services/workspace.service',
  () => ({ WorkspaceService: class {} }),
);
jest.mock('src/engine/core-modules/cache-lock/cache-lock.service', () => ({
  CacheLockService: class {},
}));
jest.mock('src/engine/core-modules/cache-storage/services/cache-storage.service', () => ({
  CacheStorageService: class {},
}));
jest.mock('src/engine/core-modules/key-value-pair/key-value-pair.entity', () => ({
  KeyValuePairEntity: class {},
  KeyValuePairType: { USER_VARIABLE: 'USER_VARIABLE' },
}));
jest.mock('src/engine/core-modules/workspace/workspace.entity', () => ({
  WorkspaceEntity: class {},
}));

import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { VeridianHubSuspensionService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-suspension.service';

// Mesuré par le Hub le 25/11/2026 : une écriture acceptée sur un espace suspendu, pendant qu'un déploiement tenait deux serveurs.
// Le vrai cache, deux processus, une seule base et un seul Redis.
const ESPACE = '44444444-4444-4444-8444-444444444444';
const { ACTIVE, SUSPENDED } = WorkspaceActivationStatus;

const monter = () => {
  const redis = new Map<string, unknown>();
  const base = { id: ESPACE, activationStatus: ACTIVE, suspendedAt: null, deletedAt: null };
  let marque: object | null = null;
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
      'workspaceEntity',
      {
        computeForCache: async () => {
          const lu = { ...base };

          await retenue;

          return lu;
        },
      },
    );

    return {
      cache,
      statut: async () =>
        (await cache.get('workspaceEntity', ESPACE))?.activationStatus,
    };
  };
  const a = processus();
  const b = processus();
  const service = new (VeridianHubSuspensionService as never as new (
    ...args: unknown[]
  ) => VeridianHubSuspensionService)(
    {
      findOne: async ({ where }: { where: { key: string } }) =>
        where.key.startsWith('veridian.hub_tenant:')
          ? { workspaceId: ESPACE }
          : marque && { id: 'm', value: marque },
      save: async ({ value }: { value: object }) => (marque = value),
      delete: async () => (marque = null),
    },
    {
      findOne: async () => ({ ...base }),
      update: async (_: unknown, champs: object) => Object.assign(base, champs),
    },
    {
      reactivateWorkspace: async () => {
        base.activationStatus = ACTIVE;
        await a.cache.invalidate('workspaceEntity', ESPACE);
      },
    },
    { emit: () => undefined },
    a.cache,
    { withLock: (fn: () => unknown) => fn() },
  );

  return {
    a,
    b,
    suspendre: () => service.suspend('t', 'admin_action'),
    reprendre: () => service.resume('t'),
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

describe('suspension Veridian : caches et processus', () => {
  // Le temps est le sujet : jest le fige partout ailleurs.
  beforeEach(() => {
    jest.useRealTimers();
  });

  it('quand la réponse part, un autre serveur ne sert plus l espace, ni l inverse à la reprise', async () => {
    const m = monter();

    expect(await m.b.statut()).toBe(ACTIVE);
    await m.suspendre();
    expect(await m.b.statut()).toBe(SUSPENDED);
    expect(await m.a.statut()).toBe(SUSPENDED);
    await m.reprendre();
    expect(await m.b.statut()).toBe(ACTIVE);
    expect(await m.a.statut()).toBe(ACTIVE);
  }, 20_000);

  it.each(['a', 'b'] as const)(
    'une lecture en vol sur le serveur %s ne rouvre pas l espace',
    async (serveur) => {
      const m = monter();
      const lacher = m.retenir();
      const enVol = m[serveur].statut();
      const suspension = m.suspendre();

      await new Promise((resolve) => setTimeout(resolve, 300));
      lacher();
      expect(await enVol).toBe(ACTIVE);
      // Les deux serveurs sont lus sans cesse : aucun ne garde en mémoire ce que la lecture en vol a réécrit.
      let fini = false;
      const lecteurs = [m.a, m.b].map(async ({ statut }) => {
        while (!fini) {
          await statut();
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      });

      await suspension;
      const statuts = [await m.a.statut(), await m.b.statut()];

      fini = true;
      await Promise.all(lecteurs);
      expect(statuts).toEqual([SUSPENDED, SUSPENDED]);
    },
    20_000,
  );
});
