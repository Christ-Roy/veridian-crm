jest.mock(
  'src/engine/core-modules/key-value-pair/key-value-pair.entity',
  () => ({
    KeyValuePairEntity: class {},
    KeyValuePairType: { USER_VARIABLE: 'USER_VARIABLE' },
  }),
);
jest.mock(
  'src/engine/core-modules/user-workspace/user-workspace.entity',
  () => ({ UserWorkspaceEntity: class {} }),
);
jest.mock('src/engine/core-modules/workspace/workspace.entity', () => ({
  WorkspaceEntity: class {},
}));
jest.mock('src/engine/metadata-modules/role/role.entity', () => ({
  RoleEntity: class {},
}));
jest.mock(
  'src/engine/permissions/role-assignment/user-role.service',
  () => ({ UserRoleService: class {} }),
);
jest.mock('src/engine/core-modules/cache-lock/cache-lock.service', () => ({
  CacheLockService: class {},
}));

import {
  PermissionsException,
  PermissionsExceptionCode,
} from 'src/engine/permissions/permissions.exception';
import { VeridianHubRoleService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-role.service';
import { parseHubOrganisations } from 'src/engine/core-modules/veridian-hub-sso/utils/parse-hub-organisations.util';

const ADMIN = {
  id: 'admin',
  label: 'Admin',
  universalIdentifier: '20202020-02c2-43f2-b94d-cab1f2b532eb',
};
const MEMBRE = { id: 'membre', label: 'Member', universalIdentifier: 'm' };
const SUR_MESURE = { id: 'mesure', label: 'Admin', universalIdentifier: 'x' };
const TENANT = '6ca82063-e443-45a7-bae6-27a3f11118c4';
const SUB = '0b9f3c1e-7d2a-4c55-9f1e-2a6b8c4d5e6f';

const monter = ({
  courant = MEMBRE as object | null,
  stocke = null as { role: string; version: number } | null,
  relie = true,
  membre = true,
  compte = true,
  parDefaut = MEMBRE as { id: string },
  dernier = false,
} = {}) => {
  const ecrit = jest.fn(async (valeur: unknown) => valeur);
  const efface = jest.fn();
  const assigner = jest.fn(async (_: unknown) => {
    if (dernier) {
      throw new PermissionsException(
        'dernier',
        PermissionsExceptionCode.CANNOT_UNASSIGN_LAST_ADMIN,
      );
    }
  });
  const cles: string[] = [];
  const lu = jest.fn(async ({ where }: { where: { key: string } }) => {
    cles.push(where.key);

    if (where.key === `veridian.hub_tenant:${TENANT}`) {
      return relie ? { workspaceId: 'ws' } : null;
    }

    if (where.key === `veridian.hub_user:${SUB}`) {
      return compte ? { userId: 'u' } : null;
    }

    return stocke ? { id: 'kv', value: stocke } : null;
  });
  const appartenance = jest.fn(async (_: unknown) =>
    membre ? { id: 'uw' } : null,
  );
  const roles = [ADMIN, MEMBRE, SUR_MESURE];
  const verrou = jest.fn((fn: () => unknown, _: string) => fn());
  const service = new (VeridianHubRoleService as never as new (
    ...args: unknown[]
  ) => VeridianHubRoleService)(
    { findOne: lu, save: ecrit, delete: efface },
    { findOne: appartenance },
    { findOne: jest.fn().mockResolvedValue({ defaultRoleId: parDefaut.id }) },
    {
      findOne: jest.fn(
        async ({
          where,
        }: {
          where: { workspaceId: string; id?: string; universalIdentifier?: string };
        }) =>
          where.workspaceId !== 'ws'
            ? null
            : (roles.find(
                (role) =>
                  role.id === where.id ||
                  role.universalIdentifier === where.universalIdentifier,
              ) ?? null),
      ),
    },
    {
      getRolesByUserWorkspaces: jest
        .fn()
        .mockResolvedValue(new Map(courant ? [['uw', [courant]]] : [])),
      assignRoleToManyUserWorkspace: assigner,
    },
    { withLock: verrou },
  );
  const pousser = (role: string, version = 2) =>
    service.applyRole({
      hubTenantId: TENANT,
      hubUserId: SUB,
      role: role as never,
      version,
    });

  return { service, pousser, ecrit, efface, assigner, appartenance, verrou };
};

const pose = (roleId: string) => ({
  workspaceId: 'ws',
  userWorkspaceIds: ['uw'],
  roleId,
});

describe('rôle porté par le Hub (CONTRAT-HUB §5.22)', () => {
  it.each(['owner', 'admin'])('%s donne Admin, une fois', async (role) => {
    const { pousser, assigner, ecrit, verrou, appartenance } = monter();

    expect(await pousser(role)).toEqual({
      status: 'ok',
      applied: true,
      nativeRole: 'Admin',
    });
    expect(assigner).toHaveBeenCalledTimes(1);
    expect(assigner).toHaveBeenCalledWith(pose('admin'));
    expect(appartenance).toHaveBeenCalledWith({
      where: { userId: 'u', workspaceId: 'ws' },
    });
    expect(ecrit).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'veridian.hub_role',
        userId: 'u',
        workspaceId: 'ws',
        value: { role, version: 2 },
      }),
    );
    expect(verrou).toHaveBeenCalledWith(
      expect.any(Function),
      'veridian-hub-role:ws:u',
    );
  });

  it('un rôle sur mesure nommé Admin n’est pas Admin : admin le remplace', async () => {
    const { pousser, assigner } = monter({ courant: SUR_MESURE });

    expect(await pousser('admin')).toMatchObject({ applied: true });
    expect(assigner).toHaveBeenCalledWith(pose('admin'));
  });

  it('member retire Admin', async () => {
    const { pousser, assigner } = monter({ courant: ADMIN });

    expect(await pousser('member')).toMatchObject({
      applied: true,
      nativeRole: 'Member',
    });
    expect(assigner).toHaveBeenCalledWith(pose('membre'));
  });

  it.each([
    ['rôle sur mesure', { courant: SUR_MESURE }],
    ['rôle par défaut Admin', { courant: ADMIN, parDefaut: ADMIN }],
  ])('member ne remplace pas : %s', async (nom, etat) => {
    const { pousser, assigner } = monter(etat);

    expect(await pousser('member')).toMatchObject({
      applied: false,
      reason: nom === 'rôle sur mesure' ? 'native_custom' : 'unchanged',
    });
    expect(assigner).not.toHaveBeenCalled();
  });

  it('le dernier Admin reste, et la version n’est pas consommée', async () => {
    const { pousser, ecrit } = monter({ courant: ADMIN, dernier: true });

    expect(await pousser('member')).toMatchObject({
      applied: false,
      reason: 'last_admin',
    });
    expect(ecrit).not.toHaveBeenCalled();
  });

  it.each([1, 2])('version %s rejouée ou ancienne : rien', async (version) => {
    const { pousser, assigner, ecrit } = monter({
      stocke: { role: 'member', version: 2 },
    });

    expect(await pousser('admin', version)).toMatchObject({
      applied: false,
      reason: 'stale',
    });
    expect(assigner).not.toHaveBeenCalled();
    expect(ecrit).not.toHaveBeenCalled();
  });

  it('une version plus récente s’applique, sur la même ligne', async () => {
    const { pousser, ecrit } = monter({
      stocke: { role: 'member', version: 2 },
    });

    expect(await pousser('admin', 3)).toMatchObject({ applied: true });
    expect(ecrit).toHaveBeenCalledWith(expect.objectContaining({ id: 'kv' }));
  });

  it('déjà ce rôle : inchangé, la version est retenue', async () => {
    const { pousser, assigner, ecrit } = monter({ courant: ADMIN });

    expect(await pousser('admin')).toMatchObject({ reason: 'unchanged' });
    expect(assigner).not.toHaveBeenCalled();
    expect(ecrit).toHaveBeenCalled();
  });

  it.each([
    ['compte inconnu', { compte: false }],
    ['pas membre de cet espace', { membre: false }],
  ])('jamais d’appartenance créée : %s', async (_, etat) => {
    const { pousser, assigner, ecrit } = monter(etat);

    expect(await pousser('admin')).toMatchObject({ reason: 'not_member' });
    expect(assigner).not.toHaveBeenCalled();
    expect(ecrit).not.toHaveBeenCalled();
  });

  it('organisation non reliée', async () => {
    expect(await monter({ relie: false }).pousser('admin')).toEqual({
      status: 'tenant_not_linked',
    });
  });

  it('une erreur native remonte ici, jamais au rebond', async () => {
    const { pousser, assigner, service } = monter();

    assigner.mockRejectedValue(new Error('panne'));
    await expect(pousser('admin')).rejects.toThrow('panne');
    await expect(
      service.applyRolesAtSignIn(SUB, [
        { hubTenantId: TENANT, role: 'admin', version: 2 },
      ]),
    ).resolves.toBeUndefined();
  });

  it('un membre parti perd ce que le Hub avait dit de lui', async () => {
    const { service, efface } = monter();

    await service.forgetRole('ws', 'u');
    expect(efface).toHaveBeenCalledWith({
      key: 'veridian.hub_role',
      workspaceId: 'ws',
      userId: 'u',
    });
  });
});

describe('organisations au rebond', () => {
  it('garde les entrées complètes, ignore le reste, jamais un retrait', () => {
    const bonne = { hub_tenant_id: TENANT, role: 'admin', version: 1764012345678 };

    expect(
      parseHubOrganisations([
        bonne,
        { ...bonne, role: 'root' },
        { ...bonne, version: '1' },
        { ...bonne, version: 0 },
        { ...bonne, hub_tenant_id: 'x' },
        null,
      ]),
    ).toEqual([{ hubTenantId: TENANT, role: 'admin', version: 1764012345678 }]);
    expect(parseHubOrganisations(undefined)).toEqual([]);
    expect(parseHubOrganisations('x')).toEqual([]);
    expect(
      parseHubOrganisations(Array.from({ length: 60 }, () => bonne)),
    ).toHaveLength(50);
  });
});
