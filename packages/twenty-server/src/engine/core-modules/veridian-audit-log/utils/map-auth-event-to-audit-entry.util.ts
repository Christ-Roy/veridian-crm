import { VeridianAuditLogActorTypeEnum } from 'src/engine/core-modules/veridian-audit-log/constants/veridian-audit-log.constants';
import { type VeridianAuditAuthEventPayload } from 'src/engine/core-modules/veridian-audit-log/types/veridian-audit-auth-event.type';
import { type VeridianAuditLogEntry } from 'src/engine/core-modules/veridian-audit-log/types/veridian-audit-log-entry.type';

/**
 * Pure mapping: AGPL custom auth event -> append-only audit entry.
 *
 * `eventName` is the fully-qualified custom event name (e.g.
 * "veridian.auth.signed_in"); the stored `action` strips the "veridian."
 * prefix to read as "auth.signed_in".
 */
export const mapAuthEventToAuditEntry = (
  eventName: string,
  payload: VeridianAuditAuthEventPayload,
): VeridianAuditLogEntry => {
  const action = eventName.replace(/^veridian\./, '');

  return {
    workspaceId: payload.workspaceId ?? null,
    action,
    targetType: null,
    targetId: null,
    actorUserId: payload.userId ?? null,
    actorWorkspaceMemberId: payload.workspaceMemberId ?? null,
    actorType: payload.userId
      ? VeridianAuditLogActorTypeEnum.USER
      : VeridianAuditLogActorTypeEnum.ANONYMOUS,
    actorDisplay: payload.actorDisplay ?? null,
    ipAddress: payload.ipAddress ?? null,
    userAgent: payload.userAgent ?? null,
    context: {
      ...(payload.provider ? { provider: payload.provider } : {}),
      ...(payload.reason ? { reason: payload.reason } : {}),
    },
  };
};
