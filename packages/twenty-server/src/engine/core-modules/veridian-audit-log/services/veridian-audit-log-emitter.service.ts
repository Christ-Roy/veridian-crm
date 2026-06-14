import { Injectable } from '@nestjs/common';

import {
  VERIDIAN_AUDIT_AUTH_EVENT,
  type VeridianAuditAuthEventName,
} from 'src/engine/core-modules/veridian-audit-log/constants/veridian-audit-log.constants';
import { type VeridianAuditAuthEventPayload } from 'src/engine/core-modules/veridian-audit-log/types/veridian-audit-auth-event.type';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';

/**
 * Thin emitter the Veridian code calls to record non-database auditable events
 * (login / logout / failed login). It publishes on the AGPL native
 * `WorkspaceEventEmitter` custom-event channel — the same public bus the
 * telemetry listener uses for `USER_SIGNUP`. The audit listener picks it up
 * and persists it asynchronously.
 */
@Injectable()
export class VeridianAuditLogEmitter {
  constructor(private readonly workspaceEventEmitter: WorkspaceEventEmitter) {}

  emitSignedIn(payload: VeridianAuditAuthEventPayload): void {
    this.emit(VERIDIAN_AUDIT_AUTH_EVENT.SIGNED_IN, payload);
  }

  emitSignedOut(payload: VeridianAuditAuthEventPayload): void {
    this.emit(VERIDIAN_AUDIT_AUTH_EVENT.SIGNED_OUT, payload);
  }

  emitSignInFailed(payload: VeridianAuditAuthEventPayload): void {
    this.emit(VERIDIAN_AUDIT_AUTH_EVENT.SIGN_IN_FAILED, payload);
  }

  private emit(
    eventName: VeridianAuditAuthEventName,
    payload: VeridianAuditAuthEventPayload,
  ): void {
    this.workspaceEventEmitter.emitCustomBatchEvent<VeridianAuditAuthEventPayload>(
      eventName,
      [payload],
      payload.workspaceId,
    );
  }
}
