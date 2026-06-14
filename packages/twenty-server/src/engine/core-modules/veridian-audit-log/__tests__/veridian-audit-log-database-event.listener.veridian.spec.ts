/*
 * Veridian CRM — Append-only audit log, clean-room module (AGPLv3).
 * Copyright (c) 2026-present Veridian.
 *
 * Listener + job tests: a native AGPL database event enqueues audit entries
 * (non-blocking), and the worker job persists them. No EE code.
 */

import { type ObjectRecordCreateEvent } from 'twenty-shared/database-events';

import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { VERIDIAN_AUDIT_LOG_WRITER_JOB } from 'src/engine/core-modules/veridian-audit-log/constants/veridian-audit-log.constants';
import { VeridianAuditLogDatabaseEventListener } from 'src/engine/core-modules/veridian-audit-log/listeners/veridian-audit-log-database-event.listener';
import { VeridianAuditLogWriterJob } from 'src/engine/core-modules/veridian-audit-log/jobs/veridian-audit-log-writer.job';
import { type VeridianAuditLogService } from 'src/engine/core-modules/veridian-audit-log/services/veridian-audit-log.service';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';

const makeCreateBatch = (): WorkspaceEventBatch<ObjectRecordCreateEvent> =>
  ({
    name: 'person.created',
    workspaceId: 'ws-1',
    objectMetadata: { id: 'om-1', nameSingular: 'person' } as never,
    events: [
      { recordId: 'rec-1', userId: 'user-1', properties: {} },
    ] as ObjectRecordCreateEvent[],
  }) as WorkspaceEventBatch<ObjectRecordCreateEvent>;

describe('VeridianAuditLogDatabaseEventListener (Veridian clean-room audit log)', () => {
  let listener: VeridianAuditLogDatabaseEventListener;
  let queue: jest.Mocked<MessageQueueService>;

  beforeEach(() => {
    queue = {
      add: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MessageQueueService>;

    listener = new VeridianAuditLogDatabaseEventListener(queue);
  });

  it('enqueues a writer job when a record is created (event → audit, non-blocking)', async () => {
    await listener.handleCreate(makeCreateBatch());

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [jobName, payload] = queue.add.mock.calls[0];
    expect(jobName).toBe(VERIDIAN_AUDIT_LOG_WRITER_JOB);
    expect(payload).toMatchObject({
      entries: [
        {
          action: 'record.created',
          targetType: 'person',
          targetId: 'rec-1',
          actorUserId: 'user-1',
        },
      ],
    });
  });

  it('never throws if the queue fails — auditing must not break the mutation', async () => {
    queue.add.mockRejectedValueOnce(new Error('redis down'));

    await expect(listener.handleCreate(makeCreateBatch())).resolves.toBeUndefined();
  });

  it('does not enqueue an empty batch', async () => {
    const empty = {
      name: 'person.created',
      workspaceId: 'ws-1',
      objectMetadata: { id: 'om-1', nameSingular: 'person' } as never,
      events: [],
    } as unknown as WorkspaceEventBatch<ObjectRecordCreateEvent>;

    await listener.handleCreate(empty);

    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('VeridianAuditLogWriterJob (Veridian clean-room audit log)', () => {
  it('delegates the append-only insert to the service', async () => {
    const auditLogService = {
      insertEntries: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VeridianAuditLogService>;

    const job = new VeridianAuditLogWriterJob(auditLogService);
    const entries = [
      {
        workspaceId: 'ws-1',
        action: 'record.created',
        actorType: 'user' as const,
      },
    ];

    await job.handle({ entries });

    expect(auditLogService.insertEntries).toHaveBeenCalledWith(entries);
  });
});
