import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { VERIDIAN_AUDIT_LOG_WRITER_JOB } from 'src/engine/core-modules/veridian-audit-log/constants/veridian-audit-log.constants';
import { type VeridianAuditLogBatch } from 'src/engine/core-modules/veridian-audit-log/types/veridian-audit-log-entry.type';
import { VeridianAuditLogService } from 'src/engine/core-modules/veridian-audit-log/services/veridian-audit-log.service';

/**
 * Worker that performs the (async, off the mutation critical path) append-only
 * insert of audit entries. AGPL, clean-room. Mirrors the AGPL webhook job
 * processor pattern.
 */
@Processor(MessageQueue.veridianAuditLogQueue)
export class VeridianAuditLogWriterJob {
  constructor(
    private readonly veridianAuditLogService: VeridianAuditLogService,
  ) {}

  @Process(VERIDIAN_AUDIT_LOG_WRITER_JOB)
  async handle(data: VeridianAuditLogBatch): Promise<void> {
    await this.veridianAuditLogService.insertEntries(data.entries);
  }
}
