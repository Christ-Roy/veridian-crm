import { type ObjectRecordEvent } from 'twenty-shared/database-events';

import { type DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { VeridianAuditLogActorTypeEnum } from 'src/engine/core-modules/veridian-audit-log/constants/veridian-audit-log.constants';
import { type VeridianAuditLogEntry } from 'src/engine/core-modules/veridian-audit-log/types/veridian-audit-log-entry.type';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';

const resolveActorType = (
  event: ObjectRecordEvent,
): VeridianAuditLogActorTypeEnum => {
  if (event.userId) {
    return VeridianAuditLogActorTypeEnum.USER;
  }

  if (event.workspaceMemberId) {
    return VeridianAuditLogActorTypeEnum.USER;
  }

  return VeridianAuditLogActorTypeEnum.SYSTEM;
};

/**
 * Pure mapping: AGPL native database batch event -> append-only audit entries.
 *
 * Kept side-effect free so it is fully unit-testable without NestJS / DB. One
 * entry is produced per affected record. The `diff` (per-field before/after)
 * is carried verbatim from the native event when present.
 */
export const mapDatabaseBatchEventToAuditEntries = <T extends ObjectRecordEvent>(
  batchEvent: WorkspaceEventBatch<T>,
  action: DatabaseEventAction,
): VeridianAuditLogEntry[] => {
  const targetType = batchEvent.objectMetadata?.nameSingular ?? null;

  return batchEvent.events.map((event): VeridianAuditLogEntry => {
    // `properties.diff` only exists on update/delete/restore/upsert events;
    // read it defensively so the union (which includes create/destroy) is fine.
    const diff = (event.properties as { diff?: Record<string, unknown> })?.diff;

    return {
      workspaceId: batchEvent.workspaceId ?? null,
      action: `record.${action}`,
      targetType,
      targetId: event.recordId ?? null,
      actorUserId: event.userId ?? null,
      actorWorkspaceMemberId: event.workspaceMemberId ?? null,
      actorType: resolveActorType(event),
      diff:
        diff && Object.keys(diff).length > 0
          ? (diff as Record<string, unknown>)
          : null,
    };
  });
};
