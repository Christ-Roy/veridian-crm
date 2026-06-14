import { type VeridianAuditLogActorType } from 'src/engine/core-modules/veridian-audit-log/constants/veridian-audit-log.constants';

/**
 * Plain payload pushed onto the audit queue and inserted as-is by the writer
 * job. Deliberately a flat serializable object (it crosses the BullMQ
 * boundary) — no entity instance, no class methods.
 */
export type VeridianAuditLogEntry = {
  workspaceId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  actorUserId?: string | null;
  actorWorkspaceMemberId?: string | null;
  actorType: VeridianAuditLogActorType;
  actorDisplay?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  context?: Record<string, unknown> | null;
  diff?: Record<string, unknown> | null;
  occurredAt?: Date | string | null;
};

/**
 * Batch carried on the queue. One database batch event can produce several
 * entries (one per affected record).
 */
export type VeridianAuditLogBatch = {
  entries: VeridianAuditLogEntry[];
};
