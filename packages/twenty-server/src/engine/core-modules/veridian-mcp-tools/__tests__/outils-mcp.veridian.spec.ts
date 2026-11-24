// Les services natifs sont remplacés dans chaque épreuve ; les charger tire twenty-client-sdk et twenty-emails, non construits en CI.
const stub = (path: string, ...names: string[]) =>
  jest.doMock(path, () =>
    Object.fromEntries(names.map((name) => [name, class {}])),
  );

stub('src/engine/core-modules/search/services/search.service', 'SearchService');
stub('src/engine/dataloaders/dataloader.service', 'DataloaderService');
stub(
  'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service',
  'WorkspaceManyOrAllFlatEntityMapsCacheService',
);
stub('src/engine/permissions/permissions.service', 'PermissionsService');
stub(
  'src/engine/core-modules/messaging/services/get-messages.service',
  'GetMessagesService',
);
stub(
  'src/engine/core-modules/calendar/timeline-calendar-event.service',
  'TimelineCalendarEventService',
);
stub(
  'src/engine/metadata-modules/connected-account/connected-account-metadata.service',
  'ConnectedAccountMetadataService',
);
stub(
  'src/engine/metadata-modules/message-channel/message-channel-metadata.service',
  'MessageChannelMetadataService',
);
stub(
  'src/engine/metadata-modules/calendar-channel/calendar-channel-metadata.service',
  'CalendarChannelMetadataService',
);
stub(
  'src/engine/metadata-modules/message-folder/message-folder-metadata.service',
  'MessageFolderMetadataService',
);
stub(
  'src/modules/connected-account/channel-sync/services/channel-sync.service',
  'ChannelSyncService',
);
stub(
  'src/engine/api/common/common-query-runners/common-find-duplicates-query-runner.service',
  'CommonFindDuplicatesQueryRunnerService',
);
stub(
  'src/engine/api/common/common-query-runners/common-restore-many-query-runner.service',
  'CommonRestoreManyQueryRunnerService',
);
stub(
  'src/engine/core-modules/record-crud/services/common-api-context-builder.service',
  'CommonApiContextBuilderService',
);
stub(
  'src/engine/core-modules/workspace/services/workspace.service',
  'WorkspaceService',
);
stub(
  'src/engine/core-modules/api-key/services/api-key.service',
  'ApiKeyService',
);
stub(
  'src/engine/core-modules/api-key/services/api-key-role.service',
  'ApiKeyRoleService',
);
stub(
  'src/engine/permissions/record-share/services/record-sharing.service',
  'RecordSharingService',
);
stub(
  'src/engine/core-modules/workflow/services/workflow-version-core-sync.service',
  'WorkflowVersionCoreSyncService',
);
stub(
  'src/engine/core-modules/workflow/services/core-workflow-access.service',
  'CoreWorkflowAccessService',
);
stub(
  'src/modules/workflow/workflow-runner/services/core-workflow-runner.service',
  'CoreWorkflowRunnerService',
);
jest.doMock(
  'src/engine/core-modules/workflow/entities/workflow-version.entity',
  () => ({
    WorkflowVersionStatus: {
      DRAFT: 'DRAFT',
      ACTIVE: 'ACTIVE',
      DEACTIVATED: 'DEACTIVATED',
      ARCHIVED: 'ARCHIVED',
    },
  }),
);

/* eslint-disable @typescript-eslint/no-require-imports */
import { readFileSync } from 'fs';
import { join } from 'path';

import { PermissionFlagType } from 'twenty-shared/constants';

import { type AccessPolicy } from 'src/engine/guards/types/access-policy.type';

const load = <T>(path: string): T => require(path) as T;

const { DEFINE_TOOL_METADATA_KEY } = load<
  typeof import('src/engine/core-modules/tool-provider/constants/define-tool-metadata-key.constant')
>(
  'src/engine/core-modules/tool-provider/constants/define-tool-metadata-key.constant',
);
const policies = load<
  typeof import('src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-policies.constant')
>(
  'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-policies.constant',
);
const limits = load<
  typeof import('src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-limits.constant')
>(
  'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tools-limits.constant',
);
const { API_KEY_READ_ACCESS_POLICY } = load<
  typeof import('src/engine/core-modules/api-key/constants/api-key-read-access-policy.constant')
>(
  'src/engine/core-modules/api-key/constants/api-key-read-access-policy.constant',
);
const annotations = load<
  typeof import('src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tool-annotations.constant')
>(
  'src/engine/core-modules/veridian-mcp-tools/veridian-mcp-tool-annotations.constant',
);
const { getMcpRegistryToolAnnotations } = load<
  typeof import('src/engine/api/mcp/utils/get-mcp-registry-tool-annotations.util')
>('src/engine/api/mcp/utils/get-mcp-registry-tool-annotations.util');
const { MCP_EXECUTE_TOOL_ANNOTATIONS } = load<
  typeof import('src/engine/api/mcp/constants/mcp-execute-tool-annotations.const')
>('src/engine/api/mcp/constants/mcp-execute-tool-annotations.const');
const { MCP_CLOSED_WORLD_READ_ONLY_TOOL_ANNOTATIONS } = load<
  typeof import('src/engine/api/mcp/constants/mcp-closed-world-read-only-tool-annotations.constant')
>(
  'src/engine/api/mcp/constants/mcp-closed-world-read-only-tool-annotations.constant',
);

const tools = {
  search: load<
    typeof import('src/engine/core-modules/veridian-mcp-tools/tools/search-records.tool')
  >('src/engine/core-modules/veridian-mcp-tools/tools/search-records.tool')
    .SearchRecordsTool,
  perms: load<
    typeof import('src/engine/core-modules/veridian-mcp-tools/tools/get-my-permissions.tool')
  >('src/engine/core-modules/veridian-mcp-tools/tools/get-my-permissions.tool')
    .GetMyPermissionsTool,
  threads: load<
    typeof import('src/engine/core-modules/veridian-mcp-tools/tools/get-record-email-threads.tool')
  >(
    'src/engine/core-modules/veridian-mcp-tools/tools/get-record-email-threads.tool',
  ).GetRecordEmailThreadsTool,
  events: load<
    typeof import('src/engine/core-modules/veridian-mcp-tools/tools/get-record-calendar-events.tool')
  >(
    'src/engine/core-modules/veridian-mcp-tools/tools/get-record-calendar-events.tool',
  ).GetRecordCalendarEventsTool,
  accounts: load<
    typeof import('src/engine/core-modules/veridian-mcp-tools/tools/list-connected-accounts.tool')
  >(
    'src/engine/core-modules/veridian-mcp-tools/tools/list-connected-accounts.tool',
  ).ListConnectedAccountsTool,
  sync: load<
    typeof import('src/engine/core-modules/veridian-mcp-tools/tools/get-sync-status.tool')
  >('src/engine/core-modules/veridian-mcp-tools/tools/get-sync-status.tool')
    .GetSyncStatusTool,
  duplicates: load<
    typeof import('src/engine/core-modules/veridian-mcp-tools/tools/find-duplicate-records.tool')
  >(
    'src/engine/core-modules/veridian-mcp-tools/tools/find-duplicate-records.tool',
  ).FindDuplicateRecordsTool,
  settings: load<
    typeof import('src/engine/core-modules/veridian-mcp-tools/tools/get-workspace-settings.tool')
  >(
    'src/engine/core-modules/veridian-mcp-tools/tools/get-workspace-settings.tool',
  ).GetWorkspaceSettingsTool,
  keys: load<
    typeof import('src/engine/core-modules/veridian-mcp-tools/tools/list-api-keys.tool')
  >('src/engine/core-modules/veridian-mcp-tools/tools/list-api-keys.tool')
    .ListApiKeysTool,
  sharing: load<
    typeof import('src/engine/core-modules/veridian-mcp-tools/tools/get-record-sharing.tool')
  >('src/engine/core-modules/veridian-mcp-tools/tools/get-record-sharing.tool')
    .GetRecordSharingTool,
  restore: load<
    typeof import('src/engine/core-modules/veridian-mcp-tools/tools/restore-records.tool')
  >('src/engine/core-modules/veridian-mcp-tools/tools/restore-records.tool')
    .RestoreRecordsTool,
  retry: load<
    typeof import('src/engine/core-modules/veridian-mcp-tools/tools/retry-channel-sync.tool')
  >('src/engine/core-modules/veridian-mcp-tools/tools/retry-channel-sync.tool')
    .RetryChannelSyncTool,
  run: load<
    typeof import('src/engine/core-modules/veridian-mcp-tools/tools/run-workflow.tool')
  >('src/engine/core-modules/veridian-mcp-tools/tools/run-workflow.tool')
    .RunWorkflowTool,
};

const service = (path: string, name: string) =>
  load<Record<string, new () => object>>(path)[name];

const S = {
  search: service(
    'src/engine/core-modules/search/services/search.service',
    'SearchService',
  ),
  loaders: service(
    'src/engine/dataloaders/dataloader.service',
    'DataloaderService',
  ),
  maps: service(
    'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service',
    'WorkspaceManyOrAllFlatEntityMapsCacheService',
  ),
  permissions: service(
    'src/engine/permissions/permissions.service',
    'PermissionsService',
  ),
  messages: service(
    'src/engine/core-modules/messaging/services/get-messages.service',
    'GetMessagesService',
  ),
  calendar: service(
    'src/engine/core-modules/calendar/timeline-calendar-event.service',
    'TimelineCalendarEventService',
  ),
  accounts: service(
    'src/engine/metadata-modules/connected-account/connected-account-metadata.service',
    'ConnectedAccountMetadataService',
  ),
  messageChannels: service(
    'src/engine/metadata-modules/message-channel/message-channel-metadata.service',
    'MessageChannelMetadataService',
  ),
  calendarChannels: service(
    'src/engine/metadata-modules/calendar-channel/calendar-channel-metadata.service',
    'CalendarChannelMetadataService',
  ),
  folders: service(
    'src/engine/metadata-modules/message-folder/message-folder-metadata.service',
    'MessageFolderMetadataService',
  ),
  channelSync: service(
    'src/modules/connected-account/channel-sync/services/channel-sync.service',
    'ChannelSyncService',
  ),
  duplicates: service(
    'src/engine/api/common/common-query-runners/common-find-duplicates-query-runner.service',
    'CommonFindDuplicatesQueryRunnerService',
  ),
  restore: service(
    'src/engine/api/common/common-query-runners/common-restore-many-query-runner.service',
    'CommonRestoreManyQueryRunnerService',
  ),
  builder: service(
    'src/engine/core-modules/record-crud/services/common-api-context-builder.service',
    'CommonApiContextBuilderService',
  ),
  workspace: service(
    'src/engine/core-modules/workspace/services/workspace.service',
    'WorkspaceService',
  ),
  apiKeys: service(
    'src/engine/core-modules/api-key/services/api-key.service',
    'ApiKeyService',
  ),
  apiKeyRoles: service(
    'src/engine/core-modules/api-key/services/api-key-role.service',
    'ApiKeyRoleService',
  ),
  recordSharing: service(
    'src/engine/permissions/record-share/services/record-sharing.service',
    'RecordSharingService',
  ),
  versions: service(
    'src/engine/core-modules/workflow/services/workflow-version-core-sync.service',
    'WorkflowVersionCoreSyncService',
  ),
  access: service(
    'src/engine/core-modules/workflow/services/core-workflow-access.service',
    'CoreWorkflowAccessService',
  ),
  runner: service(
    'src/modules/workflow/workflow-runner/services/core-workflow-runner.service',
    'CoreWorkflowRunnerService',
  ),
};

const ESPACE = '0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b';
const MEMBRE = '5f0a5d4c-2a3e-4a43-9d0e-5a0c3a6a8c11';
const FICHE = '8c1d6a62-7a3b-4d58-9f0a-0b6a1f0c2f77';
const COMPTE = '3f7e9a10-5d2b-4c8e-8a41-6b9c0d1e2f33';
const VERSION = '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeNative = (entries: [unknown, object][]): any => {
  const touched: unknown[] = [];

  return {
    touched,
    get: (service: unknown) => {
      touched.push(service);
      const found = entries.find(([key]) => key === service);

      if (!found) {
        throw new Error(`service non prévu ${String(service)}`);
      }

      return found[1];
    },
  };
};

const sessionAuth = {
  type: 'user',
  userWorkspaceId: MEMBRE,
  workspace: { id: ESPACE, workspaceCustomApplicationId: 'app-custom' },
  workspaceMember: { id: 'wm1', name: { firstName: 'A', lastName: 'B' } },
  application: undefined,
};
const context = {
  workspaceId: ESPACE,
  userWorkspaceId: MEMBRE,
  authContext: sessionAuth,
} as never;
const sansMembre = {
  workspaceId: ESPACE,
  authContext: { type: 'apiKey' },
} as never;

const lignes = (n: number, make: (i: number) => object) =>
  Array.from({ length: n }, (_, i) => make(i));

// Les politiques des résolveurs ne sont pas exportées : on compare notre copie au texte même du résolveur.
const compact = (text: string) =>
  text.replace(/\s+/g, '').replace(/,(?=[}\]])/g, '');

const rendre = (policy: AccessPolicy): string => {
  const flag = (value: PermissionFlagType) =>
    `PermissionFlagType.${Object.entries(PermissionFlagType).find(([, v]) => v === value)?.[0]}`;
  const principal = (value: unknown): string =>
    typeof value === 'boolean'
      ? String(value)
      : `{${Object.entries(value as Record<string, boolean>)
          .map(([k, v]) => `${k}:${v}`)
          .join(',')}}`;
  const { userSession, apiKey, oauthClient, application } =
    policy.authPrincipals;

  return compact(
    `authPrincipals:{userSession:${principal(userSession)},apiKey:${principal(apiKey)},oauthClient:${principal(oauthClient)},application:${principal(application)}},requiredPermissionFlags:[${policy.requiredPermissionFlags.map(flag).join(',')}]`,
  );
};

const SRC = join(__dirname, '../../../..');
const lire = (fichier: string) => {
  const texte = readFileSync(join(SRC, fichier), 'utf8');

  expect(texte.split('\n')[0]).not.toMatch(/@license Enterprise/i);

  return compact(texte);
};

describe('politique : celle du résolveur, jamais plus large', () => {
  it.each<[string, AccessPolicy, string[]]>([
    [
      'tout principal, aucun drapeau',
      policies.VERIDIAN_MCP_ALL_PRINCIPALS_POLICY,
      [
        'engine/core-modules/search/search.resolver.ts',
        'engine/metadata-modules/connected-account/resolvers/connected-account.resolver.ts',
        'engine/metadata-modules/message-channel/resolvers/message-channel.resolver.ts',
        'engine/metadata-modules/calendar-channel/resolvers/calendar-channel.resolver.ts',
        'engine/metadata-modules/message-folder/resolvers/message-folder.resolver.ts',
        'engine/core-modules/workspace/workspace.resolver.ts',
        'engine/api/rest/core/controllers/rest-api-core.controller.ts',
      ],
    ],
    [
      'session seulement (fils de mails, agenda)',
      policies.VERIDIAN_MCP_SESSION_ONLY_POLICY,
      [
        'engine/core-modules/messaging/timeline-messaging.resolver.ts',
        'engine/core-modules/calendar/timeline-calendar-event.resolver.ts',
      ],
    ],
    [
      'synchro de canal',
      policies.VERIDIAN_MCP_CHANNEL_SYNC_POLICY,
      ['modules/connected-account/channel-sync/channel-sync.resolver.ts'],
    ],
    [
      'partage de fiche',
      policies.VERIDIAN_MCP_RECORD_SHARING_POLICY,
      ['engine/permissions/record-share/resolvers/record-sharing.resolver.ts'],
    ],
    [
      'lancer un workflow',
      policies.VERIDIAN_MCP_RUN_WORKFLOW_POLICY,
      ['engine/core-modules/workflow/resolvers/core-workflow-run.resolver.ts'],
    ],
  ])('%s', (_nom, policy, fichiers) => {
    for (const fichier of fichiers) {
      expect({
        fichier,
        trouvee: lire(fichier).includes(rendre(policy)),
      }).toEqual({ fichier, trouvee: true });
    }
  });

  it('la comparaison voit une politique plus large', () => {
    const plusLarge: AccessPolicy = {
      ...policies.VERIDIAN_MCP_CHANNEL_SYNC_POLICY,
      requiredPermissionFlags: [],
    };

    expect(
      lire(
        'modules/connected-account/channel-sync/channel-sync.resolver.ts',
      ).includes(rendre(plusLarge)),
    ).toBe(false);
  });

  it.each([
    [
      'search_records',
      tools.search,
      policies.VERIDIAN_MCP_ALL_PRINCIPALS_POLICY,
    ],
    [
      'get_my_permissions',
      tools.perms,
      policies.VERIDIAN_MCP_ALL_PRINCIPALS_POLICY,
    ],
    [
      'get_record_email_threads',
      tools.threads,
      policies.VERIDIAN_MCP_SESSION_ONLY_POLICY,
    ],
    [
      'get_record_calendar_events',
      tools.events,
      policies.VERIDIAN_MCP_SESSION_ONLY_POLICY,
    ],
    [
      'list_connected_accounts',
      tools.accounts,
      policies.VERIDIAN_MCP_ALL_PRINCIPALS_POLICY,
    ],
    [
      'get_sync_status',
      tools.sync,
      policies.VERIDIAN_MCP_ALL_PRINCIPALS_POLICY,
    ],
    [
      'find_duplicate_records',
      tools.duplicates,
      policies.VERIDIAN_MCP_ALL_PRINCIPALS_POLICY,
    ],
    [
      'get_workspace_settings',
      tools.settings,
      policies.VERIDIAN_MCP_ALL_PRINCIPALS_POLICY,
    ],
    ['list_api_keys', tools.keys, API_KEY_READ_ACCESS_POLICY],
    [
      'get_record_sharing',
      tools.sharing,
      policies.VERIDIAN_MCP_RECORD_SHARING_POLICY,
    ],
    [
      'restore_records',
      tools.restore,
      policies.VERIDIAN_MCP_ALL_PRINCIPALS_POLICY,
    ],
    [
      'retry_channel_sync',
      tools.retry,
      policies.VERIDIAN_MCP_CHANNEL_SYNC_POLICY,
    ],
    ['run_workflow', tools.run, policies.VERIDIAN_MCP_RUN_WORKFLOW_POLICY],
  ])('%s déclare la politique attendue', (nom, outil, attendue) => {
    const options = Reflect.getMetadata(DEFINE_TOOL_METADATA_KEY, outil);

    expect(options.name).toBe(nom);
    expect(options.accessPolicy).toBe(attendue);
  });

  it('list_api_keys reste sous la politique native, drapeau compris', () => {
    expect(API_KEY_READ_ACCESS_POLICY.requiredPermissionFlags).toEqual([
      PermissionFlagType.API_KEYS_AND_WEBHOOKS,
    ]);
  });
});

describe('contexte de l’appelant', () => {
  it.each([
    [
      'get_record_email_threads',
      tools.threads,
      { objectNameSingular: 'person', recordId: FICHE, page: 1, pageSize: 20 },
    ],
    [
      'get_record_calendar_events',
      tools.events,
      { objectNameSingular: 'person', recordId: FICHE, page: 1, pageSize: 20 },
    ],
    ['list_connected_accounts', tools.accounts, { limit: 50, offset: 0 }],
    ['get_sync_status', tools.sync, {}],
    ['retry_channel_sync', tools.retry, { connectedAccountId: COMPTE }],
  ])(
    '%s refuse un jeton sans espace de membre, sans appeler le service',
    async (_nom, Outil, input) => {
      const native = fakeNative([]);
      const outil = new (Outil as never as new (n: unknown) => {
        execute: (a: never) => Promise<{ success: boolean }>;
      })(native);

      await expect(
        outil.execute({ input, context: sansMembre } as never),
      ).resolves.toMatchObject({ success: false });
      expect((native as unknown as { touched: unknown[] }).touched).toEqual([]);
    },
  );

  it('fils de mails : le membre et l’espace de l’appelant sont transmis', async () => {
    const getMessagesFromObjectRecord = jest.fn().mockResolvedValue({
      totalNumberOfThreads: 0,
      timelineThreads: [],
      relatedPersonIds: [],
    });
    const outil = new tools.threads(
      fakeNative([[S.messages, { getMessagesFromObjectRecord }]]),
    );

    await outil.execute({
      input: {
        objectNameSingular: 'person',
        recordId: FICHE,
        page: 2,
        pageSize: 10,
      },
      context,
    });

    expect(getMessagesFromObjectRecord).toHaveBeenCalledWith({
      userWorkspaceId: MEMBRE,
      objectNameSingular: 'person',
      recordId: FICHE,
      workspaceId: ESPACE,
      page: 2,
      pageSize: 10,
    });
  });

  it('agenda : le membre et l’espace de l’appelant sont transmis', async () => {
    const getCalendarEventsFromObjectRecord = jest.fn().mockResolvedValue({
      totalNumberOfCalendarEvents: 0,
      timelineCalendarEvents: [],
      relatedPersonIds: [],
    });
    const outil = new tools.events(
      fakeNative([[S.calendar, { getCalendarEventsFromObjectRecord }]]),
    );

    await outil.execute({
      input: {
        objectNameSingular: 'company',
        recordId: FICHE,
        page: 1,
        pageSize: 5,
      },
      context,
    });

    expect(getCalendarEventsFromObjectRecord).toHaveBeenCalledWith({
      userWorkspaceId: MEMBRE,
      objectNameSingular: 'company',
      recordId: FICHE,
      workspaceId: ESPACE,
      page: 1,
      pageSize: 5,
    });
  });

  it('comptes connectés : la liste est celle de l’appelant', async () => {
    const findUsableByCaller = jest.fn().mockResolvedValue([]);
    const outil = new tools.accounts(
      fakeNative([[S.accounts, { findUsableByCaller }]]),
    );

    await outil.execute({ input: { limit: 50, offset: 0 }, context });

    expect(findUsableByCaller).toHaveBeenCalledWith({
      userWorkspaceId: MEMBRE,
      workspaceId: ESPACE,
    });
  });

  it('état de synchro : filtré par compte, les canaux sont ceux de l’appelant', async () => {
    const byAccount = jest.fn().mockResolvedValue([]);
    const folders = jest.fn().mockResolvedValue([]);
    const outil = new tools.sync(
      fakeNative([
        [
          S.messageChannels,
          {
            findByConnectedAccountIdForUser: byAccount,
            findByUserWorkspaceId: jest.fn(),
          },
        ],
        [
          S.calendarChannels,
          {
            findByConnectedAccountIdForUser: byAccount,
            findByUserWorkspaceId: jest.fn(),
          },
        ],
        [S.folders, { findByMessageChannelIdForUser: folders }],
      ]),
    );

    await outil.execute({ input: { connectedAccountId: COMPTE }, context });

    expect(byAccount).toHaveBeenCalledTimes(2);
    expect(byAccount).toHaveBeenCalledWith({
      connectedAccountId: COMPTE,
      userWorkspaceId: MEMBRE,
      workspaceId: ESPACE,
    });
  });

  it('mes droits : chaque drapeau est interrogé pour le contexte de l’appelant', async () => {
    const hasPermissionFlag = jest
      .fn()
      .mockImplementation(
        async ({ setting }) => setting === PermissionFlagType.WORKFLOWS,
      );
    const getRoleIds = jest.fn().mockResolvedValue(['role-1']);
    const outil = new tools.perms(
      fakeNative([[S.permissions, { hasPermissionFlag, getRoleIds }]]),
    );

    const sortie = await outil.execute({ input: {}, context });

    expect(getRoleIds).toHaveBeenCalledWith(sessionAuth);
    expect(hasPermissionFlag).toHaveBeenCalledTimes(
      Object.values(PermissionFlagType).length,
    );
    expect(hasPermissionFlag).toHaveBeenCalledWith({
      authContext: sessionAuth,
      setting: PermissionFlagType.API_KEYS_AND_WEBHOOKS,
    });
    expect(sortie.result).toMatchObject({
      roleIds: ['role-1'],
      permissionFlags: {
        [PermissionFlagType.WORKFLOWS]: true,
        [PermissionFlagType.ROLES]: false,
      },
    });
  });

  it('recherche : la barre de recherche native, dans l’espace de l’appelant', async () => {
    const filterObjectMetadataItems = jest
      .fn()
      .mockReturnValue([{ nameSingular: 'person' }]);
    const getAllRecordsWithObjectMetadataItems = jest
      .fn()
      .mockResolvedValue(['bruts']);
    const computeSearchObjectResults = jest.fn().mockResolvedValue({
      edges: lignes(150, (i) => ({
        node: { recordId: String(i) },
        cursor: String(i),
      })),
      pageInfo: { endCursor: null, hasNextPage: false },
    });
    const getOrRecomputeManyOrAllFlatEntityMaps = jest.fn().mockResolvedValue({
      flatObjectMetadataMaps: {
        byUniversalIdentifier: { a: { nameSingular: 'person' }, b: undefined },
      },
      flatFieldMetadataMaps: { fields: true },
    });
    const outil = new tools.search(
      fakeNative([
        [
          S.search,
          {
            filterObjectMetadataItems,
            getAllRecordsWithObjectMetadataItems,
            computeSearchObjectResults,
          },
        ],
        [S.maps, { getOrRecomputeManyOrAllFlatEntityMaps }],
        [S.loaders, { createLoaders: () => 'loaders' }],
      ]),
    );

    const sortie = await outil.execute({
      input: { query: 'dupont', objects: ['person'], limit: 25 },
      context: { ...(context as object), locale: 'fr-FR' } as never,
    });

    expect(getOrRecomputeManyOrAllFlatEntityMaps).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: ESPACE }),
    );
    expect(filterObjectMetadataItems).toHaveBeenCalledWith({
      flatObjectMetadatas: [{ nameSingular: 'person' }],
      includedObjectNameSingulars: ['person'],
      excludedObjectNameSingulars: [],
    });
    expect(getAllRecordsWithObjectMetadataItems).toHaveBeenCalledWith(
      expect.objectContaining({ searchInput: 'dupont', limit: 25 }),
    );
    expect(computeSearchObjectResults).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: ESPACE,
        loaders: 'loaders',
        locale: 'fr-FR',
        limit: 25,
      }),
    );
    expect((sortie.result as { edges: unknown[] }).edges).toHaveLength(25);
  });
});

const sharingNative = (recordSharing: object) =>
  fakeNative([
    [
      S.maps,
      {
        getOrRecomputeManyOrAllFlatEntityMaps: async () => ({
          flatObjectMetadataMaps: {
            byUniversalIdentifier: {
              o: {
                id: 'objet-1',
                nameSingular: 'person',
                namePlural: 'people',
              },
            },
          },
        }),
      },
    ],
    [S.recordSharing, recordSharing],
  ]);

describe('plafonds', () => {
  const schema = (Outil: unknown) =>
    new (Outil as new (n: unknown) => {
      inputSchema: { safeParse: (v: unknown) => { success: boolean } };
    })(fakeNative([])).inputSchema;

  it.each([
    [
      'search_records',
      tools.search,
      { query: 'a', limit: limits.VERIDIAN_MCP_MAX_ROWS + 1 },
    ],
    [
      'fils de mails',
      tools.threads,
      { objectNameSingular: 'person', recordId: FICHE, pageSize: 51 },
    ],
    [
      'agenda',
      tools.events,
      { objectNameSingular: 'person', recordId: FICHE, pageSize: 51 },
    ],
    ['comptes', tools.accounts, { limit: 101 }],
    [
      'doublons (ids)',
      tools.duplicates,
      {
        objectNameSingular: 'person',
        ids: Array.from({ length: 11 }, () => FICHE),
      },
    ],
    ['clés', tools.keys, { limit: 101 }],
    [
      'restauration',
      tools.restore,
      {
        objectNameSingular: 'person',
        ids: Array.from({ length: 101 }, () => FICHE),
      },
    ],
  ])('%s refuse plus que le plafond', (_nom, Outil, entree) => {
    expect(schema(Outil).safeParse(entree).success).toBe(false);
  });

  it('restauration : 100 identifiants passent', () => {
    expect(
      schema(tools.restore).safeParse({
        objectNameSingular: 'person',
        ids: Array.from({ length: 100 }, () => FICHE),
      }).success,
    ).toBe(true);
  });

  it('comptes connectés : jamais plus de 100 lignes, même si le service en rend 150', async () => {
    const outil = new tools.accounts(
      fakeNative([
        [
          S.accounts,
          {
            findUsableByCaller: async () =>
              lignes(150, (i) => ({
                id: String(i),
                handle: 'h',
                provider: 'google',
                scope: 'user',
              })),
          },
        ],
      ]),
    );

    const sortie = await outil.execute({
      input: { limit: 100, offset: 0 },
      context,
    });

    expect((sortie.result as { accounts: unknown[] }).accounts).toHaveLength(
      100,
    );
  });

  it('clés : 100 lignes au plus, le total reste dit', async () => {
    const outil = new tools.keys(
      fakeNative([
        [
          S.apiKeys,
          {
            findActiveByWorkspaceId: async () =>
              lignes(150, (i) => ({
                id: String(i),
                name: 'k',
                expiresAt: 1,
                createdAt: 1,
              })),
          },
        ],
        [
          S.apiKeyRoles,
          { getRoleDtoByApiKeyId: async () => ({ id: 'r', label: 'Admin' }) },
        ],
      ]),
    );

    const sortie = await outil.execute({
      input: { limit: 100, offset: 0 },
      context,
    });

    expect(
      (sortie.result as { apiKeys: unknown[]; total: number }).apiKeys,
    ).toHaveLength(100);
    expect((sortie.result as { total: number }).total).toBe(150);
  });

  it('synchro : 100 canaux au plus par liste', async () => {
    const canaux = lignes(150, (i) => ({
      id: String(i),
      connectedAccountId: COMPTE,
    }));
    const outil = new tools.sync(
      fakeNative([
        [S.messageChannels, { findByUserWorkspaceId: async () => canaux }],
        [S.calendarChannels, { findByUserWorkspaceId: async () => canaux }],
        [
          S.folders,
          {
            findByMessageChannelIdForUser: async () =>
              lignes(5, (i) => ({ id: `f${i}` })),
          },
        ],
      ]),
    );

    const sortie = await outil.execute({ input: {}, context });
    const r = sortie.result as {
      messageChannels: unknown[];
      calendarChannels: unknown[];
      messageFolders: unknown[];
    };

    expect(r.messageChannels).toHaveLength(100);
    expect(r.calendarChannels).toHaveLength(100);
    expect(r.messageFolders).toHaveLength(100);
  });

  it('partage : 100 lignes au plus', async () => {
    const sharing = {
      isPrivate: false,
      roles: lignes(150, (i) => ({ id: String(i) })),
      shares: lignes(150, (i) => ({ id: String(i) })),
    };
    const outil = new tools.sharing(
      sharingNative({ getSharing: async () => sharing }),
    );

    const sortie = await outil.execute({
      input: { objectNameSingular: 'person', recordId: FICHE },
      context,
    });

    expect((sortie.result as { shares: unknown[] }).shares).toHaveLength(100);
    expect((sortie.result as { roles: unknown[] }).roles).toHaveLength(100);
  });

  it('doublons : 10 groupes de 10 fiches au plus', async () => {
    const groupes = lignes(15, () => ({
      totalCount: 99,
      records: lignes(40, (i) => ({ id: String(i) })),
    }));
    const outil = new tools.duplicates(duplicatesNative({ results: groupes }));

    const sortie = await outil.execute({
      input: { objectNameSingular: 'person', ids: [FICHE] },
      context,
    });
    const r = sortie.result as { groups: { records: unknown[] }[] };

    expect(r.groups).toHaveLength(10);
    expect(r.groups[0].records).toHaveLength(10);
  });
});

describe('projections : aucun champ sensible', () => {
  it('comptes connectés : ni jeton ni paramètre de connexion', async () => {
    const outil = new tools.accounts(
      fakeNative([
        [
          S.accounts,
          {
            findUsableByCaller: async () => [
              {
                id: 'a',
                handle: 'x@y.fr',
                provider: 'google',
                scope: 'user',
                accessToken: 'JETON-ACCES',
                refreshToken: 'JETON-RENOUVEAU',
                connectionParameters: {
                  IMAP: { host: 'h', port: 1, password: 'MOT-DE-PASSE' },
                },
                oidcTokenClaims: { sub: 'SECRET-OIDC' },
              },
            ],
          },
        ],
      ]),
    );

    const texte = JSON.stringify(
      await outil.execute({ input: { limit: 50, offset: 0 }, context }),
    );

    expect(texte).toContain('x@y.fr');
    for (const secret of [
      'JETON-ACCES',
      'JETON-RENOUVEAU',
      'MOT-DE-PASSE',
      'SECRET-OIDC',
      'accessToken',
      'connectionParameters',
    ]) {
      expect(texte).not.toContain(secret);
    }
  });

  it('paramètres de l’espace : liste blanche, ni invitation ni réglage d’auth ni IA', async () => {
    const outil = new tools.settings(
      fakeNative([
        [
          S.workspace,
          {
            findOneWorkspaceById: async () => ({
              id: ESPACE,
              displayName: 'Atelier',
              subdomain: 'atelier',
              customDomain: null,
              isCustomDomainEnabled: false,
              activationStatus: 'ACTIVE',
              trashRetentionDays: 14,
              workspaceMembersCount: 3,
              createdAt: 1,
              inviteHash: 'HASH-INVITATION',
              isGoogleAuthEnabled: true,
              aiAdditionalInstructions: 'CONSIGNE-IA',
              databaseSchema: 'SCHEMA-INTERNE',
              allowedEmbeddingOrigins: ['x'],
            }),
          },
        ],
      ]),
    );

    const sortie = await outil.execute({ input: {}, context });
    const texte = JSON.stringify(sortie);

    expect(sortie.result).toMatchObject({
      displayName: 'Atelier',
      subdomain: 'atelier',
      trashRetentionDays: 14,
    });
    for (const interdit of [
      'HASH-INVITATION',
      'CONSIGNE-IA',
      'SCHEMA-INTERNE',
      'isGoogleAuthEnabled',
      'allowedEmbeddingOrigins',
    ]) {
      expect(texte).not.toContain(interdit);
    }
  });

  it('clés d’API : jamais la valeur de la clé', async () => {
    const outil = new tools.keys(
      fakeNative([
        [
          S.apiKeys,
          {
            findActiveByWorkspaceId: async () => [
              {
                id: 'k1',
                name: 'Agent',
                expiresAt: 1,
                createdAt: 1,
                revokedAt: null,
                key: 'VALEUR-DE-CLE',
                token: 'JETON-CLE',
                workspaceId: ESPACE,
              },
            ],
          },
        ],
        [
          S.apiKeyRoles,
          {
            getRoleDtoByApiKeyId: async () => ({
              id: 'r1',
              label: 'Lecture',
              permissions: 'INTERNE',
            }),
          },
        ],
      ]),
    );

    const sortie = await outil.execute({
      input: { limit: 50, offset: 0 },
      context,
    });
    const texte = JSON.stringify(sortie);

    expect(sortie.result).toMatchObject({
      apiKeys: [
        { id: 'k1', name: 'Agent', role: { id: 'r1', label: 'Lecture' } },
      ],
    });
    for (const interdit of ['VALEUR-DE-CLE', 'JETON-CLE', 'INTERNE', ESPACE]) {
      expect(texte).not.toContain(interdit);
    }
  });

  it('clés d’API : une clé sans rôle reste listée', async () => {
    const outil = new tools.keys(
      fakeNative([
        [
          S.apiKeys,
          {
            findActiveByWorkspaceId: async () => [
              { id: 'k1', name: 'Agent', expiresAt: 1, createdAt: 1 },
            ],
          },
        ],
        [
          S.apiKeyRoles,
          {
            getRoleDtoByApiKeyId: async () => {
              throw new Error('no role');
            },
          },
        ],
      ]),
    );

    await expect(
      outil.execute({ input: { limit: 50, offset: 0 }, context }),
    ).resolves.toMatchObject({
      result: { apiKeys: [{ id: 'k1', role: null }] },
    });
  });

  it('synchro : ni curseur, ni identifiant d’espace', async () => {
    const outil = new tools.sync(
      fakeNative([
        [
          S.messageChannels,
          {
            findByUserWorkspaceId: async () => [
              {
                id: 'c1',
                connectedAccountId: COMPTE,
                handle: 'x@y.fr',
                syncStatus: 'ONGOING',
                syncCursor: 'CURSEUR-MAIL',
                workspaceId: ESPACE,
              },
            ],
          },
        ],
        [
          S.calendarChannels,
          {
            findByUserWorkspaceId: async () => [
              {
                id: 'c2',
                connectedAccountId: COMPTE,
                syncCursor: 'CURSEUR-AGENDA',
              },
            ],
          },
        ],
        [
          S.folders,
          {
            findByMessageChannelIdForUser: async () => [
              {
                id: 'f1',
                messageChannelId: 'c1',
                name: 'INBOX',
                syncCursor: 'CURSEUR-DOSSIER',
                externalId: 'EXT',
              },
            ],
          },
        ],
      ]),
    );

    const texte = JSON.stringify(await outil.execute({ input: {}, context }));

    expect(texte).toContain('ONGOING');
    for (const interdit of [
      'CURSEUR-MAIL',
      'CURSEUR-AGENDA',
      'CURSEUR-DOSSIER',
      'EXT',
      ESPACE,
    ]) {
      expect(texte).not.toContain(interdit);
    }
  });
});

const duplicatesNative = ({
  results = [] as unknown[],
  canRead = true,
  execute = jest.fn(),
} = {}) => {
  execute.mockResolvedValue({ results });
  const build = jest.fn().mockResolvedValue({
    queryRunnerContext: { ctx: true },
    selectedFields: { id: true },
    flatObjectMetadata: { id: 'objet-1', nameSingular: 'person' },
  });

  return Object.assign(
    fakeNative([
      [S.builder, { build }],
      [
        S.permissions,
        {
          buildPermissionsPrincipalsOrThrow: async () => 'principaux',
          canReadSomeRecords: async () => canRead,
        },
      ],
      [S.duplicates, { execute }],
    ]),
    { execute, build },
  );
};

describe('find_duplicate_records', () => {
  it('ids ou data, pas les deux ni aucun', async () => {
    const native = duplicatesNative();
    const outil = new tools.duplicates(native);

    await expect(
      outil.execute({ input: { objectNameSingular: 'person' }, context }),
    ).resolves.toMatchObject({ success: false });
    await expect(
      outil.execute({
        input: { objectNameSingular: 'person', ids: [FICHE], data: [{}] },
        context,
      }),
    ).resolves.toMatchObject({ success: false });
    expect(native.execute).not.toHaveBeenCalled();
  });

  it('construit le contexte avec l’authentification de l’appelant et passe par la file commune', async () => {
    const native = duplicatesNative();
    const outil = new tools.duplicates(native);

    await outil.execute({
      input: { objectNameSingular: 'person', ids: [FICHE] },
      context,
    });

    expect(native.build).toHaveBeenCalledWith({
      authContext: sessionAuth,
      objectName: 'person',
    });
    expect(native.execute).toHaveBeenCalledWith(
      { ids: [FICHE], data: undefined, selectedFields: { id: true } },
      { ctx: true },
    );
  });

  it('refuse sans droit de lecture de l’objet, la file n’est pas appelée', async () => {
    const native = duplicatesNative({ canRead: false });
    const outil = new tools.duplicates(native);

    await expect(
      outil.execute({
        input: { objectNameSingular: 'person', ids: [FICHE] },
        context,
      }),
    ).resolves.toMatchObject({ success: false });
    expect(native.execute).not.toHaveBeenCalled();
  });
});

const restoreNative = ({
  canSoftDelete = true,
  nameSingular = 'person',
} = {}) => {
  const execute = jest
    .fn()
    .mockResolvedValue({ results: [{ id: FICHE, secret: 'NE-SORT-PAS' }] });
  const build = jest.fn().mockResolvedValue({
    queryRunnerContext: { ctx: true },
    selectedFields: { id: true },
    flatObjectMetadata: { id: 'objet-1', nameSingular },
  });

  return Object.assign(
    fakeNative([
      [S.builder, { build }],
      [
        S.permissions,
        {
          buildPermissionsPrincipalsOrThrow: async () => 'principaux',
          canSoftDeleteSomeRecords: async () => canSoftDelete,
        },
      ],
      [S.restore, { execute }],
    ]),
    { execute, build },
  );
};

describe('restore_records', () => {
  it('restaure par la file commune, sous l’authentification de l’appelant, et ne rend que les ids', async () => {
    const native = restoreNative();
    const outil = new tools.restore(native);

    const sortie = await outil.execute({
      input: { objectNameSingular: 'person', ids: [FICHE] },
      context,
    });

    expect(native.build).toHaveBeenCalledWith({
      authContext: sessionAuth,
      objectName: 'person',
    });
    expect(native.execute).toHaveBeenCalledWith(
      { filter: { id: { in: [FICHE] } }, selectedFields: { id: true } },
      { ctx: true },
    );
    expect(sortie.result).toEqual([{ id: FICHE }]);
  });

  it('refuse sans droit de suppression, la file n’est pas appelée', async () => {
    const native = restoreNative({ canSoftDelete: false });

    await expect(
      new tools.restore(native).execute({
        input: { objectNameSingular: 'person', ids: [FICHE] },
        context,
      }),
    ).resolves.toMatchObject({ success: false });
    expect(native.execute).not.toHaveBeenCalled();
  });

  it.each(['workspaceMember', 'workflow', 'dashboard'])(
    'refuse l’objet %s, comme la suppression automatique',
    async (nameSingular) => {
      const native = restoreNative({ nameSingular });

      await expect(
        new tools.restore(native).execute({
          input: { objectNameSingular: nameSingular, ids: [FICHE] },
          context,
        }),
      ).resolves.toMatchObject({ success: false });
      expect(native.execute).not.toHaveBeenCalled();
    },
  );

  it('une erreur de la file est rendue, pas avalée', async () => {
    const native = restoreNative();

    native.execute.mockRejectedValue(new Error('Permission denied'));
    await expect(
      new tools.restore(native).execute({
        input: { objectNameSingular: 'person', ids: [FICHE] },
        context,
      }),
    ).resolves.toMatchObject({ success: false, error: 'Permission denied' });
  });
});

describe('retry_channel_sync', () => {
  class Horloge extends tools.retry {
    static maintenant = 1_000_000;

    protected now(): number {
      return Horloge.maintenant;
    }
  }
  const monter = () => {
    const verifyUsableByCaller = jest.fn().mockResolvedValue({});
    const startChannelSync = jest.fn().mockResolvedValue(undefined);
    const outil = new Horloge(
      fakeNative([
        [S.accounts, { verifyUsableByCaller }],
        [S.channelSync, { startChannelSync }],
      ]),
    );

    return { outil, verifyUsableByCaller, startChannelSync };
  };
  const input = { connectedAccountId: COMPTE };

  beforeEach(() => {
    Horloge.maintenant = 1_000_000;
  });

  it('vérifie que le compte est utilisable par l’appelant, puis relance', async () => {
    const m = monter();

    await expect(m.outil.execute({ input, context })).resolves.toMatchObject({
      success: true,
    });
    expect(m.verifyUsableByCaller).toHaveBeenCalledWith({
      id: COMPTE,
      userWorkspaceId: MEMBRE,
      workspaceId: ESPACE,
    });
    expect(m.startChannelSync).toHaveBeenCalledWith({
      connectedAccountId: COMPTE,
      workspaceId: ESPACE,
    });
  });

  it('un compte d’un autre membre n’est jamais relancé', async () => {
    const m = monter();

    m.verifyUsableByCaller.mockRejectedValue(new Error('not usable'));
    await expect(m.outil.execute({ input, context })).resolves.toMatchObject({
      success: false,
    });
    expect(m.startChannelSync).not.toHaveBeenCalled();
  });

  it('un appel par compte et par minute', async () => {
    const m = monter();

    await m.outil.execute({ input, context });
    Horloge.maintenant += limits.VERIDIAN_MCP_RETRY_SYNC_INTERVAL_MS - 1;
    await expect(m.outil.execute({ input, context })).resolves.toMatchObject({
      success: false,
    });
    expect(m.startChannelSync).toHaveBeenCalledTimes(1);

    Horloge.maintenant += 1;
    await expect(m.outil.execute({ input, context })).resolves.toMatchObject({
      success: true,
    });
    expect(m.startChannelSync).toHaveBeenCalledTimes(2);
  });

  it('un autre compte n’est pas gêné', async () => {
    const m = monter();

    await m.outil.execute({ input, context });
    await expect(
      m.outil.execute({
        input: { connectedAccountId: '11111111-1111-4111-8111-111111111111' },
        context,
      }),
    ).resolves.toMatchObject({ success: true });
  });

  it('un échec de la relance libère le compte', async () => {
    const m = monter();

    m.startChannelSync.mockRejectedValueOnce(new Error('down'));
    await expect(m.outil.execute({ input, context })).resolves.toMatchObject({
      success: false,
    });
    await expect(m.outil.execute({ input, context })).resolves.toMatchObject({
      success: true,
    });
  });
});

describe('run_workflow', () => {
  const monter = (status = 'ACTIVE') => {
    const findCoreVersionById = jest
      .fn()
      .mockResolvedValue(status === 'ABSENTE' ? null : { id: VERSION, status });
    const assertCoreWorkflowVersionsAreAccessibleOrThrow = jest
      .fn()
      .mockResolvedValue(undefined);
    const assertCoreWorkflowVersionsAreStartableByApplicationOrThrow = jest
      .fn()
      .mockResolvedValue(undefined);
    const run = jest.fn().mockResolvedValue({ workflowRunId: 'run-1' });
    const outil = new tools.run(
      fakeNative([
        [S.versions, { findCoreVersionById }],
        [
          S.access,
          {
            assertCoreWorkflowVersionsAreAccessibleOrThrow,
            assertCoreWorkflowVersionsAreStartableByApplicationOrThrow,
          },
        ],
        [S.runner, { run }],
      ]),
    );

    return {
      outil,
      findCoreVersionById,
      assertCoreWorkflowVersionsAreAccessibleOrThrow,
      assertCoreWorkflowVersionsAreStartableByApplicationOrThrow,
      run,
    };
  };
  const input = { workflowVersionId: VERSION, payload: { a: 1 } };

  it('lance la version active avec le membre, l’espace et l’application de l’appelant', async () => {
    const m = monter();

    const sortie = await m.outil.execute({
      input,
      context: {
        ...(context as object),
        authContext: { ...sessionAuth, application: { id: 'app-1' } },
      } as never,
    });

    expect(sortie).toMatchObject({
      success: true,
      result: { workflowRunId: 'run-1' },
    });
    expect(
      m.assertCoreWorkflowVersionsAreAccessibleOrThrow,
    ).toHaveBeenCalledWith({
      workspaceId: ESPACE,
      userWorkspaceId: MEMBRE,
      coreWorkflowVersionIds: [VERSION],
    });
    expect(
      m.assertCoreWorkflowVersionsAreStartableByApplicationOrThrow,
    ).toHaveBeenCalledWith({
      workspaceId: ESPACE,
      workspaceCustomApplicationId: 'app-custom',
      callerApplication: { id: 'app-1' },
      coreWorkflowVersionIds: [VERSION],
    });
    expect(m.run).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: ESPACE,
        coreWorkflowVersionId: VERSION,
        payload: expect.objectContaining({ a: 1 }),
        source: expect.objectContaining({ workspaceMemberId: 'wm1' }),
      }),
    );
  });

  it.each(['DRAFT', 'DEACTIVATED', 'ARCHIVED', 'ABSENTE'])(
    'refuse une version %s, rien ne tourne',
    async (status) => {
      const m = monter(status);

      await expect(m.outil.execute({ input, context })).resolves.toMatchObject({
        success: false,
      });
      expect(m.run).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['clé d’API', { type: 'apiKey' }],
    ['application sans membre', { type: 'application' }],
  ])('refuse %s : il faut un membre', async (_nom, authContext) => {
    const m = monter();

    await expect(
      m.outil.execute({
        input,
        context: { workspaceId: ESPACE, authContext } as never,
      }),
    ).resolves.toMatchObject({ success: false });
    expect(m.findCoreVersionById).not.toHaveBeenCalled();
    expect(m.run).not.toHaveBeenCalled();
  });

  it('un workflow privé d’un autre membre n’est pas lancé', async () => {
    const m = monter();

    m.assertCoreWorkflowVersionsAreAccessibleOrThrow.mockRejectedValue(
      new Error('Workflow not found'),
    );
    await expect(m.outil.execute({ input, context })).resolves.toMatchObject({
      success: false,
      error: 'Workflow not found',
    });
    expect(m.run).not.toHaveBeenCalled();
  });

  it('un workflow d’une autre application n’est pas lancé', async () => {
    const m = monter();

    m.assertCoreWorkflowVersionsAreStartableByApplicationOrThrow.mockRejectedValue(
      new Error('owned by another application'),
    );
    await expect(m.outil.execute({ input, context })).resolves.toMatchObject({
      success: false,
    });
    expect(m.run).not.toHaveBeenCalled();
  });

  it('une charge utile démesurée est refusée', async () => {
    const m = monter();

    await expect(
      m.outil.execute({
        input: {
          workflowVersionId: VERSION,
          payload: {
            gros: 'x'.repeat(limits.VERIDIAN_MCP_MAX_PAYLOAD_CHARACTERS),
          },
        },
        context,
      }),
    ).resolves.toMatchObject({ success: false });
    expect(m.run).not.toHaveBeenCalled();
  });
});

describe('get_record_sharing', () => {
  it.each([
    ['clé d’API', { type: 'apiKey' }],
    ['application', { type: 'application' }],
  ])('refuse %s : il faut un membre', async (_nom, authContext) => {
    const getSharing = jest.fn();
    const outil = new tools.sharing(sharingNative({ getSharing }));

    await expect(
      outil.execute({
        input: { objectNameSingular: 'person', recordId: FICHE },
        context: { workspaceId: ESPACE, authContext } as never,
      }),
    ).resolves.toMatchObject({ success: false });
    expect(getSharing).not.toHaveBeenCalled();
  });

  it('passe l’objet et le contexte du membre au service', async () => {
    const getSharing = jest
      .fn()
      .mockResolvedValue({ isPrivate: true, roles: [], shares: [] });
    const outil = new tools.sharing(sharingNative({ getSharing }));

    await expect(
      outil.execute({
        input: { objectNameSingular: 'person', recordId: FICHE },
        context,
      }),
    ).resolves.toMatchObject({ success: true });
    expect(getSharing).toHaveBeenCalledWith({
      objectMetadataId: 'objet-1',
      recordId: FICHE,
      authContext: sessionAuth,
    });
  });

  it('rend le refus du service tel quel, sans fiche', async () => {
    const getSharing = jest
      .fn()
      .mockRejectedValue(new Error('Record not found'));
    const outil = new tools.sharing(sharingNative({ getSharing }));

    await expect(
      outil.execute({
        input: { objectNameSingular: 'person', recordId: FICHE },
        context,
      }),
    ).resolves.toMatchObject({ success: false, error: 'Record not found' });
  });

  it('objet inconnu : le service n’est pas appelé', async () => {
    const getSharing = jest.fn();
    const outil = new tools.sharing(sharingNative({ getSharing }));

    await expect(
      outil.execute({
        input: { objectNameSingular: 'inconnu', recordId: FICHE },
        context,
      }),
    ).resolves.toMatchObject({ success: false });
    expect(getSharing).not.toHaveBeenCalled();
  });
});

describe('annotations', () => {
  const statique = (toolId: string) =>
    getMcpRegistryToolAnnotations({ kind: 'static', toolId });

  it.each([...annotations.VERIDIAN_MCP_READ_ONLY_TOOL_NAMES])(
    '%s est en lecture seule',
    (nom) => {
      expect(statique(nom)).toEqual(
        MCP_CLOSED_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
      );
      expect(statique(nom).readOnlyHint).toBe(true);
    },
  );

  it('run_workflow est destructeur', () => {
    expect(statique('run_workflow')).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it.each([
    'install_app',
    'restore_records',
    'retry_channel_sync',
    'update_view_fields',
    'create_webhook',
  ])('%s garde la valeur amont', (nom) => {
    expect(statique(nom)).toEqual(MCP_EXECUTE_TOOL_ANNOTATIONS);
  });

  it('les outils d’écriture ne sont jamais déclarés en lecture seule', () => {
    for (const nom of [
      'restore_records',
      'retry_channel_sync',
      'run_workflow',
      'install_app',
    ]) {
      expect(annotations.VERIDIAN_MCP_READ_ONLY_TOOL_NAMES.has(nom)).toBe(
        false,
      );
    }
  });

  it('chaque outil de lecture livré est déclaré en lecture seule, chaque outil d’écriture non', () => {
    const lecture = [
      tools.search,
      tools.perms,
      tools.threads,
      tools.events,
      tools.accounts,
      tools.sync,
      tools.duplicates,
      tools.settings,
      tools.keys,
      tools.sharing,
    ];
    const ecriture = [tools.restore, tools.retry, tools.run];

    for (const outil of lecture) {
      expect(
        annotations.VERIDIAN_MCP_READ_ONLY_TOOL_NAMES.has(
          Reflect.getMetadata(DEFINE_TOOL_METADATA_KEY, outil).name,
        ),
      ).toBe(true);
    }

    for (const outil of ecriture) {
      expect(
        annotations.VERIDIAN_MCP_READ_ONLY_TOOL_NAMES.has(
          Reflect.getMetadata(DEFINE_TOOL_METADATA_KEY, outil).name,
        ),
      ).toBe(false);
    }
  });
});

describe('outils natifs en lecture seule', () => {
  const { readdirSync, statSync } = require('fs') as typeof import('fs');
  const fichiers = (dossier: string): string[] =>
    readdirSync(dossier).flatMap((nom: string) => {
      const chemin = join(dossier, nom);

      return statSync(chemin).isDirectory()
        ? nom === '__tests__' || nom === 'node_modules'
          ? []
          : fichiers(chemin)
        : nom.endsWith('.tool.ts')
          ? [chemin]
          : [];
    });
  const declares = new Set<string>();

  for (const chemin of fichiers(SRC)) {
    const texte = readFileSync(chemin, 'utf8');

    if (/@license Enterprise/i.test(texte.split('\n')[0])) {
      continue;
    }

    for (const m of texte.matchAll(/^\s*name: '([a-z_]+)'/gm)) {
      declares.add(m[1]);
    }
  }

  it.each(annotations.VERIDIAN_MCP_NATIVE_READ_ONLY_TOOL_NAMES.map((n) => [n]))(
    '%s existe encore au registre',
    (nom) => {
      expect(declares.has(nom)).toBe(true);
    },
  );

  it('aucun nom d’écriture dans la liste, ni outil Enterprise', () => {
    for (const nom of annotations.VERIDIAN_MCP_READ_ONLY_TOOL_NAMES) {
      expect(nom).not.toMatch(
        /^(create|update|delete|upsert|assign|send|install|run|share)/,
      );
    }

    for (const interdit of [
      'list_webhooks',
      'get_logic_function_source',
      'get_validation_rules',
      'validate_validation_rule_expression',
    ]) {
      expect(annotations.VERIDIAN_MCP_READ_ONLY_TOOL_NAMES.has(interdit)).toBe(
        false,
      );
    }
  });

  it.each(annotations.VERIDIAN_MCP_NATIVE_READ_ONLY_TOOL_NAMES.map((n) => [n]))(
    '%s sort en lecture seule',
    (nom) => {
      expect(
        getMcpRegistryToolAnnotations({ kind: 'static', toolId: nom })
          .readOnlyHint,
      ).toBe(true);
    },
  );
});

describe('périmètre', () => {
  it('treize outils, aucun générique, webhook, clé en création, rôle, code ni identité', () => {
    const noms = Object.values(tools).map(
      (outil) =>
        Reflect.getMetadata(DEFINE_TOOL_METADATA_KEY, outil).name as string,
    );

    expect(new Set(noms).size).toBe(13);
    expect(noms.sort()).toEqual([
      'find_duplicate_records',
      'get_my_permissions',
      'get_record_calendar_events',
      'get_record_email_threads',
      'get_record_sharing',
      'get_sync_status',
      'get_workspace_settings',
      'list_api_keys',
      'list_connected_accounts',
      'restore_records',
      'retry_channel_sync',
      'run_workflow',
      'search_records',
    ]);

    for (const nom of noms) {
      expect(nom).not.toMatch(
        /graphql|webhook|create_api_key|role|logic_function|source|identity|impersonat/,
      );
    }
  });
});
