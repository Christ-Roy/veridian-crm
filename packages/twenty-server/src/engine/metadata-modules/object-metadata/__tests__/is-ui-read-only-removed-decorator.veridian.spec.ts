/*
 * Veridian CRM — patch-survival (AGPLv3, cf VERIDIAN-PATCHES.md).
 *
 * Locks the Veridian fix for the cross-version `isUIReadOnly` crash.
 *
 * The 2.13 rename instance command physically drops the `isUIReadOnly` column
 * (renames it to isUIEditable). Upstream deliberately left the column WITHOUT
 * @WasRemovedInUpgrade (for a rolling ArgoCD deploy concern that does not apply
 * to our single-container compose deploys). The result: TypeORM keeps SELECTing
 * `isUIReadOnly` on every workspace whose upgrade cursor has passed the rename,
 * throwing `column ObjectMetadataEntity.isUIReadOnly does not exist` —
 * deadlocking SyncStandardUiCapabilityFlags and breaking every data query.
 *
 * Our fix decorates isUIReadOnly with @WasRemovedInUpgrade(rename command) on
 * both ObjectMetadataEntity and FieldMetadataEntity so the upgrade-aware adapter
 * hides the column after the rename has run. This test fails if a future
 * upstream sync drops that decorator.
 */

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RENAME_IS_UI_READ_ONLY_TO_IS_UI_EDITABLE_UPGRADE_COMMAND_NAME } from 'src/engine/metadata-modules/object-metadata/constants/rename-is-ui-read-only-to-is-ui-editable-upgrade-command-name.constant';
import { getWasRemovedInUpgradePropertyMetadata } from 'src/engine/core-modules/upgrade/decorators/was-removed-in-upgrade.decorator';

describe('isUIReadOnly @WasRemovedInUpgrade (Veridian cross-version fix)', () => {
  it.each([
    ['ObjectMetadataEntity', ObjectMetadataEntity],
    ['FieldMetadataEntity', FieldMetadataEntity],
  ])(
    '%s.isUIReadOnly is decorated @WasRemovedInUpgrade with the 2.13 rename command',
    (_name, entityClass) => {
      const propertyMetadata =
        getWasRemovedInUpgradePropertyMetadata(entityClass);

      // Without the decorator this map has no isUIReadOnly entry → the ORM
      // SELECTs the dropped column and crashes on cross-version-upgraded
      // workspaces.
      expect(propertyMetadata.isUIReadOnly).toBeDefined();
      expect(propertyMetadata.isUIReadOnly?.upgradeCommandName).toBe(
        RENAME_IS_UI_READ_ONLY_TO_IS_UI_EDITABLE_UPGRADE_COMMAND_NAME,
      );
    },
  );
});
