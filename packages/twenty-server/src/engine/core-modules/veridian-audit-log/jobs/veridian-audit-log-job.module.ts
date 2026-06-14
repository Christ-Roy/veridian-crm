import { Module } from '@nestjs/common';

import { VeridianAuditLogWriterJob } from 'src/engine/core-modules/veridian-audit-log/jobs/veridian-audit-log-writer.job';
import { VeridianAuditLogModule } from 'src/engine/core-modules/veridian-audit-log/veridian-audit-log.module';

/**
 * Worker-side module for the Veridian audit log (AGPL, clean-room). Imported in
 * `JobsModule`: registers the processor that performs the async append-only
 * insert, reusing the persistence service exported by `VeridianAuditLogModule`.
 */
@Module({
  imports: [VeridianAuditLogModule],
  providers: [VeridianAuditLogWriterJob],
})
export class VeridianAuditLogJobModule {}
