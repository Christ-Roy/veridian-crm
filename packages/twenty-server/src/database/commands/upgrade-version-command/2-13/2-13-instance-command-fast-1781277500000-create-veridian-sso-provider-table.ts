import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

/**
 * Creates the Veridian SSO provider table (AGPL, clean-room — no EE code).
 * Schema mirrors `VeridianSsoProviderEntity`. `encryptedConfig` holds the IdP
 * configuration encrypted at rest (AES-256-GCM via SecretEncryptionService).
 * FK CASCADE to workspace: a deleted workspace drops its SSO providers.
 */
@RegisteredInstanceCommand('2.13.0', 1781277500000)
export class CreateVeridianSsoProviderTableFastInstanceCommand
  implements FastInstanceCommand
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "core"."veridianSsoProvider" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "type" character varying NOT NULL,
        "name" character varying NOT NULL,
        "isEnabled" boolean NOT NULL DEFAULT true,
        "encryptedConfig" text NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_veridianSsoProvider_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_VERIDIAN_SSO_PROVIDER_WORKSPACE_ID" ON "core"."veridianSsoProvider" ("workspaceId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "core"."veridianSsoProvider"
        ADD CONSTRAINT "FK_veridianSsoProvider_workspaceId"
        FOREIGN KEY ("workspaceId") REFERENCES "core"."workspace"("id")
        ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "core"."veridianSsoProvider" DROP CONSTRAINT IF EXISTS "FK_veridianSsoProvider_workspaceId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "core"."IDX_VERIDIAN_SSO_PROVIDER_WORKSPACE_ID"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "core"."veridianSsoProvider"`,
    );
  }
}
