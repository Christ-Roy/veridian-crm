// Le service natif est remplacé : le charger tire twenty-client-sdk, non construit en CI.
jest.mock(
  'src/engine/api/graphql/direct-execution/direct-execution.service',
  () => ({ DirectExecutionService: class {} }),
);
jest.mock(
  'src/engine/workspace-cache/services/workspace-cache.service',
  () => ({ WorkspaceCacheService: class {} }),
);

import { TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER } from 'twenty-shared/application';
import { STANDARD_OBJECTS } from 'twenty-shared/metadata';

import { getMcpRegistryToolAnnotations } from 'src/engine/api/mcp/utils/get-mcp-registry-tool-annotations.util';
import { DirectExecutionService } from 'src/engine/api/graphql/direct-execution/direct-execution.service';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { DEFINE_TOOL_METADATA_KEY } from 'src/engine/core-modules/tool-provider/constants/define-tool-metadata-key.constant';
import { VeridianApiRunnerService } from 'src/engine/core-modules/veridian-mcp-api/api-runner.service';
import { ApiEcrireTool } from 'src/engine/core-modules/veridian-mcp-api/tools/api-ecrire.tool';
import { ApiLireTool } from 'src/engine/core-modules/veridian-mcp-api/tools/api-lire.tool';
import { ApiSupprimerTool } from 'src/engine/core-modules/veridian-mcp-api/tools/api-supprimer.tool';
import {
  API_LIMITS,
  type ApiToolKind,
  checkApiOperation,
} from 'src/engine/core-modules/veridian-mcp-api/utils/check-api-operation.util';
import { VERIDIAN_MCP_API_POLICY } from 'src/engine/core-modules/veridian-mcp-api/veridian-mcp-api-policy.constant';
import { findVeridianMcpToolAnnotations } from 'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tool-annotations.constant';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

const entree = (method: string, objet = 'personne') => ({
  method,
  objectMetadataUniversalIdentifier: objet,
  operationType: 'query',
});
const CARTE = {
  people: entree('findMany'),
  person: entree('findOne'),
  personDuplicates: entree('findDuplicates'),
  peopleGroupBy: entree('groupBy'),
  createPerson: entree('createOne'),
  createPeople: entree('createMany'),
  updatePerson: entree('updateOne'),
  updatePeople: entree('updateMany'),
  deletePerson: entree('deleteOne'),
  deletePeople: entree('deleteMany'),
  destroyPerson: entree('destroyOne'),
  destroyPeople: entree('destroyMany'),
  restorePerson: entree('restoreOne'),
  restorePeople: entree('restoreMany'),
  mergePeople: entree('mergeMany'),
  workspaceMembers: entree('findMany', 'membre'),
  membresGroupBy: entree('groupBy', 'membre'),
  updateWorkspaceMember: entree('updateOne', 'membre'),
  deleteWorkspaceMember: entree('deleteOne', 'membre'),
  workflows: entree('findMany', 'workflow'),
} as never;

const apiObjet = (
  readable: boolean,
  writable: boolean,
  fields: [string, string | null][] = [],
  hidden: string[] = [],
  only?: string[],
) => ({
  readable,
  writable,
  fields: new Map(fields),
  hidden: new Set(hidden),
  only: only && new Set(only),
});
const OBJETS = new Map([
  [
    'personne',
    apiObjet(
      true,
      true,
      [
        ['name', null],
        ['company', 'societe'],
        ['messageParticipants', 'message'],
        ['owner', 'membre'],
        ['photo', null],
      ],
      ['photo', 'lien'],
    ),
  ],
  [
    'societe',
    apiObjet(true, true, [
      ['company', 'societe'],
      ['people', 'personne'],
      ['messages', 'message'],
    ]),
  ],
  [
    'membre',
    apiObjet(
      true,
      false,
      [
        ['comptes', 'compte'],
        ['name', null],
        ['taches', 'personne'],
      ],
      [],
      ['id', 'name', 'userEmail'],
    ),
  ],
  ['message', apiObjet(false, false)],
]);

const juger = (
  kind: ApiToolKind,
  query: string,
  variables: Record<string, unknown> = {},
) =>
  checkApiOperation({
    query,
    variables,
    kind,
    resolverNameMap: CARTE,
    objects: OBJETS,
  }).ok;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

describe('tri des opérations : la méthode réelle décide, jamais le nom', () => {
  it.each<[ApiToolKind, string]>([
    ['lire', '{ people(first: 5) { edges { node { id } } } }'],
    ['lire', '{ person(filter: {id: {eq: "a"}}) { id company { name } } }'],
    ['lire', '{ a: peopleGroupBy { x } b: personDuplicates { x } }'],
    [
      'lire',
      '{ workspaceMembers { totalCount pageInfo { endCursor } edges { cursor node { id userEmail name { firstName } __typename } } } }',
    ],
    [
      'lire',
      '{ people { edges { node { name { firstName } company { people { edges { node { id owner { id } } } } } } } } }',
    ],
    ['ecrire', 'mutation { createPerson(data: {}) { id } }'],
    ['ecrire', 'mutation { updatePerson(id: "a", data: {}) { id } }'],
    ['supprimer', 'mutation { deletePerson(id: "a") { id } }'],
    ['supprimer', 'mutation { destroyPerson(id: "a") { id } }'],
    ['supprimer', 'mutation { mergePeople(ids: ["a","b"]) { id } }'],
  ])('%s accepte %s', (kind, query) => {
    expect(juger(kind, query)).toBe(true);
  });

  it.each<[ApiToolKind, string]>([
    ['lire', 'mutation { createPerson(data: {}) { id } }'],
    ['lire', 'query { createPerson(data: {}) { id } }'],
    ['lire', 'query { deletePerson(id: "a") { id } }'],
    ['lire', 'subscription { people { id } }'],
    ['ecrire', 'query { people { id } }'],
    ['ecrire', 'mutation { deletePerson(id: "a") { id } }'],
    ['ecrire', 'mutation { createPerson: destroyPerson(id: "a") { id } }'],
    [
      'ecrire',
      'mutation { createPerson(data: {}) { id } deletePerson(id: "a") { id } }',
    ],
    ['ecrire', 'mutation { mergePeople(ids: ["a"]) { id } }'],
    ['ecrire', 'mutation { restorePerson(id: "a") { id } }'],
    ['supprimer', 'mutation { updatePerson(id: "a", data: {}) { id } }'],
    ['supprimer', 'mutation { createPerson(data: {}) { id } }'],
    ['supprimer', 'mutation { restorePerson(id: "a") { id } }'],
  ])('%s refuse %s', (kind, query) => {
    expect(juger(kind, query)).toBe(false);
  });

  it.each([
    ['hors des fiches', '{ currentUser { id } }'],
    ['rôles', '{ getRoles { id } }'],
    ['clés API', '{ apiKeys { id } }'],
    ['introspection', '{ __schema { types { name } } }'],
    ['type', '{ __type(name: "Person") { name } }'],
    ['__typename seul', '{ __typename }'],
    ['nom hérité', '{ constructor }'],
    ['nom hérité', '{ toString { id } }'],
    ['objet interdit', '{ workflows { id } }'],
    ['un fragment', 'query { ...f } fragment f on Query { people { id } }'],
    ['un fragment profond', 'query { people { ...f } } fragment f on P { id }'],
    ['un fragment sans définition', '{ people { id ...f } }'],
    ['un fragment en ligne', '{ ... on Query { people { id } } }'],
    ['une directive', '{ people @include(if: true) { id } }'],
    ['deux opérations', 'query a { people { id } } query b { people { id } }'],
    [
      'une mutation derrière la requête',
      'query a { people { id } } mutation b { deletePerson(id: "a") { id } }',
    ],
    ['un fichier', '{ people { photo { url } } }'],
    ['un lien de fichier sous un alias', '{ people { x: lien } }'],
    [
      'les réglages d’un membre',
      '{ workspaceMembers { edges { node { locale } } } }',
    ],
    [
      'les réglages d’un membre par une fiche',
      '{ people { owner { x: timeZone } } }',
    ],
    [
      'les fiches d’un membre par lui',
      '{ workspaceMembers { taches { id } } }',
    ],
    ['les membres regroupés', '{ membresGroupBy { totalCount } }'],
    ['les mails par relation', '{ people { messageParticipants { id } } }'],
    [
      'les mails par relation profonde',
      '{ people { edges { node { company { x: messages { edges { node { id } } } } } } } }',
    ],
    ['un objet absent par relation', '{ people { owner { comptes { id } } } }'],
    ['une relation inconnue', '{ people { inconnue { id } } }'],
    ['un secret', '{ people { node { accessToken } } }'],
    ['un secret sous un alias', '{ people { x: refreshToken } }'],
    ['du texte', 'DROP TABLE'],
    ['du vide', ''],
  ])('lire refuse : %s', (_nom, query) => {
    expect(juger('lire', query)).toBe(false);
  });

  it('objets interdits en écriture', () => {
    expect(
      juger(
        'ecrire',
        'mutation { updateWorkspaceMember(id: "a", data: {}) { id } }',
      ),
    ).toBe(false);
  });

  it('écrire ou supprimer un objet lisible seulement est refusé', () => {
    expect(
      juger('supprimer', 'mutation { deleteWorkspaceMember(id: "a") { id } }'),
    ).toBe(false);
    expect(
      juger(
        'ecrire',
        'mutation { createPerson(data: {}) { messageParticipants { id } } }',
      ),
    ).toBe(false);
  });

  it.each<[ApiToolKind, string]>([
    ['ecrire', 'updatePeople'],
    ['supprimer', 'deletePeople'],
    ['supprimer', 'destroyPeople'],
  ])('%s : %s par identifiants seulement, 100 au plus', (kind, nom) => {
    const par = (filter: unknown) =>
      juger(kind, `mutation($f: F) { ${nom}(filter: $f, data: {}) { id } }`, {
        f: filter,
      });

    expect(par({ id: { in: ids(1) } })).toBe(true);
    expect(par({ id: { in: ids(API_LIMITS.ids) } })).toBe(true);
    for (const filter of [
      undefined,
      null,
      {},
      { id: {} },
      { id: { in: [] } },
      { id: { in: ids(API_LIMITS.ids + 1) } },
      { id: { neq: 'a' } },
      { id: { in: ids(1), neq: 'x' } },
      { id: { in: ids(1) }, or: [{}] },
      { or: [{ id: { in: ids(1) } }, {}] },
      { name: { like: '%' } },
    ]) {
      expect(par(filter)).toBe(false);
    }
    expect(juger(kind, `mutation { ${nom}(filter: {}) { id } }`)).toBe(false);
  });

  it('deletedAt ne s’écrit pas, ni en clair ni en variable ni en profondeur', () => {
    expect(
      juger(
        'ecrire',
        'mutation { updatePerson(id: "a", data: {deletedAt: "2026"}) { id } }',
      ),
    ).toBe(false);
    expect(
      juger(
        'ecrire',
        'mutation($d: D) { createPeople(data: $d, upsert: true) { id } }',
        {
          d: [{ name: {}, company: { create: [{ deletedAt: null }] } }],
        },
      ),
    ).toBe(false);
  });

  it('plafonds : taille, jetons, champs racine, profondeur, lot', () => {
    const large = '{ people { id ' + ' '.repeat(API_LIMITS.query) + '} }';

    expect(juger('lire', large)).toBe(false);
    expect(
      juger('lire', '{ people { id } }', {
        x: 'a'.repeat(API_LIMITS.variables),
      }),
    ).toBe(false);
    expect(
      juger(
        'lire',
        `{ ${ids(API_LIMITS.rootFields + 1)
          .map((x) => `${x.replace('-', '')}: people { id }`)
          .join(' ')} }`,
      ),
    ).toBe(false);
    expect(
      juger(
        'lire',
        `{ people ${'{ company '.repeat(API_LIMITS.depth)} { id } ${'}'.repeat(API_LIMITS.depth)} }`,
      ),
    ).toBe(false);
    expect(
      juger('ecrire', 'mutation($d: D) { createPeople(data: $d) { id } }', {
        d: ids(API_LIMITS.ids + 1),
      }),
    ).toBe(false);
    expect(
      juger('ecrire', 'mutation($d: D) { createPeople(data: $d) { id } }', {
        d: ids(API_LIMITS.ids),
      }),
    ).toBe(true);
  });
});

const ESPACE = '0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b';
const membre = { type: 'user', workspace: { id: ESPACE } };
const objet = (nameSingular: string, plus: object = {}) => ({
  applicationUniversalIdentifier:
    TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER,
  isSystem: false,
  isActive: true,
  ...plus,
  nameSingular,
  universalIdentifier: `u-${nameSingular}`,
});

const monter = (resultat: unknown = { data: { people: [] } }) => {
  const vus: unknown[] = [];
  const execute = jest.fn(async (..._args: unknown[]) => {
    vus.push(getWorkspaceAuthContext());

    return resultat;
  });
  const carte = {
    people: entree('findMany', 'u-person'),
    createPerson: entree('createOne', 'u-person'),
    workspaceMembers: entree('findMany', 'u-workspaceMember'),
    updateWorkspaceMember: entree('updateOne', 'u-workspaceMember'),
    workflows: entree(
      'findMany',
      STANDARD_OBJECTS.workflow.universalIdentifier,
    ),
    vieux: entree('findMany', 'u-inactif'),
    messages: entree('findMany', 'u-message'),
    nouveaux: entree('findMany', 'u-nouveauDeLAmont'),
    createNouveau: entree('createOne', 'u-nouveauDeLAmont'),
    deleteWorkspaceMember: entree('deleteOne', 'u-workspaceMember'),
    updateAppel: entree('updateOne', 'u-appel'),
    updateCache: entree('updateOne', 'u-cache'),
  };
  const services = new Map<unknown, object>([
    [DirectExecutionService, { execute }],
    [
      WorkspaceCacheService,
      {
        getOrRecompute: async (id: string) => {
          expect(id).toBe(ESPACE);

          return {
            graphQLResolverNameMap: carte,
            flatObjectMetadataMaps: {
              byUniversalIdentifier: {
                a: objet('person'),
                b: objet('workspaceMember'),
                c: {
                  ...objet('workflow'),
                  universalIdentifier:
                    STANDARD_OBJECTS.workflow.universalIdentifier,
                },
                d: objet('inactif', {
                  applicationUniversalIdentifier: 'app',
                  isActive: false,
                }),
                e: objet('message', { isSystem: true }),
                f: objet('nouveauDeLAmont'),
                g: objet('appel', { applicationUniversalIdentifier: 'app' }),
                h: objet('cache', {
                  applicationUniversalIdentifier: 'app',
                  isSystem: true,
                }),
              },
            },
            flatFieldMetadataMaps: {
              byUniversalIdentifier: {
                a: {
                  name: 'messages',
                  objectMetadataUniversalIdentifier: 'u-person',
                  relationTargetObjectMetadataUniversalIdentifier: 'u-message',
                },
                b: {
                  name: 'appels',
                  objectMetadataUniversalIdentifier: 'u-person',
                  relationTargetObjectMetadataUniversalIdentifier: 'u-appel',
                },
                c: {
                  name: 'name',
                  objectMetadataUniversalIdentifier: 'u-person',
                },
                d: {
                  name: 'piece',
                  type: 'FILES',
                  objectMetadataUniversalIdentifier: 'u-person',
                },
                f: {
                  name: 'name',
                  objectMetadataUniversalIdentifier: 'u-workspaceMember',
                },
                e: {
                  name: 'avatarUrl',
                  type: 'TEXT',
                  objectMetadataUniversalIdentifier: 'u-person',
                },
              },
            },
          };
        },
      },
    ],
  ]);
  const runner = new VeridianApiRunnerService({
    get: (s: unknown) => services.get(s),
  } as never);
  const run = (
    kind: ApiToolKind,
    query: string,
    authContext: unknown = membre,
  ) =>
    runner.run({
      kind,
      query,
      context: { workspaceId: ESPACE, authContext, locale: 'fr-FR' } as never,
    });

  return { run, execute, vus };
};

describe('exécution : sous l’identité du membre, par le service natif', () => {
  it('passe la requête telle quelle dans l’espace du membre, sans introspection', async () => {
    const e = monter();
    const sortie = await e.run('lire', '{ people { id } }');

    expect(sortie).toMatchObject({ success: true, result: { people: [] } });
    expect(e.vus).toEqual([membre]);
    expect(e.execute).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: { id: ESPACE }, locale: 'fr-FR' }),
      expect.objectContaining({ kind: 'Document' }),
      false,
      true,
    );
  });

  it.each([
    ['une clé', { type: 'apiKey', workspace: { id: ESPACE } }],
    ['une app', { type: 'application', workspace: { id: ESPACE } }],
    ['le système', { type: 'system', workspace: { id: ESPACE } }],
    ['personne', undefined],
    ['un autre espace', { type: 'user', workspace: { id: 'autre' } }],
  ])('refuse %s', async (_nom, authContext) => {
    const e = monter();

    expect(
      (await e.run('lire', '{ people { id } }', authContext ?? null)).success,
    ).toBe(false);
    expect(e.execute).not.toHaveBeenCalled();
  });

  it.each<[ApiToolKind, string]>([
    ['lire', '{ workflows { id } }'],
    ['lire', '{ vieux { id } }'],
    ['lire', '{ messages { id } }'],
    ['lire', '{ nouveaux { id } }'],
    ['lire', '{ people { messages { id } } }'],
    ['lire', '{ people { piece { url } } }'],
    ['lire', '{ people { avatarUrl } }'],
    ['lire', '{ workspaceMembers { locale } }'],
    ['ecrire', 'mutation { createPerson(data: {}) { piece } }'],
    ['ecrire', 'mutation { createNouveau(data: {}) { id } }'],
    ['ecrire', 'mutation { updateCache(id: "a", data: {}) { id } }'],
    ['supprimer', 'mutation { deleteWorkspaceMember(id: "a") { id } }'],
    ['ecrire', 'mutation { updateWorkspaceMember(id: "a", data: {}) { id } }'],
    ['ecrire', '{ people { id } }'],
  ])('%s n’exécute pas %s', async (kind, query) => {
    const e = monter();

    expect((await e.run(kind, query)).success).toBe(false);
    expect(e.execute).not.toHaveBeenCalled();
  });

  it.each<[ApiToolKind, string]>([
    ['lire', '{ workspaceMembers { id name { firstName } userEmail } }'],
    ['lire', '{ people { name { firstName } appels { id } } }'],
    ['ecrire', 'mutation { updateAppel(id: "a", data: {}) { id } }'],
  ])(
    '%s exécute %s (liste blanche et objets des apps)',
    async (kind, query) => {
      const e = monter();

      expect((await e.run(kind, query)).success).toBe(true);
      expect(e.execute).toHaveBeenCalledTimes(1);
    },
  );

  it('une erreur native est un échec, pas un succès vide', async () => {
    const e = monter({ data: { people: null }, errors: [{ message: 'non' }] });

    expect(await e.run('lire', '{ people { id } }')).toMatchObject({
      success: false,
      message: 'non',
    });
    expect((await monter(null).run('lire', '{ people { id } }')).success).toBe(
      false,
    );
  });

  it('réponse trop grande : refusée en lecture, l’écriture faite reste dite faite', async () => {
    const gros = { data: { x: 'a'.repeat(API_LIMITS.result) } };

    expect((await monter(gros).run('lire', '{ people { id } }')).success).toBe(
      false,
    );
    expect(
      await monter(gros).run(
        'ecrire',
        'mutation { createPerson(data: {}) { id } }',
      ),
    ).toEqual({ success: true, message: expect.stringContaining('too large') });
  });
});

describe('déclaration', () => {
  it.each([
    [
      ApiLireTool,
      'api_lire',
      'lire',
      { readOnlyHint: true, destructiveHint: false },
    ],
    [ApiEcrireTool, 'api_ecrire', 'ecrire', { readOnlyHint: false }],
    [
      ApiSupprimerTool,
      'api_supprimer',
      'supprimer',
      { readOnlyHint: false, destructiveHint: true },
    ],
  ] as const)('%p', async (Outil, nom, kind, attendu) => {
    const meta = Reflect.getMetadata(DEFINE_TOOL_METADATA_KEY, Outil);
    const run = jest.fn(async () => ({ success: true, message: '' }));

    expect(meta.name).toBe(nom);
    expect(meta.accessPolicy).toBe(VERIDIAN_MCP_API_POLICY);
    expect(
      getMcpRegistryToolAnnotations({ kind: 'static', toolId: nom }),
    ).toMatchObject(attendu);
    if (nom === 'api_ecrire') {
      expect(findVeridianMcpToolAnnotations(nom)).toBeUndefined();
    }
    await new Outil({ run } as never).execute({
      input: { query: 'q', variables: { a: 1 } },
      context: 'c' as never,
    });
    expect(run).toHaveBeenCalledWith({
      kind,
      query: 'q',
      variables: { a: 1 },
      context: 'c',
    });
  });

  it('jamais une clé ni une app', () => {
    expect(VERIDIAN_MCP_API_POLICY.authPrincipals).toMatchObject({
      apiKey: false,
      application: false,
      oauthClient: { withUser: true, withoutUser: false },
    });
  });
});
