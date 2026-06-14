/*
 * Veridian CRM — Append-only audit log, clean-room module (AGPLv3).
 * Copyright (c) 2026-present Veridian.
 *
 * Pure mapping tests for non-database auth events. No EE code.
 */

import { VeridianAuditLogActorTypeEnum } from 'src/engine/core-modules/veridian-audit-log/constants/veridian-audit-log.constants';
import { mapAuthEventToAuditEntry } from 'src/engine/core-modules/veridian-audit-log/utils/map-auth-event-to-audit-entry.util';

describe('mapAuthEventToAuditEntry (Veridian clean-room audit log)', () => {
  it('maps a successful sign-in to an audit entry with the actor + IP + provider', () => {
    const entry = mapAuthEventToAuditEntry('veridian.auth.signed_in', {
      workspaceId: 'ws-1',
      userId: 'user-1',
      workspaceMemberId: 'wm-1',
      actorDisplay: 'jane@veridian.site',
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
      provider: 'google',
    });

    expect(entry).toMatchObject({
      workspaceId: 'ws-1',
      action: 'auth.signed_in',
      actorUserId: 'user-1',
      actorWorkspaceMemberId: 'wm-1',
      actorType: VeridianAuditLogActorTypeEnum.USER,
      actorDisplay: 'jane@veridian.site',
      ipAddress: '203.0.113.7',
    });
    expect(entry.context).toEqual({ provider: 'google' });
    expect(entry.targetId).toBeNull();
  });

  it('maps a failed sign-in as ANONYMOUS and keeps the reason (never a password)', () => {
    const entry = mapAuthEventToAuditEntry('veridian.auth.sign_in_failed', {
      actorDisplay: 'attacker@example.com',
      ipAddress: '198.51.100.9',
      reason: 'invalid_credentials',
    });

    expect(entry.action).toBe('auth.sign_in_failed');
    expect(entry.actorType).toBe(VeridianAuditLogActorTypeEnum.ANONYMOUS);
    expect(entry.actorUserId).toBeNull();
    expect(entry.context).toEqual({ reason: 'invalid_credentials' });
  });

  it('strips only the veridian. prefix from the action name', () => {
    expect(
      mapAuthEventToAuditEntry('veridian.auth.signed_out', { userId: 'u' })
        .action,
    ).toBe('auth.signed_out');
  });
});
