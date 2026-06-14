import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

/**
 * Creates the Veridian append-only audit log table (AGPL, clean-room — no EE
 * code). Schema mirrors `VeridianAuditLogEntity`. No FK CASCADE to workspace on
 * purpose: the audit trail must survive workspace deletion (legal retention).
 */
@RegisteredInstanceCommand('2.13.0', 1781277490000)
export class CreateVeridianAuditLogTableFastInstanceCommand
  implements FastInstanceCommand
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "core"."veridianAuditLog" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid,
        "action" character varying NOT NULL,
        "targetType" character varying,
        "targetId" uuid,
        "actorUserId" uuid,
        "actorWorkspaceMemberId" uuid,
        "actorType" character varying NOT NULL DEFAULT 'system',
        "actorDisplay" character varying,
        "ipAddress" character varying,
        "userAgent" character varying,
        "context" jsonb,
        "diff" jsonb,
        "recordedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "occurredAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_veridianAuditLog_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_VERIDIAN_AUDIT_LOG_WORKSPACE_RECORDED" ON "core"."veridianAuditLog" ("workspaceId", "recordedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_VERIDIAN_AUDIT_LOG_TARGET" ON "core"."veridianAuditLog" ("workspaceId", "targetType", "targetId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_VERIDIAN_AUDIT_LOG_ACTOR" ON "core"."veridianAuditLog" ("workspaceId", "actorUserId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_VERIDIAN_AUDIT_LOG_ACTION" ON "core"."veridianAuditLog" ("workspaceId", "action")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "core"."IDX_VERIDIAN_AUDIT_LOG_ACTION"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "core"."IDX_VERIDIAN_AUDIT_LOG_ACTOR"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "core"."IDX_VERIDIAN_AUDIT_LOG_TARGET"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "core"."IDX_VERIDIAN_AUDIT_LOG_WORKSPACE_RECORDED"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "core"."veridianAuditLog"`,
    );
  }
}
