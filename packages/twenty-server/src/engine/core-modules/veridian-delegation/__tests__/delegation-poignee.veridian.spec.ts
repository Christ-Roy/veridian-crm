import { VeridianGrantService } from 'src/engine/core-modules/veridian-delegation/services/veridian-grant.service';
import { parseHubGrants } from 'src/engine/core-modules/veridian-delegation/utils/parse-hub-grants.util';

const TENANT = '4fb9fef0-1111-4222-8333-444444444444';
const GRANT = 'poignee-de-delegation-tres-longue';
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

const build = (
  rows: {
    key: string;
    userId?: string;
    workspaceId?: string;
    value?: unknown;
  }[],
) => {
  const upsert = jest.fn().mockResolvedValue(undefined);
  const remove = jest.fn().mockResolvedValue(undefined);
  const service = new VeridianGrantService(
    {
      findOne: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          rows.find(
            (row) =>
              row.key === where.key &&
              (typeof where.userId !== 'string' ||
                row.userId === where.userId) &&
              (typeof where.workspaceId !== 'string' ||
                row.workspaceId === where.workspaceId),
          ) ?? null,
      ),
      upsert,
      delete: remove,
    } as never,
    {
      encryptVersioned: (
        value: string,
        { workspaceId }: { workspaceId: string },
      ) => `chiffre(${workspaceId}):${Buffer.from(value).toString('base64')}`,
      decryptVersionedOrThrow: (
        value: string,
        { workspaceId }: { workspaceId: string },
      ) => {
        const prefix = `chiffre(${workspaceId}):`;

        if (!value.startsWith(prefix)) {
          throw new Error('autre espace');
        }

        return Buffer.from(value.slice(prefix.length), 'base64').toString();
      },
    } as never,
  );

  return { service, upsert, remove };
};

const LINKS = [
  { key: 'veridian.hub_user:hub-1', userId: 'user-1' },
  { key: `veridian.hub_tenant:${TENANT}`, workspaceId: 'workspace-1' },
];

describe('poignée de délégation reçue au rebond', () => {
  it('se garde chiffrée, par personne et par espace', async () => {
    const { service, upsert } = build(LINKS);

    await service.storeAtSignIn('hub-1', [
      { hubTenantId: TENANT, grant: GRANT, expiresAt: FUTURE },
    ]);

    const [row, conflict] = upsert.mock.calls[0];

    expect(row).toMatchObject({ userId: 'user-1', workspaceId: 'workspace-1' });
    expect(conflict).toEqual(['key', 'userId', 'workspaceId']);
    expect(JSON.stringify(row)).not.toContain(GRANT);
  });

  it('une organisation sans espace ici ou une personne inconnue : rien', async () => {
    const unknownTenant = build([LINKS[0]]);
    const unknownPerson = build([LINKS[1]]);
    const grants = [{ hubTenantId: TENANT, grant: GRANT, expiresAt: FUTURE }];

    await unknownTenant.service.storeAtSignIn('hub-1', grants);
    await unknownPerson.service.storeAtSignIn('hub-1', grants);

    expect(unknownTenant.upsert).not.toHaveBeenCalled();
    expect(unknownPerson.upsert).not.toHaveBeenCalled();
  });

  it('une panne n empêche jamais d entrer', async () => {
    const { service, upsert } = build(LINKS);

    upsert.mockRejectedValue(new Error('base'));

    await expect(
      service.storeAtSignIn('hub-1', [
        { hubTenantId: TENANT, grant: GRANT, expiresAt: FUTURE },
      ]),
    ).resolves.toBeUndefined();
  });

  it('se relit pour la même personne et le même espace seulement, jamais périmée', async () => {
    const value = {
      grant: `chiffre(workspace-1):${Buffer.from(GRANT).toString('base64')}`,
      expiresAt: FUTURE,
    };
    const row = {
      key: 'veridian.hub_grant',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      value,
    };

    expect(await build([row]).service.read('user-1', 'workspace-1')).toBe(
      GRANT,
    );
    expect(await build([row]).service.read('user-2', 'workspace-1')).toBeNull();
    expect(await build([row]).service.read('user-1', 'workspace-2')).toBeNull();
    expect(
      await build([
        { ...row, value: { ...value, expiresAt: '2026-01-01T00:00:00Z' } },
      ]).service.read('user-1', 'workspace-1'),
    ).toBeNull();
  });

  it('ce que le Hub envoie mal formé ou périmé est ignoré', () => {
    const good = { hub_tenant_id: TENANT, grant: GRANT, expire_le: FUTURE };

    expect(parseHubGrants([good])).toHaveLength(1);
    expect(parseHubGrants(undefined)).toEqual([]);
    expect(parseHubGrants('x')).toEqual([]);
    expect(
      parseHubGrants([
        { ...good, hub_tenant_id: 'x' },
        { ...good, grant: 'court' },
        { ...good, grant: 12 },
        { ...good, expire_le: '2026-01-01T00:00:00Z' },
        { ...good, expire_le: undefined },
        null,
      ]),
    ).toEqual([]);
  });
});
