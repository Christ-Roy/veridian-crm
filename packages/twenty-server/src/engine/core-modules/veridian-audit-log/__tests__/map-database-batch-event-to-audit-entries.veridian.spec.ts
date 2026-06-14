/*
 * Veridian CRM — Append-only audit log, clean-room module (AGPLv3).
 * Copyright (c) 2026-present Veridian.
 *
 * Pure mapping tests: a native AGPL database batch event maps to append-only
 * audit entries (one per affected record), carrying actor + diff. No EE code.
 */

import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';

import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { VeridianAuditLogActorTypeEnum } from 'src/engine/core-modules/veridian-audit-log/constants/veridian-audit-log.constants';
import { mapDatabaseBatchEventToAuditEntries } from 'src/engine/core-modules/veridian-audit-log/utils/map-database-batch-event-to-audit-entries.util';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';

const makeBatch = (
  events: Partial<ObjectRecordUpdateEvent>[],
  nameSingular = 'company',
): WorkspaceEventBatch<ObjectRecordUpdateEvent> =>
  ({
    name: `${nameSingular}.updated`,
    workspaceId: 'ws-1',
    objectMetadata: { id: 'om-1', nameSingular } as never,
    events: events as ObjectRecordUpdateEvent[],
  }) as WorkspaceEventBatch<ObjectRecordUpdateEvent>;

describe('mapDatabaseBatchEventToAuditEntries (Veridian clean-room audit log)', () => {
  it('produces one append-only entry per affected record', () => {
    const batch = makeBatch([
      { recordId: 'rec-1', userId: 'user-1', properties: {} as never },
      { recordId: 'rec-2', userId: 'user-1', properties: {} as never },
    ]);

    const entries = mapDatabaseBatchEventToAuditEntries(
      batch,
      DatabaseEventAction.UPDATED,
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      workspaceId: 'ws-1',
      action: 'record.updated',
      targetType: 'company',
      targetId: 'rec-1',
      actorUserId: 'user-1',
      actorType: VeridianAuditLogActorTypeEnum.USER,
    });
    expect(entries[1].targetId).toBe('rec-2');
  });

  it('carries the per-field diff verbatim on an update', () => {
    const batch = makeBatch([
      {
        recordId: 'rec-1',
        userId: 'user-1',
        workspaceMemberId: 'wm-1',
        properties: {
          updatedFields: ['name'],
          before: { name: 'Acme' },
          after: { name: 'Acme Corp' },
          diff: { name: { before: 'Acme', after: 'Acme Corp' } },
        } as never,
      },
    ]);

    const [entry] = mapDatabaseBatchEventToAuditEntries(
      batch,
      DatabaseEventAction.UPDATED,
    );

    expect(entry.diff).toEqual({
      name: { before: 'Acme', after: 'Acme Corp' },
    });
    expect(entry.actorWorkspaceMemberId).toBe('wm-1');
  });

  it('omits an empty diff (stores null instead of {})', () => {
    const batch = makeBatch([
      { recordId: 'rec-1', userId: 'user-1', properties: { diff: {} } as never },
    ]);

    const [entry] = mapDatabaseBatchEventToAuditEntries(
      batch,
      DatabaseEventAction.UPDATED,
    );

    expect(entry.diff).toBeNull();
  });

  it('classifies an actor-less event as SYSTEM', () => {
    const batch = makeBatch([{ recordId: 'rec-1', properties: {} as never }]);

    const [entry] = mapDatabaseBatchEventToAuditEntries(
      batch,
      DatabaseEventAction.CREATED,
    );

    expect(entry.actorType).toBe(VeridianAuditLogActorTypeEnum.SYSTEM);
    expect(entry.actorUserId).toBeNull();
  });

  it('reflects the action in the stored action name', () => {
    const batch = makeBatch([{ recordId: 'r', properties: {} as never }]);

    expect(
      mapDatabaseBatchEventToAuditEntries(batch, DatabaseEventAction.DELETED)[0]
        .action,
    ).toBe('record.deleted');
  });
});
