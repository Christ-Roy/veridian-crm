import { Injectable, Logger } from '@nestjs/common';

import { OnCustomBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-custom-batch-event.decorator';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import {
  VERIDIAN_AUDIT_AUTH_EVENT,
  VERIDIAN_AUDIT_LOG_WRITER_JOB,
} from 'src/engine/core-modules/veridian-audit-log/constants/veridian-audit-log.constants';
import { type VeridianAuditAuthEventPayload } from 'src/engine/core-modules/veridian-audit-log/types/veridian-audit-auth-event.type';
import { type VeridianAuditLogBatch } from 'src/engine/core-modules/veridian-audit-log/types/veridian-audit-log-entry.type';
import { mapAuthEventToAuditEntry } from 'src/engine/core-modules/veridian-audit-log/utils/map-auth-event-to-audit-entry.util';
import { type CustomWorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/custom-workspace-batch-event.type';

/**
 * Veridian append-only audit log — auth event capture (AGPL, clean-room).
 *
 * Subscribes to the AGPL native custom-event bus for the auth events emitted
 * by `VeridianAuditLogEmitter`. Like the database listener it only maps +dumps
 * onto the queue (non-blocking); the writer job persists.
 */
@Injectable()
export class VeridianAuditLogAuthEventListener {
  private readonly logger = new Logger(
    VeridianAuditLogAuthEventListener.name,
  );

  constructor(
    @InjectMessageQueue(MessageQueue.veridianAuditLogQueue)
    private readonly auditLogQueueService: MessageQueueService,
  ) {}

  @OnCustomBatchEvent(VERIDIAN_AUDIT_AUTH_EVENT.SIGNED_IN)
  async handleSignedIn(
    payload: CustomWorkspaceEventBatch<VeridianAuditAuthEventPayload>,
  ) {
    await this.enqueue(payload);
  }

  @OnCustomBatchEvent(VERIDIAN_AUDIT_AUTH_EVENT.SIGNED_OUT)
  async handleSignedOut(
    payload: CustomWorkspaceEventBatch<VeridianAuditAuthEventPayload>,
  ) {
    await this.enqueue(payload);
  }

  @OnCustomBatchEvent(VERIDIAN_AUDIT_AUTH_EVENT.SIGN_IN_FAILED)
  async handleSignInFailed(
    payload: CustomWorkspaceEventBatch<VeridianAuditAuthEventPayload>,
  ) {
    await this.enqueue(payload);
  }

  private async enqueue(
    payload: CustomWorkspaceEventBatch<VeridianAuditAuthEventPayload>,
  ): Promise<void> {
    try {
      const entries = payload.events.map((event) =>
        mapAuthEventToAuditEntry(payload.name, event),
      );

      if (entries.length === 0) {
        return;
      }

      await this.auditLogQueueService.add<VeridianAuditLogBatch>(
        VERIDIAN_AUDIT_LOG_WRITER_JOB,
        { entries },
        { retryLimit: 3 },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue auth audit entry for ${payload.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
