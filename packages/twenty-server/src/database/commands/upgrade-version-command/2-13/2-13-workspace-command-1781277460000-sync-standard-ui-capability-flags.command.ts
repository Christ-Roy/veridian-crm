import { InjectDataSource } from '@nestjs/typeorm';

import { Command } from 'nest-commander';
import { DataSource } from 'typeorm';
import { isDefined } from 'twenty-shared/utils';

import { ActiveOrSuspendedWorkspaceCommandRunner } from 'src/database/commands/command-runners/active-or-suspended-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';

// Re-syncs the UI capability flags of standard objects and fields with their
// standard-application definitions. Covers two cases the rename instance
// command cannot reach:
// - isUICreatable is a new column (default true) and workflowRun,
//   workflowVersion and workspaceMember must become non-creatable; the
//   twenty-standard application is not re-synced on existing workspaces.
// - standard fields created by pre-2.13 workspace upgrade commands during a
//   cross-version upgrade lose their isUIEditable: false value (the column is
//   hidden until the rename instance command has run), so they would
//   otherwise stay editable after the rename backfill.
@RegisteredWorkspaceCommand('2.13.0', 1781277460000)
@Command({
  name: 'upgrade:2-13:sync-standard-ui-capability-flags',
  description:
    'Re-sync isUICreatable and isUIEditable on standard objects and isUIEditable on standard fields from the standard-application definitions',
})
export class SyncStandardUiCapabilityFlagsCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly applicationService: ApplicationService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    @InjectDataSource()
    private readonly coreDataSource: DataSource,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({
    workspaceId,
    options,
  }: RunOnWorkspaceArgs): Promise<void> {
    const isDryRun = options.dryRun ?? false;

    this.logger.log(
      `${isDryRun ? '[DRY RUN] ' : ''}Syncing standard UI capability flags for workspace ${workspaceId}`,
    );

    const { twentyStandardFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );

    // Veridian patch (AGPL inline, cf VERIDIAN-PATCHES.md) — read the existing
    // UI flags with RAW SQL instead of workspaceCacheService.getOrRecompute().
    // getOrRecompute reads through the ObjectMetadataEntity/FieldMetadataEntity
    // ORM, which still maps the removed `isUIReadOnly` column via
    // @WasRemovedInUpgrade. On a workspace whose upgrade cursor is parked on THIS
    // very command (cross-version upgrade), the UpgradeAwareEntityMetadataAdapter
    // has not yet hidden that column, so the generated SELECT references
    // `isUIReadOnly` — which the rename instance command already dropped — and
    // throws `column ObjectMetadataEntity.isUIReadOnly does not exist`. That
    // crash is a deadlock: the command can never complete, the cursor never
    // advances, the column never gets hidden, and every data query that recomputes
    // the flat-metadata cache crashes the same way (GraphQL + REST). Upstream
    // #21543 fixed the write path but left this read path on the ORM.
    // We only consume { id, universalIdentifier, isUICreatable, isUIEditable }
    // below, so a narrow raw read on the already-migrated columns is sufficient
    // and side-steps the phantom `isUIReadOnly` SELECT entirely.
    const existingFlatObjectMetadataMaps = {
      byUniversalIdentifier: await this.readExistingUiFlagsByUniversalIdentifier<{
        id: string;
        universalIdentifier: string;
        isUICreatable: boolean;
        isUIEditable: boolean;
      }>(
        workspaceId,
        'objectMetadata',
        '"id", "universalIdentifier", "isUICreatable", "isUIEditable"',
      ),
    };
    const existingFlatFieldMetadataMaps = {
      byUniversalIdentifier: await this.readExistingUiFlagsByUniversalIdentifier<{
        id: string;
        universalIdentifier: string;
        isUIEditable: boolean;
      }>(
        workspaceId,
        'fieldMetadata',
        '"id", "universalIdentifier", "isUIEditable"',
      ),
    };

    const { allFlatEntityMaps: standardAllFlatEntityMaps } =
      computeTwentyStandardApplicationAllFlatEntityMaps({
        now: new Date().toISOString(),
        workspaceId,
        twentyStandardApplicationId: twentyStandardFlatApplication.id,
      });

    const objectsToUpdate = Object.values(
      standardAllFlatEntityMaps.flatObjectMetadataMaps.byUniversalIdentifier,
    )
      .filter(isDefined)
      .map((standardObject) => {
        const existingObject =
          existingFlatObjectMetadataMaps.byUniversalIdentifier[
            standardObject.universalIdentifier
          ];

        if (
          !isDefined(existingObject) ||
          (existingObject.isUICreatable === standardObject.isUICreatable &&
            existingObject.isUIEditable === standardObject.isUIEditable)
        ) {
          return undefined;
        }

        return {
          ...existingObject,
          isUICreatable: standardObject.isUICreatable,
          isUIEditable: standardObject.isUIEditable,
          updatedAt: new Date().toISOString(),
        };
      })
      .filter(isDefined);

    const fieldsToUpdate = Object.values(
      standardAllFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier,
    )
      .filter(isDefined)
      .map((standardField) => {
        const existingField =
          existingFlatFieldMetadataMaps.byUniversalIdentifier[
            standardField.universalIdentifier
          ];

        if (
          !isDefined(existingField) ||
          existingField.isUIEditable === standardField.isUIEditable
        ) {
          return undefined;
        }

        return {
          ...existingField,
          isUIEditable: standardField.isUIEditable,
          updatedAt: new Date().toISOString(),
        };
      })
      .filter(isDefined);

    if (objectsToUpdate.length === 0 && fieldsToUpdate.length === 0) {
      this.logger.log(
        `Standard UI capability flags already up to date for workspace ${workspaceId}`,
      );

      return;
    }

    this.logger.log(
      `Found ${objectsToUpdate.length} standard object(s) and ${fieldsToUpdate.length} standard field(s) with drifted UI capability flags for workspace ${workspaceId}`,
    );

    if (isDryRun) {
      this.logger.log(
        `[DRY RUN] Would sync UI capability flags on ${objectsToUpdate.length} standard object(s) and ${fieldsToUpdate.length} standard field(s) for workspace ${workspaceId}`,
      );

      return;
    }

    // isUIEditable/isUICreatable are UI-affordance flags stored directly on
    // core.objectMetadata/core.fieldMetadata — changing them needs no
    // workspace-schema migration. We write them straight to the metadata
    // tables instead of going through validateBuildAndRunWorkspaceMigration:
    // that pipeline enforces user-facing mutation guards (system-field and
    // relation-field property allow-lists) that reject this trusted system
    // backfill on cross-version-upgraded workspaces.
    const fieldIdsToSetEditable = fieldsToUpdate
      .filter((field) => field.isUIEditable)
      .map((field) => field.id);
    const fieldIdsToSetNonEditable = fieldsToUpdate
      .filter((field) => !field.isUIEditable)
      .map((field) => field.id);

    // All writes for a workspace run in one transaction so a mid-run failure
    // can't leave the flags partially applied.
    const queryRunner = this.coreDataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (fieldIdsToSetEditable.length > 0) {
        await queryRunner.query(
          `UPDATE "core"."fieldMetadata" SET "isUIEditable" = true, "updatedAt" = now() WHERE "id" = ANY($1)`,
          [fieldIdsToSetEditable],
        );
      }

      if (fieldIdsToSetNonEditable.length > 0) {
        await queryRunner.query(
          `UPDATE "core"."fieldMetadata" SET "isUIEditable" = false, "updatedAt" = now() WHERE "id" = ANY($1)`,
          [fieldIdsToSetNonEditable],
        );
      }

      for (const objectToUpdate of objectsToUpdate) {
        await queryRunner.query(
          `UPDATE "core"."objectMetadata" SET "isUICreatable" = $1, "isUIEditable" = $2, "updatedAt" = now() WHERE "id" = $3`,
          [
            objectToUpdate.isUICreatable,
            objectToUpdate.isUIEditable,
            objectToUpdate.id,
          ],
        );
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();

      throw error;
    } finally {
      await queryRunner.release();
    }

    // The raw writes bypass the metadata cache, so flush the flat maps the app
    // reads these flags from (after the transaction has committed).
    // Veridian patch (AGPL inline, cf VERIDIAN-PATCHES.md): use flush() (Redis +
    // local cache eviction only), NOT invalidateAndRecompute(). The latter
    // immediately recomputes via the ORM, which — on a workspace whose cursor is
    // still parked on this command — re-triggers the same phantom `isUIReadOnly`
    // SELECT and would throw here too. The flags are already persisted; the cache
    // self-heals on the next getOrRecompute, by which point the cursor has
    // advanced past the rename and the column is hidden. A cache hiccup must not
    // fail the upgrade.
    try {
      await this.workspaceCacheService.flush(workspaceId, [
        'flatObjectMetadataMaps',
        'flatFieldMetadataMaps',
      ]);
    } catch (cacheError) {
      this.logger.warn(
        `Synced UI capability flags for workspace ${workspaceId} but failed to flush the metadata cache: ${
          cacheError instanceof Error ? cacheError.message : String(cacheError)
        }`,
      );
    }

    this.logger.log(
      `Successfully synced UI capability flags on ${objectsToUpdate.length} standard object(s) and ${fieldsToUpdate.length} standard field(s) for workspace ${workspaceId}`,
    );
  }

  // Veridian patch (AGPL inline, cf VERIDIAN-PATCHES.md). Raw read of the UI
  // capability flags for a workspace's standard metadata, keyed by
  // universalIdentifier. Deliberately does NOT go through the ORM/flat-metadata
  // cache: the metadata entities still map the removed `isUIReadOnly` column via
  // @WasRemovedInUpgrade, and the generated SELECT would reference a column that
  // the rename instance command already dropped on a workspace whose upgrade
  // cursor is parked on this very command (see runOnWorkspace for the full
  // rationale). Only standard (non-custom) rows are synced by this command.
  private async readExistingUiFlagsByUniversalIdentifier<
    T extends { universalIdentifier: string },
  >(
    workspaceId: string,
    table: 'objectMetadata' | 'fieldMetadata',
    columns: string,
  ): Promise<Record<string, T>> {
    const rows: T[] = await this.coreDataSource.query(
      `SELECT ${columns} FROM "core"."${table}"
       WHERE "workspaceId" = $1 AND "universalIdentifier" IS NOT NULL`,
      [workspaceId],
    );

    return rows.reduce<Record<string, T>>((acc, row) => {
      acc[row.universalIdentifier] = row;

      return acc;
    }, {});
  }
}
