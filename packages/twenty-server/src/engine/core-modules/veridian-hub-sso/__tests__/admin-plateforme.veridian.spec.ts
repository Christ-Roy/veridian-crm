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
import {
  PLATFORM_ADMIN_KEY,
  VeridianHubPlatformAdminService,
} from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-platform-admin.service';
import { VeridianHubRoleService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-role.service';

// CONTRAT-HUB §5.23 (VER-263, Robert 25/11/2026) : « tout faire comme propriétaire et me faire virer par ce dernier ».
const ADMIN = {
  id: 'admin',
  label: 'Admin',
  universalIdentifier: '20202020-02c2-43f2-b94d-cab1f2b532eb',
};
const MEMBRE = { id: 'membre', label: 'Member', universalIdentifier: 'm' };
const TENANT = '6ca82063-e443-45a7-bae6-27a3f11118c4';
const ROBERT = '0b9f3c1e-7d2a-4c55-9f1e-2a6b8c4d5e6f';
const CLIENT = '1c8e2d0f-6e19-4b44-8e0a-1f5a7b3c4d5e';

type Ligne = { id: string; key: string; workspaceId: string | null; userId: string | null; value: unknown };

const monter = ({
  role = MEMBRE as typeof ADMIN | null,
  stocke = null as Record<string, unknown> | null,
  relie = true,
  compte = true,
  membre = true,
  proprietaire = CLIENT,
  dernier = false,
} = {}) => {
  const lignes: Ligne[] = [];

  if (relie) {
    lignes.push({ id: 't', key: `veridian.hub_tenant:${TENANT}`, workspaceId: 'ws', userId: null, value: { ownerHubUserId: proprietaire } });
  }
  if (compte) {
    lignes.push({ id: 'h', key: `veridian.hub_user:${ROBERT}`, workspaceId: null, userId: 'u', value: {} });
  }
  if (stocke) {
    lignes.push({ id: 'p', key: PLATFORM_ADMIN_KEY, workspaceId: 'ws', userId: 'u', value: stocke });
  }
  const etat = { role };
  const correspond = (l: Ligne, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const valeur = (l as Record<string, unknown>)[k];

      if (v && typeof v === 'object' && '_type' in (v as object)) {
        const t = v as { _type: string; _value: unknown };

        if (t._type === 'isNull') return valeur === null;
        if (t._type === 'like') return String(valeur).startsWith(String(t._value).replace('%', ''));
        if (t._type === 'in') return (t._value as unknown[]).includes(valeur);
      }

      return valeur === v;
    });
  const kv = {
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => lignes.find((l) => correspond(l, where)) ?? null),
    find: jest.fn(async ({ where }: { where: Record<string, unknown> }) => lignes.filter((l) => correspond(l, where))),
    save: jest.fn(async (l: Ligne) => {
      const i = lignes.findIndex((x) => x.id === l.id);

      if (i >= 0) lignes[i] = { ...lignes[i], ...l };
      else lignes.push({ ...l, id: `n${lignes.length}` });

      return l;
    }),
    delete: jest.fn(),
  };
  const assigner = jest.fn(async ({ roleId }: { roleId: string }) => {
    if (dernier) {
      throw new PermissionsException('dernier', PermissionsExceptionCode.CANNOT_UNASSIGN_LAST_ADMIN);
    }
    etat.role = roleId === ADMIN.id ? ADMIN : MEMBRE;
  });
  const userRole = {
    getRolesByUserWorkspaces: jest.fn(async () => new Map(etat.role ? [['uw', [etat.role]]] : [])),
    assignRoleToManyUserWorkspace: assigner,
  };
  const appartenance = {
    findOne: jest.fn(async () => (membre ? { id: 'uw', userId: 'u' } : null)),
    find: jest.fn(async () => (membre ? [{ id: 'uw', userId: 'u' }] : [])),
  };
  const espaces = { findOne: jest.fn(async () => ({ defaultRoleId: MEMBRE.id })) };
  const roles = {
    findOne: jest.fn(async ({ where }: { where: { id?: string; universalIdentifier?: string } }) =>
      [ADMIN, MEMBRE].find((r) => r.id === where.id || r.universalIdentifier === where.universalIdentifier) ?? null),
  };
  const verrou = { withLock: jest.fn((fn: () => unknown) => fn()) };
  const service = new (VeridianHubPlatformAdminService as never as new (...a: unknown[]) => VeridianHubPlatformAdminService)(
    kv, appartenance, espaces, roles, userRole, verrou,
  );
  const roleHub = new (VeridianHubRoleService as never as new (...a: unknown[]) => VeridianHubRoleService)(
    kv, appartenance, espaces, roles, userRole, verrou,
  );
  const stockee = () => lignes.find((l) => l.key === PLATFORM_ADMIN_KEY)?.value as Record<string, unknown> | undefined;
  const appliquer = (action: 'grant' | 'revoke', plus: Record<string, unknown> = {}) =>
    service.apply({ workspaceRef: TENANT, hubUserId: ROBERT, action, actor: 'cle:ADMIN_SECRET', reason: 'épreuve', reinstate: false, ...plus });

  return { service, roleHub, assigner, etat, stockee, appliquer };
};

describe('administrateur de plateforme dans l’espace d’un client (§5.23)', () => {
  it('pose le rôle Admin natif à un membre, et le retient', async () => {
    const m = monter();

    expect(await m.appliquer('grant')).toEqual({ status: 200, applied: true, role: 'admin' });
    expect(m.assigner).toHaveBeenCalledWith(expect.objectContaining({ roleId: ADMIN.id, userWorkspaceIds: ['uw'] }));
    expect(m.stockee()).toMatchObject({ granted: true, withdrawn: false, actor: 'cle:ADMIN_SECRET' });
  });

  it('jamais propriétaire : le propriétaire de l’espace est refusé, rien n’est écrit', async () => {
    const m = monter({ proprietaire: ROBERT });

    expect(await m.appliquer('grant')).toEqual({ status: 409, error: 'is_owner' });
    expect(m.assigner).not.toHaveBeenCalled();
  });

  it('rien n’est créé : inconnu, non membre ou espace inconnu sont refusés', async () => {
    expect(await monter({ compte: false }).appliquer('grant')).toEqual({ status: 404, error: 'user_not_in_app' });
    expect(await monter({ membre: false }).appliquer('grant')).toEqual({ status: 404, error: 'not_a_member' });
    expect(await monter({ relie: false }).appliquer('grant')).toEqual({ status: 404, error: 'tenant_not_found' });
  });

  it('le client retire le rôle : gardé, un nouveau grant rend 409 admin_withdrawn, la lecture le dit', async () => {
    const m = monter({ stocke: { granted: true, withdrawn: false, at: 'x', actor: 'a', reason: null } });

    expect(await m.appliquer('grant')).toEqual({ status: 409, error: 'admin_withdrawn' });
    expect(m.assigner).not.toHaveBeenCalled();
    expect(await m.service.list(TENANT)).toEqual([
      { hub_user_id: ROBERT, role: 'member', admin_granted: false, admin_withdrawn: true },
    ]);
  });

  it('seul reinstate, geste humain, le remet', async () => {
    const m = monter({ stocke: { granted: false, withdrawn: true, at: 'x', actor: 'a', reason: null } });

    expect(await m.appliquer('grant', { reinstate: true })).toEqual({ status: 200, applied: true, role: 'admin' });
    expect(m.stockee()).toMatchObject({ granted: true, withdrawn: false });
  });

  it('une poussée d’organisation (§5.22) ne rend pas Admin à un retiré', async () => {
    const m = monter({ stocke: { granted: false, withdrawn: true, at: 'x', actor: 'a', reason: null } });

    expect(await m.roleHub.applyRole({ hubTenantId: TENANT, hubUserId: ROBERT, role: 'admin', version: 9 })).toEqual({
      status: 'ok',
      applied: false,
      reason: 'admin_withdrawn',
    });
    expect(m.assigner).not.toHaveBeenCalled();
  });

  it('revoke rend le rôle par défaut à ce que le Hub avait donné, et seulement ça', async () => {
    const donne = monter({ role: ADMIN, stocke: { granted: true, withdrawn: false, at: 'x', actor: 'a', reason: null } });

    expect(await donne.appliquer('revoke')).toEqual({ status: 200, applied: true, role: 'member' });
    expect(donne.stockee()).toMatchObject({ granted: false, withdrawn: false });

    const choisiParLeClient = monter({ role: ADMIN });

    expect(await choisiParLeClient.appliquer('revoke')).toMatchObject({ status: 200, applied: false });
    expect(choisiParLeClient.assigner).not.toHaveBeenCalled();
  });

  it('dernier admin : 409, rien ne change', async () => {
    const m = monter({ role: ADMIN, dernier: true, stocke: { granted: true, withdrawn: false, at: 'x', actor: 'a', reason: null } });

    expect(await m.appliquer('revoke')).toEqual({ status: 409, error: 'last_admin' });
  });

  it('la lecture nomme le propriétaire « owner » et ne liste que les comptes du Hub', async () => {
    const m = monter({ role: ADMIN, proprietaire: ROBERT });

    expect(await m.service.list(TENANT)).toEqual([
      { hub_user_id: ROBERT, role: 'owner', admin_granted: false, admin_withdrawn: false },
    ]);
  });
});
