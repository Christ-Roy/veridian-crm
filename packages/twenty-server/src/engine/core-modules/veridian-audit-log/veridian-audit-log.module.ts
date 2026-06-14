import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { VeridianAuditLogAuthEventListener } from 'src/engine/core-modules/veridian-audit-log/listeners/veridian-audit-log-auth-event.listener';
import { VeridianAuditLogDatabaseEventListener } from 'src/engine/core-modules/veridian-audit-log/listeners/veridian-audit-log-database-event.listener';
import { VeridianAuditLogEmitter } from 'src/engine/core-modules/veridian-audit-log/services/veridian-audit-log-emitter.service';
import { VeridianAuditLogService } from 'src/engine/core-modules/veridian-audit-log/services/veridian-audit-log.service';
import { VeridianAuditLogEntity } from 'src/engine/core-modules/veridian-audit-log/veridian-audit-log.entity';
import { VeridianAuditLogResolver } from 'src/engine/core-modules/veridian-audit-log/veridian-audit-log.resolver';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';

/**
 * Veridian append-only audit log (AGPL, clean-room).
 *
 * Imported in the API process (core-engine.module): registers the event
 * listeners that capture record CRUD + auth events off the AGPL native bus,
 * the emitter the Veridian code calls for auth events, and the admin read
 * resolver. The async DB write itself lives in `VeridianAuditLogJobModule`
 * (worker process) which reuses the exported `VeridianAuditLogService`.
 *
 * NOTE clean-room: this module does NOT depend on the EE `event-logs/` module
 * in any way.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([VeridianAuditLogEntity]),
    PermissionsModule,
  ],
  providers: [
    VeridianAuditLogService,
    VeridianAuditLogEmitter,
    VeridianAuditLogDatabaseEventListener,
    VeridianAuditLogAuthEventListener,
    VeridianAuditLogResolver,
  ],
  exports: [VeridianAuditLogService, VeridianAuditLogEmitter, TypeOrmModule],
})
export class VeridianAuditLogModule {}
