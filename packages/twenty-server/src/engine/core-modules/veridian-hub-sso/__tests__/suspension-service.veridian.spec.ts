jest.mock('node:timers/promises', () => ({ setTimeout: jest.fn() }));

import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { VeridianHubSuspensionService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-suspension.service';

jest.mock(
  'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service',
  () => ({
    hubTenantKey: (tenantId: string) => `veridian.hub_tenant:${tenantId}`,
  }),
);
jest.mock(
  'src/engine/core-modules/workspace/services/workspace.service',
  () => ({ WorkspaceService: class {} }),
);
jest.mock(
  'src/engine/core-entity-cache/services/core-entity-cache.service',
  () => ({ CoreEntityCacheService: class {}, MEMOIZER_TTL_MS: 500 }),
);
jest.mock('src/engine/core-modules/cache-lock/cache-lock.service', () => ({
  CacheLockService: class {},
}));
jest.mock(
  'src/engine/core-modules/key-value-pair/key-value-pair.entity',
  () => ({
    KeyValuePairEntity: class {},
    KeyValuePairType: { USER_VARIABLE: 'USER_VARIABLE' },
  }),
);
jest.mock('src/engine/core-modules/workspace/workspace.entity', () => ({
  WorkspaceEntity: class {},
}));

const TENANT = 'tenant-1';
const WORKSPACE = 'ws-1';
const { ACTIVE, SUSPENDED, ONGOING_CREATION } = WorkspaceActivationStatus;

// Une base en mémoire : l'état survit à un appel coupé, comme en vrai.
const monter = ({
  statut = ACTIVE as WorkspaceActivationStatus,
  suspendedAt = null as Date | null,
  deletedAt = null as Date | null,
  marque = null as { suspendedAt: string; reason: string } | null,
  relie = true,
} = {}) => {
  const espace = { id: WORKSPACE, activationStatus: statut, suspendedAt, deletedAt };
  let ligne = marque ? { id: 'marque', value: marque } : null;
  const fil: string[] = [];
  let panne: string | null = null;
  const couper = (etape: string) => {
    if (panne === etape) {
      panne = null;
      throw new Error(`coupé avant ${etape}`);
    }

    fil.push(etape);
  };
  const lectures: { key: string; workspaceId?: string }[] = [];
  const verrou = jest.fn((fn: () => unknown, _: string) => fn());
  const service = new (VeridianHubSuspensionService as never as new (
    ...args: unknown[]
  ) => VeridianHubSuspensionService)(
    {
      findOne: jest.fn(async ({ where }: { where: { key: string } }) => {
        lectures.push(where);

        return where.key === `veridian.hub_tenant:${TENANT}`
          ? relie
            ? { workspaceId: WORKSPACE }
            : null
          : ligne;
      }),
      save: jest.fn(async (entree: { value: never; key: string }) => {
        couper('marque');
        ligne = { id: 'marque', value: entree.value };
      }),
      delete: jest.fn(async () => {
        couper('marque retirée');
        ligne = null;
      }),
    },
    {
      findOne: jest.fn(async () => ({ ...espace })),
      update: jest.fn(async (_: unknown, champs: object) => {
        couper('statut');
        Object.assign(espace, champs);
      }),
    },
    {
      reactivateWorkspace: jest.fn(async () => {
        couper('reprise native');
        espace.activationStatus = ACTIVE;
      }),
    },
    { emit: jest.fn((nom: string) => couper(nom)) },
    { invalidate: jest.fn(async () => couper('cache')) },
    { withLock: verrou },
  );

  return {
    espace,
    fil,
    lectures,
    verrou,
    marque: () => ligne?.value ?? null,
    couperAvant: (etape: string) => (panne = etape),
    suspendre: () => service.suspend(TENANT, 'admin_action'),
    reprendre: () => service.resume(TENANT),
  };
};

describe('suspension Veridian (service)', () => {
  it('suspend : la marque du Hub d abord, puis le statut sans date, le cache et l événement natif', async () => {
    const m = monter();

    expect(await m.suspendre()).toMatchObject({ status: 'ok' });
    expect(m.fil).toEqual([
      'marque',
      'statut',
      'cache',
      'workspace.suspended',
      'cache',
    ]);
    expect(m.espace).toMatchObject({
      activationStatus: SUSPENDED,
      suspendedAt: null,
    });
    expect(m.marque()).toMatchObject({ reason: 'admin_action' });
    expect(m.verrou.mock.calls[0][1]).toBe(
      `veridian-hub-suspension:${WORKSPACE}`,
    );
    expect(m.lectures[1]).toMatchObject({
      key: 'veridian.hub_suspension',
      workspaceId: WORKSPACE,
    });
  });

  it.each(['statut', 'cache', 'workspace.suspended'])(
    'suspend coupé avant « %s » : le rejeu finit, et la reprise reste possible',
    async (etape) => {
      const m = monter();

      m.couperAvant(etape);
      await expect(m.suspendre()).rejects.toThrow('coupé');
      expect(m.marque()).not.toBeNull();

      const premiere = m.marque();

      expect(await m.suspendre()).toMatchObject({ status: 'ok' });
      expect(m.marque()).toEqual(premiere);
      expect(m.espace.activationStatus).toBe(SUSPENDED);
      expect(m.fil).toContain('workspace.suspended');
      expect(await m.reprendre()).toMatchObject({ status: 'ok' });
      expect(m.espace.activationStatus).toBe(ACTIVE);
      expect(m.marque()).toBeNull();
    },
  );

  it.each(['reprise native', 'marque retirée'])(
    'reprise coupée avant « %s » : le rejeu finit',
    async (etape) => {
      const m = monter();

      await m.suspendre();
      m.couperAvant(etape);
      await expect(m.reprendre()).rejects.toThrow('coupé');
      m.fil.length = 0;
      expect(await m.reprendre()).toMatchObject({ status: 'ok' });
      expect(m.espace.activationStatus).toBe(ACTIVE);
      expect(m.marque()).toBeNull();
      expect(m.fil).toContain(
        etape === 'marque retirée' ? 'workspace.reactivated' : 'reprise native',
      );
    },
  );

  it('déjà suspendu par un autre chemin, date posée : la marque vient et la date part', async () => {
    const m = monter({ statut: SUSPENDED, suspendedAt: new Date() });

    expect(await m.suspendre()).toMatchObject({ status: 'ok' });
    expect(m.espace.suspendedAt).toBeNull();
    expect(m.marque()).not.toBeNull();
  });

  it('suspend rejoué plus tard : même date rendue, marque jamais réécrite', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-25T05:00:00.000Z'));
    const m = monter();
    const premier = await m.suspendre();

    jest.setSystemTime(new Date('2026-11-26T05:00:00.000Z'));
    expect(await m.suspendre()).toEqual(premier);
    expect(m.marque()?.suspendedAt).toBe('2026-11-25T05:00:00.000Z');
    expect(m.fil.filter((etape) => etape === 'marque')).toHaveLength(1);
    jest.useRealTimers();
  });

  it('reprise : un espace suspendu par un autre chemin ne se ranime pas', async () => {
    const m = monter({ statut: SUSPENDED });

    expect(await m.reprendre()).toEqual({ status: 'not_suspended_by_hub' });
    expect(m.espace.activationStatus).toBe(SUSPENDED);
    expect(m.fil).toEqual([]);
  });

  it('reprise sur un espace actif sans marque : ok, rien ne bouge', async () => {
    const m = monter();

    expect(await m.reprendre()).toMatchObject({ status: 'ok' });
    expect(m.fil).toEqual([]);
  });

  it.each([
    ['inconnu', { relie: false }, 'not_found'],
    ['supprimé', { deletedAt: new Date() }, 'workspace_gone'],
    ['en création', { statut: ONGOING_CREATION }, 'not_active'],
  ])('suspend, espace %s : %s refusé, aucune écriture', async (_, cas, status) => {
    const m = monter(cas);

    expect(await m.suspendre()).toEqual({ status });
    expect(m.fil).toEqual([]);
  });
});
