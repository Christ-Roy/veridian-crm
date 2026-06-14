/**
 * Filters for the admin audit-log read. `workspaceId` is mandatory — a
 * workspace admin can only read their own trail.
 */
export type VeridianAuditLogFindArgs = {
  workspaceId: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  actorUserId?: string;
  from?: Date;
  to?: Date;
  /** cursor: return rows strictly older than this recordedAt */
  before?: Date;
  limit?: number;
};
