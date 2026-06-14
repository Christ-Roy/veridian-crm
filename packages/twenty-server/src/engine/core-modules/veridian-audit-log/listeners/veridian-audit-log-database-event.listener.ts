import { Injectable, Logger } from '@nestjs/common';

import {
  type ObjectRecordCreateEvent,
  type ObjectRecordDeleteEvent,
  type ObjectRecordDestroyEvent,
  type ObjectRecordEvent,
  type ObjectRecordRestoreEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { VERIDIAN_AUDIT_LOG_WRITER_JOB } from 'src/engine/core-modules/veridian-audit-log/constants/veridian-audit-log.constants';
import { type VeridianAuditLogBatch } from 'src/engine/core-modules/veridian-audit-log/types/veridian-audit-log-entry.type';
import { mapDatabaseBatchEventToAuditEntries } from 'src/engine/core-modules/veridian-audit-log/utils/map-database-batch-event-to-audit-entries.util';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';

/**
 * Veridian append-only audit log — database event capture (AGPL, clean-room).
 *
 * Subscribes to the native AGPL workspace event bus (`@OnDatabaseBatchEvent`,
 * the exact same public hook the AGPL webhook queue uses). For every record
 * CRUD batch it produces append-only audit entries and pushes them onto the
 * dedicated queue. The actual DB insert happens in the worker job so the
 * audit write NEVER blocks or slows down the originating mutation.
 *
 * Fail-safe: any error here is swallowed (logged as a warning) — auditing must
 * never make a business operation fail.
 */
@Injectable()
export class VeridianAuditLogDatabaseEventListener {
  private readonly logger = new Logger(
    VeridianAuditLogDatabaseEventListener.name,
  );

  constructor(
    @InjectMessageQueue(MessageQueue.veridianAuditLogQueue)
    private readonly auditLogQueueService: MessageQueueService,
  ) {}

  @OnDatabaseBatchEvent('*', DatabaseEventAction.CREATED)
  async handleCreate(batchEvent: WorkspaceEventBatch<ObjectRecordCreateEvent>) {
    await this.enqueue(batchEvent, DatabaseEventAction.CREATED);
  }

  @OnDatabaseBatchEvent('*', DatabaseEventAction.UPDATED)
  async handleUpdate(batchEvent: WorkspaceEventBatch<ObjectRecordUpdateEvent>) {
    await this.enqueue(batchEvent, DatabaseEventAction.UPDATED);
  }

  @OnDatabaseBatchEvent('*', DatabaseEventAction.DELETED)
  async handleDelete(batchEvent: WorkspaceEventBatch<ObjectRecordDeleteEvent>) {
    await this.enqueue(batchEvent, DatabaseEventAction.DELETED);
  }

  @OnDatabaseBatchEvent('*', DatabaseEventAction.RESTORED)
  async handleRestore(
    batchEvent: WorkspaceEventBatch<ObjectRecordRestoreEvent>,
  ) {
    await this.enqueue(batchEvent, DatabaseEventAction.RESTORED);
  }

  @OnDatabaseBatchEvent('*', DatabaseEventAction.DESTROYED)
  async handleDestroy(
    batchEvent: WorkspaceEventBatch<ObjectRecordDestroyEvent>,
  ) {
    await this.enqueue(batchEvent, DatabaseEventAction.DESTROYED);
  }

  private async enqueue<T extends ObjectRecordEvent>(
    batchEvent: WorkspaceEventBatch<T>,
    action: DatabaseEventAction,
  ): Promise<void> {
    try {
      const entries = mapDatabaseBatchEventToAuditEntries(batchEvent, action);

      if (entries.length === 0) {
        return;
      }

      await this.auditLogQueueService.add<VeridianAuditLogBatch>(
        VERIDIAN_AUDIT_LOG_WRITER_JOB,
        { entries },
        { retryLimit: 3 },
      );
    } catch (error) {
      // Auditing must never break a business mutation.
      this.logger.warn(
        `Failed to enqueue audit entries for ${batchEvent.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
