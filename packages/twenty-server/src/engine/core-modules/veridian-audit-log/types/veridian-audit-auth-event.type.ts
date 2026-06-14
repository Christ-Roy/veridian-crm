/**
 * Payload carried on the AGPL custom-event bus for an auditable auth event
 * (login / logout / failed login). Emitted by `VeridianAuditLogEmitter`,
 * consumed by `VeridianAuditLogAuthEventListener`.
 */
export type VeridianAuditAuthEventPayload = {
  workspaceId?: string;
  /** authenticated user id (omitted for an anonymous failed login attempt) */
  userId?: string;
  workspaceMemberId?: string;
  /** email / display name of the actor, for a failed login this is the attempted email */
  actorDisplay?: string;
  ipAddress?: string;
  userAgent?: string;
  /** "password" | "google" | "microsoft" | "sso" | … */
  provider?: string;
  /** failure reason for a failed login (never the password itself) */
  reason?: string;
};
