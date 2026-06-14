import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import { type QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { type VeridianAuditLogEntry } from 'src/engine/core-modules/veridian-audit-log/types/veridian-audit-log-entry.type';
import { type VeridianAuditLogFindArgs } from 'src/engine/core-modules/veridian-audit-log/types/veridian-audit-log-find-args.type';
import { VeridianAuditLogEntity } from 'src/engine/core-modules/veridian-audit-log/veridian-audit-log.entity';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * Append-only audit log persistence + read service (AGPL, clean-room).
 *
 * Write side exposes ONLY `insertEntries` (INSERT, never update/delete) to
 * guarantee the journal stays append-only. Read side is for the admin
 * consultation resolver.
 */
@Injectable()
export class VeridianAuditLogService {
  constructor(
    @InjectRepository(VeridianAuditLogEntity)
    private readonly auditLogRepository: Repository<VeridianAuditLogEntity>,
  ) {}

  /**
   * Append-only write. Uses `insert` (not `save`) so it can only ever add
   * rows. Errors are logged but not re-thrown: the job's retry handles
   * transient failures, and auditing must not crash the worker.
   */
  async insertEntries(entries: VeridianAuditLogEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const rows = entries.map((entry) => ({
      workspaceId: entry.workspaceId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      actorUserId: entry.actorUserId ?? null,
      actorWorkspaceMemberId: entry.actorWorkspaceMemberId ?? null,
      actorType: entry.actorType,
      actorDisplay: entry.actorDisplay ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      context: entry.context ?? null,
      diff: entry.diff ?? null,
      occurredAt: entry.occurredAt ? new Date(entry.occurredAt) : null,
    }));

    // Cast required because the jsonb columns (context/diff) are typed as
    // Record objects, which TypeORM's QueryDeepPartialEntity recurses into.
    // Same pattern as public-domain.service.ts (AGPL).
    await this.auditLogRepository.insert(
      rows as QueryDeepPartialEntity<VeridianAuditLogEntity>[],
    );
  }

  /**
   * Admin read. `workspaceId` is mandatory so a workspace admin can only ever
   * read their own trail. Ordered most-recent first, cursor-paginated on
   * `recordedAt`.
   */
  async findEntries(
    args: VeridianAuditLogFindArgs,
  ): Promise<VeridianAuditLogEntity[]> {
    const limit = Math.min(args.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const query = this.auditLogRepository
      .createQueryBuilder('audit')
      .where('audit.workspaceId = :workspaceId', {
        workspaceId: args.workspaceId,
      });

    if (args.action) {
      query.andWhere('audit.action = :action', { action: args.action });
    }

    if (args.targetType) {
      query.andWhere('audit.targetType = :targetType', {
        targetType: args.targetType,
      });
    }

    if (args.targetId) {
      query.andWhere('audit.targetId = :targetId', {
        targetId: args.targetId,
      });
    }

    if (args.actorUserId) {
      query.andWhere('audit.actorUserId = :actorUserId', {
        actorUserId: args.actorUserId,
      });
    }

    if (args.from) {
      query.andWhere('audit.recordedAt >= :from', { from: args.from });
    }

    if (args.to) {
      query.andWhere('audit.recordedAt <= :to', { to: args.to });
    }

    if (args.before) {
      query.andWhere('audit.recordedAt < :before', { before: args.before });
    }

    return query.orderBy('audit.recordedAt', 'DESC').take(limit).getMany();
  }
}
