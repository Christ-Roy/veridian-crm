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
jest.mock('src/engine/core-modules/cache-lock/cache-lock.service', () => ({
  CacheLockService: class {},
}));
jest.mock(
  'src/engine/core-entity-cache/services/core-entity-cache.service',
  () => ({ CoreEntityCacheService: class {} }),
);
jest.mock(
  'src/engine/core-modules/file/file-core-picture/services/file-core-picture.service',
  () => ({ FileCorePictureService: class {} }),
);
jest.mock(
  'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service',
  () => ({ VeridianHubSsoService: class {} }),
);
jest.mock(
  'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-role.service',
  () => ({ VeridianHubRoleService: class {} }),
);

import { VeridianHubOrganisationService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-organisation.service';
import {
  type HubOrganisation,
  parseHubOrganisation,
} from 'src/engine/core-modules/veridian-hub-sso/utils/parse-hub-organisation.util';

const HUB = 'https://hub.test';
const TENANT = '6ca82063-e443-45a7-bae6-27a3f11118c4';
const AUTRE = '7ca82063-e443-45a7-bae6-27a3f11118c4';
const SUB = '0b9f3c1e-7d2a-4c55-9f1e-2a6b8c4d5e6f';
const ADHESION = '2026-11-20T10:00:00.000Z';
const LOGO = `${HUB}/api/public/org/${TENANT}/logo?v=abc123`;

const membre = (champs: object = {}) => ({
  hub_user_id: SUB,
  email: 'A@Test.fr',
  email_proven: true,
  name: 'A',
  role: 'admin',
  joined_at: ADHESION,
  ...champs,
});
const corps = (champs: object = {}, marque: object = {}) => ({
  hub_tenant_id: TENANT,
  version: 10,
  nom: 'nom du compte',
  type: 'organisation',
  marque: { nom_affiche: null, logo_url: null, ...marque },
  modules: ['crm'],
  membres: [] as unknown[],
  ...champs,
});
const lire = (b: unknown) => parseHubOrganisation(b, HUB) as HubOrganisation;

describe("document d'organisation du Hub : lecture (CONTRAT-HUB §5.19.6)", () => {
  it('ne retient que le nom choisi, jamais celui du compte', () => {
    expect(lire(corps()).chosenName).toBeNull();
    expect(lire(corps({}, { nom_affiche: '   ' })).chosenName).toBeNull();
    expect(lire(corps({}, { nom_affiche: ' Choisi ' })).chosenName).toBe(
      'Choisi',
    );
  });

  it.each([
    ['tenant illisible', { hub_tenant_id: 'x' }],
    ['version nulle', { version: 0 }],
    ['version texte', { version: '12' }],
    ['membres absents', { membres: undefined }],
    ['trop de membres', { membres: Array(501).fill(membre()) }],
  ])('refuse : %s', (_, champs) => {
    expect(parseHubOrganisation(corps(champs), HUB)).toEqual({
      error: 'invalid_body',
    });
  });

  it.each([
    'https://ailleurs.test/logo.png',
    `https://hub.test.ailleurs.test/api/public/org/${TENANT}/logo?v=a`,
    `${HUB}/api/public/org/${AUTRE}/logo?v=a`,
    `${LOGO}&next=https://ailleurs.test`,
    `${HUB}/api/public/org/${TENANT}/logo?v=`,
    `http://hub.test/api/public/org/${TENANT}/logo?v=a`,
  ])('logo hors du Hub refusé : %s', (logo_url) => {
    expect(parseHubOrganisation(corps({}, { logo_url }), HUB)).toEqual({
      error: 'logo_not_from_hub',
    });
  });

  it('logo refusé si le Hub est inconnu, accepté du nôtre', () => {
    expect(
      parseHubOrganisation(corps({}, { logo_url: LOGO }), undefined),
    ).toEqual({ error: 'logo_not_from_hub' });
    expect(lire(corps({}, { logo_url: LOGO })).logoUrl).toBe(LOGO);
  });

  it.each([
    ['adresse non prouvée', { email_proven: false }],
    ['rôle inconnu', { role: 'root' }],
    ['adhésion illisible', { joined_at: 'hier' }],
    ['identité illisible', { hub_user_id: 'x' }],
    ['adresse illisible', { email: 'x' }],
  ])('membre écarté et compté : %s', (_, champs) => {
    expect(lire(corps({ membres: [membre(champs)] }))).toMatchObject({
      members: [],
      refused: 1,
    });
  });
});

const monter = ({
  relie = true,
  stocke = null as object | null,
  espace = {
    id: 'ws',
    displayName: 'Avant',
    logoFileId: null as string | null,
  },
  existe = true,
  appartenance = {
    isMember: false,
    isDisabled: false,
    removedAt: null as Date | null,
  },
  portes = false,
  fichier = { id: 'nouveau' } as { id: string } | null,
  rattache = { status: 'ok' } as object | Error,
} = {}) => {
  const fil: string[] = [];
  const ecrit = jest.fn(async (_: any) => fil.push('version'));
  const maj = jest.fn(async (_id: string, champs: object) =>
    fil.push(Object.keys(champs)[0]),
  );
  const attacher = jest.fn(async (_: unknown) => {
    fil.push('membre');

    if (rattache instanceof Error) {
      throw rattache;
    }

    return rattache;
  });
  const role = jest.fn();
  const charger = jest.fn(async (_: unknown) => fichier);
  const effacer = jest.fn();
  const invalider = jest.fn();
  const verrou = jest.fn((fn: () => unknown, _: string) => fn());
  const trouver = jest.fn(async (_: any) =>
    stocke ? { id: 'kv', value: stocke } : null,
  );
  const service = new (VeridianHubOrganisationService as never as new (
    ...args: unknown[]
  ) => VeridianHubOrganisationService)(
    { findOne: trouver, save: ecrit },
    {
      findOne: jest.fn().mockResolvedValue(existe ? espace : null),
      update: maj,
    },
    {
      findWorkspaceIdByTenant: jest.fn(async (t: string) =>
        relie && t === TENANT ? 'ws' : null,
      ),
      describeMembership: jest.fn().mockResolvedValue(appartenance),
      attachMember: attacher,
    },
    { isCarried: jest.fn().mockResolvedValue(portes), applyRole: role },
    { uploadWorkspaceLogoFromUrl: charger, deleteCorePicture: effacer },
    { invalidate: invalider },
    { withLock: verrou },
  );
  const appliquer = (champs: object = {}, marque: object = {}) =>
    service.apply(lire(corps(champs, marque)));

  return {
    service,
    appliquer,
    fil,
    ecrit,
    maj,
    attacher,
    role,
    charger,
    effacer,
    invalider,
    verrou,
    trouver,
  };
};

describe("document d'organisation du Hub : effet", () => {
  it("espace non relié ou disparu : 404, rien n'est créé", async () => {
    for (const cas of [{ relie: false }, { existe: false }]) {
      const m = monter(cas);

      expect(await m.appliquer({ membres: [membre()] })).toEqual({
        status: 'tenant_not_linked',
      });
      expect(m.fil).toEqual([]);
    }
  });

  it.each([
    [10, 'unchanged'],
    [11, 'stale'],
  ])('version déjà à %s : rien (%s)', async (version, reason) => {
    const m = monter({ stocke: { version, logoUrl: null, logoFileId: null } });

    expect(
      await m.appliquer({ membres: [membre()] }, { nom_affiche: 'Nouveau' }),
    ).toEqual({ status: 'ok', applied: false, reason });
    expect(m.fil).toEqual([]);
  });

  it("applique sous verrou de l'espace, la version en dernier, sur la ligne de cet espace", async () => {
    const m = monter({
      stocke: { version: 9, logoUrl: null, logoFileId: null },
    });

    expect(
      await m.appliquer(
        { membres: [membre()] },
        { nom_affiche: 'Nouveau', logo_url: LOGO },
      ),
    ).toEqual({ status: 'ok', applied: true, attached: 1, refused: 0 });
    expect(m.fil).toEqual(['membre', 'displayName', 'logoFileId', 'version']);
    expect(m.verrou.mock.calls[0][1]).toBe('veridian-hub-organisation:ws');
    expect(m.trouver.mock.calls[0][0].where).toMatchObject({
      workspaceId: 'ws',
      key: 'veridian.hub_organisation',
    });
    expect(m.ecrit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'kv',
        workspaceId: 'ws',
        userId: null,
        value: { version: 10, logoUrl: LOGO, logoFileId: 'nouveau' },
      }),
    );
    expect(m.invalider).toHaveBeenCalledTimes(2);
  });

  it('rattache un membre par son identité du Hub, adresse en minuscules', async () => {
    const m = monter();

    await m.appliquer({ membres: [membre()] });
    expect(m.attacher).toHaveBeenCalledWith({
      workspaceId: 'ws',
      hubUserId: SUB,
      email: 'a@test.fr',
    });
  });

  it('un membre présent : ni rattaché, ni changé de rôle', async () => {
    const m = monter({
      appartenance: {
        isMember: true,
        isDisabled: false,
        removedAt: new Date('2027-01-01'),
      },
      portes: true,
    });

    expect(await m.appliquer({ membres: [membre()] })).toMatchObject({
      applied: true,
      attached: 0,
      refused: 0,
    });
    expect(m.attacher).not.toHaveBeenCalled();
    expect(m.role).not.toHaveBeenCalled();
  });

  it.each([
    ['après son adhésion', '2026-11-20T10:00:01.000Z', 0],
    ['au même instant', ADHESION, 0],
    ['avant une nouvelle adhésion', '2026-11-20T09:59:59.000Z', 1],
  ])('retiré %s', async (_, retrait, attendus) => {
    const m = monter({
      appartenance: {
        isMember: false,
        isDisabled: false,
        removedAt: new Date(retrait),
      },
    });

    expect(await m.appliquer({ membres: [membre()] })).toMatchObject({
      attached: attendus,
      refused: 1 - attendus,
    });
    expect(m.attacher).toHaveBeenCalledTimes(attendus);
  });

  it('compte désactivé ou identité contestée : refusé, compté, le reste passe', async () => {
    const coupe = monter({
      appartenance: { isMember: false, isDisabled: true, removedAt: null },
    });

    expect(await coupe.appliquer({ membres: [membre()] })).toMatchObject({
      applied: true,
      refused: 1,
    });
    expect(coupe.attacher).not.toHaveBeenCalled();

    const conteste = monter({
      rattache: { status: 'identity_conflict' },
      portes: true,
    });

    expect(await conteste.appliquer({ membres: [membre()] })).toMatchObject({
      applied: true,
      refused: 1,
      attached: 0,
    });
    expect(conteste.role).not.toHaveBeenCalled();
  });

  it('un rattachement en panne : les autres passent, la version ne bouge pas', async () => {
    const m = monter({ rattache: new Error('panne') });

    expect(
      await m.appliquer({
        membres: [membre(), membre({ hub_user_id: AUTRE })],
      }),
    ).toEqual({ status: 'members_failed' });
    expect(m.attacher).toHaveBeenCalledTimes(2);
    expect(m.ecrit).not.toHaveBeenCalled();
  });

  it("le rôle d'un nouveau ne suit le Hub que si le Hub porte déjà les rôles ici, à sa date d'adhésion", async () => {
    const natif = monter();

    await natif.appliquer({ membres: [membre()] });
    expect(natif.role).not.toHaveBeenCalled();

    const porte = monter({ portes: true });

    await porte.appliquer({ membres: [membre()] });
    expect(porte.role).toHaveBeenCalledWith({
      hubTenantId: TENANT,
      hubUserId: SUB,
      role: 'admin',
      version: Date.parse(ADHESION),
    });
  });

  it('aucun nom ni logo choisi : rien ne se renomme ni ne se vide, le logo posé reste connu', async () => {
    const m = monter({
      stocke: { version: 1, logoUrl: LOGO, logoFileId: 'f' },
      espace: { id: 'ws', displayName: 'Avant', logoFileId: 'f' },
    });

    await m.appliquer();
    expect(m.maj).not.toHaveBeenCalled();
    expect(m.charger).not.toHaveBeenCalled();
    expect(m.effacer).not.toHaveBeenCalled();
    expect(m.ecrit.mock.calls[0][0].value).toEqual({
      version: 10,
      logoUrl: LOGO,
      logoFileId: 'f',
    });
  });

  it('même nom : aucune écriture', async () => {
    const m = monter();

    await m.appliquer({}, { nom_affiche: 'Avant' });
    expect(m.maj).not.toHaveBeenCalled();
  });

  it('même logo encore en place : pas rechargé ; remplacé à la main : reposé, ancien fichier effacé', async () => {
    const stocke = { version: 1, logoUrl: LOGO, logoFileId: 'f' };
    const pareil = monter({
      stocke,
      espace: { id: 'ws', displayName: 'Avant', logoFileId: 'f' },
    });

    await pareil.appliquer({}, { logo_url: LOGO });
    expect(pareil.charger).not.toHaveBeenCalled();

    const change = monter({
      stocke,
      espace: { id: 'ws', displayName: 'Avant', logoFileId: 'main' },
    });

    await change.appliquer({}, { logo_url: LOGO });
    expect(change.maj).toHaveBeenCalledWith('ws', { logoFileId: 'nouveau' });
    expect(change.effacer).toHaveBeenCalledWith({
      fileId: 'main',
      workspaceId: 'ws',
    });

    const neuf = monter({
      stocke: { ...stocke, logoUrl: `${LOGO}z` },
      espace: { id: 'ws', displayName: 'Avant', logoFileId: 'f' },
    });

    await neuf.appliquer({}, { logo_url: LOGO });
    expect(neuf.charger).toHaveBeenCalledWith({
      imageUrl: LOGO,
      workspaceId: 'ws',
    });
  });

  it("logo que le Hub ne sert pas : l'ancien reste, la version ne bouge pas", async () => {
    const m = monter({
      fichier: null,
      espace: { id: 'ws', displayName: 'Avant', logoFileId: 'f' },
    });

    expect(await m.appliquer({}, { logo_url: LOGO })).toEqual({
      status: 'logo_unreachable',
    });
    expect(m.fil).toEqual([]);
    expect(m.effacer).not.toHaveBeenCalled();
  });

  it('relecture : la version servie, 0 avant tout document, null si non relié', async () => {
    const stocke = { version: 42, logoUrl: null, logoFileId: null };

    expect(await monter({ stocke }).service.readVersion(TENANT)).toBe(42);
    expect(await monter().service.readVersion(TENANT)).toBe(0);
    expect(await monter({ stocke }).service.readVersion(AUTRE)).toBeNull();
  });
});
