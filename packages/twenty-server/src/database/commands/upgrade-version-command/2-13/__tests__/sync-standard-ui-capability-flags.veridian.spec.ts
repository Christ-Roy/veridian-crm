/*
 * Veridian CRM — patch-survival (AGPLv3, cf VERIDIAN-PATCHES.md).
 *
 * Locks the Veridian fix for the cross-version `isUIReadOnly` deadlock in
 * SyncStandardUiCapabilityFlagsCommand. A workspace whose upgrade cursor is
 * parked on this command has NOT yet hidden the removed `isUIReadOnly` column
 * via @WasRemovedInUpgrade. If this command reads the existing UI flags through
 * the ORM / flat-metadata cache (workspaceCacheService.getOrRecompute on
 * flatObjectMetadataMaps / flatFieldMetadataMaps), the generated SELECT
 * references `isUIReadOnly` — already dropped by the rename instance command —
 * and every data query (GraphQL + REST) that recomputes that cache crashes.
 *
 * The patch reads the drift with RAW SQL (coreDataSource.query) and flushes
 * (not recomputes) the cache afterwards. This test fails if a future upstream
 * sync silently restores the ORM read path or the recompute call.
 */

import { type DataSource } from 'typeorm';

import { SyncStandardUiCapabilityFlagsCommand } from 'src/database/commands/upgrade-version-command/2-13/2-13-workspace-command-1781277460000-sync-standard-ui-capability-flags.command';

jest.mock(
  'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant',
  () => ({
    computeTwentyStandardApplicationAllFlatEntityMaps: () => ({
      allFlatEntityMaps: {
        flatObjectMetadataMaps: {
          byUniversalIdentifier: {
            'obj-uid-1': {
              id: 'obj-1',
              universalIdentifier: 'obj-uid-1',
              isUICreatable: false,
              isUIEditable: false,
            },
          },
        },
        flatFieldMetadataMaps: {
          byUniversalIdentifier: {
            'field-uid-1': {
              id: 'field-1',
              universalIdentifier: 'field-uid-1',
              isUIEditable: false,
            },
          },
        },
      },
    }),
  }),
);

describe('SyncStandardUiCapabilityFlagsCommand — Veridian cross-version fix', () => {
  const workspaceId = 'ws-cross-version';

  const buildCommand = () => {
    const flatObjectQueryResult = [
      {
        id: 'obj-1',
        universalIdentifier: 'obj-uid-1',
        // drifted: standard wants false/false, existing is true/true → update
        isUICreatable: true,
        isUIEditable: true,
      },
    ];
    const flatFieldQueryResult = [
      {
        id: 'field-1',
        universalIdentifier: 'field-uid-1',
        isUIEditable: true,
      },
    ];

    const query = jest
      .fn()
      // 1st call: raw read of objectMetadata UI flags
      .mockResolvedValueOnce(flatObjectQueryResult)
      // 2nd call: raw read of fieldMetadata UI flags
      .mockResolvedValueOnce(flatFieldQueryResult)
      // subsequent calls: the UPDATE statements inside the transaction
      .mockResolvedValue(undefined);

    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };

    const coreDataSource = {
      query,
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as unknown as DataSource;

    const applicationService = {
      findWorkspaceTwentyStandardAndCustomApplicationOrThrow: jest
        .fn()
        .mockResolvedValue({
          twentyStandardFlatApplication: { id: 'std-app-1' },
        }),
    };

    const workspaceCacheService = {
      getOrRecompute: jest.fn().mockResolvedValue({}),
      invalidateAndRecompute: jest.fn().mockResolvedValue(undefined),
      flush: jest.fn().mockResolvedValue(undefined),
    };

    const command = new SyncStandardUiCapabilityFlagsCommand(
      { iterate: jest.fn() } as never,
      applicationService as never,
      workspaceCacheService as never,
      coreDataSource,
    );

    return { command, coreDataSource, workspaceCacheService, queryRunner };
  };

  it('reads the existing UI flags with raw SQL, never via the flat-metadata ORM cache', async () => {
    const { command, coreDataSource, workspaceCacheService } = buildCommand();

    await command.runOnWorkspace({
      workspaceId,
      options: {},
      index: 0,
      total: 1,
    } as never);

    // Raw reads happened (objectMetadata + fieldMetadata), targeting the
    // already-migrated columns and NOT isUIReadOnly.
    const readCalls = (coreDataSource.query as jest.Mock).mock.calls;
    const readSql = readCalls.map((c) => String(c[0])).join('\n');

    expect(readSql).toMatch(/core"\."objectMetadata"/);
    expect(readSql).toMatch(/core"\."fieldMetadata"/);
    expect(readSql).not.toMatch(/isUIReadOnly/);

    // The flat metadata maps must NOT be read through the cache/ORM (that path
    // SELECTs isUIReadOnly and deadlocks the cross-version upgrade).
    const recomputeKeys = (
      workspaceCacheService.getOrRecompute as jest.Mock
    ).mock.calls.flatMap((c) => (Array.isArray(c[1]) ? c[1] : []));

    expect(recomputeKeys).not.toContain('flatObjectMetadataMaps');
    expect(recomputeKeys).not.toContain('flatFieldMetadataMaps');
  });

  it('flushes the cache (no recompute) so it does not re-trigger the phantom SELECT', async () => {
    const { command, workspaceCacheService } = buildCommand();

    await command.runOnWorkspace({
      workspaceId,
      options: {},
      index: 0,
      total: 1,
    } as never);

    expect(workspaceCacheService.flush).toHaveBeenCalledWith(workspaceId, [
      'flatObjectMetadataMaps',
      'flatFieldMetadataMaps',
    ]);
    expect(
      workspaceCacheService.invalidateAndRecompute,
    ).not.toHaveBeenCalled();
  });
});
