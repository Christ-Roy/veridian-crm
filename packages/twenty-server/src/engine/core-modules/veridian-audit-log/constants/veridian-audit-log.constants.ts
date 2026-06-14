/**
 * Veridian audit log constants (AGPL — clean-room).
 */

export enum VeridianAuditLogActorTypeEnum {
  USER = 'user',
  API_KEY = 'api_key',
  SYSTEM = 'system',
  ANONYMOUS = 'anonymous',
}

export type VeridianAuditLogActorType = `${VeridianAuditLogActorTypeEnum}`;

/**
 * Custom event name prefix for non-database auditable events (auth, etc.).
 * Emitted on the AGPL `WorkspaceEventEmitter` via `emitCustomBatchEvent`.
 * The audit listener subscribes to the concrete names below.
 */
export const VERIDIAN_AUDIT_AUTH_EVENT = {
  SIGNED_IN: 'veridian.auth.signed_in',
  SIGNED_OUT: 'veridian.auth.signed_out',
  SIGN_IN_FAILED: 'veridian.auth.sign_in_failed',
} as const;

export type VeridianAuditAuthEventName =
  (typeof VERIDIAN_AUDIT_AUTH_EVENT)[keyof typeof VERIDIAN_AUDIT_AUTH_EVENT];

/**
 * Name of the job that performs the (async, non-blocking) DB insert.
 */
export const VERIDIAN_AUDIT_LOG_WRITER_JOB = 'VeridianAuditLogWriterJob';

/**
 * Default retention in days. Overridable via env
 * `VERIDIAN_AUDIT_LOG_RETENTION_DAYS`. RGPD: no unbounded retention of
 * personal data without legal basis; one year covers most SOC2/contractual
 * needs.
 */
export const VERIDIAN_AUDIT_LOG_DEFAULT_RETENTION_DAYS = 365;
