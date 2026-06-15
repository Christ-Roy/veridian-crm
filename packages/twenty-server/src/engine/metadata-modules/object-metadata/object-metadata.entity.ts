import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { type WorkspaceEntityDuplicateCriteria } from 'src/engine/api/graphql/workspace-query-builder/types/workspace-entity-duplicate-criteria.type';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { IndexMetadataEntity } from 'src/engine/metadata-modules/index-metadata/index-metadata.entity';
import { type ObjectStandardOverridesDTO } from 'src/engine/metadata-modules/object-metadata/dtos/object-standard-overrides.dto';
import { FieldPermissionEntity } from 'src/engine/metadata-modules/object-permission/field-permission/field-permission.entity';
import { ObjectPermissionEntity } from 'src/engine/metadata-modules/object-permission/object-permission.entity';
import { ViewEntity } from 'src/engine/metadata-modules/view/entities/view.entity';
import { WasIntroducedInUpgrade } from 'src/engine/core-modules/upgrade/decorators/was-introduced-in-upgrade.decorator';
import { WasRemovedInUpgrade } from 'src/engine/core-modules/upgrade/decorators/was-removed-in-upgrade.decorator';
import { RENAME_IS_UI_READ_ONLY_TO_IS_UI_EDITABLE_UPGRADE_COMMAND_NAME } from 'src/engine/metadata-modules/object-metadata/constants/rename-is-ui-read-only-to-is-ui-editable-upgrade-command-name.constant';
import { SyncableEntity } from 'src/engine/workspace-manager/types/syncable-entity.interface';
import { type JsonbProperty } from 'src/engine/workspace-manager/workspace-migration/universal-flat-entity/types/jsonb-property.type';

@Entity('objectMetadata')
@Unique('IDX_OBJECT_METADATA_NAME_SINGULAR_WORKSPACE_ID_UNIQUE', [
  'nameSingular',
  'workspaceId',
])
@Unique('IDX_OBJECT_METADATA_NAME_PLURAL_WORKSPACE_ID_UNIQUE', [
  'namePlural',
  'workspaceId',
])
export class ObjectMetadataEntity
  extends SyncableEntity
  implements Required<ObjectMetadataEntity>
{
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // @deprecated - FK dropped, column kept for data preservation only
  @Column({ nullable: true, type: 'uuid' })
  dataSourceId: string;

  @Column({ nullable: false })
  nameSingular: string;

  @Column({ nullable: false })
  namePlural: string;

  @Column({ nullable: false })
  labelSingular: string;

  @Column({ nullable: false })
  labelPlural: string;

  @Column({ nullable: true, type: 'text' })
  description: string | null;

  @Column({ nullable: true, type: 'varchar' })
  icon: string | null;

  @Column({ nullable: true, type: 'text' })
  color: string | null;

  @Column({ type: 'jsonb', nullable: true })
  standardOverrides: JsonbProperty<ObjectStandardOverridesDTO> | null;

  /**
   * @deprecated
   */
  @Column({ nullable: false })
  targetTableName: string;

  @WasRemovedInUpgrade({
    upgradeCommandName:
      '2.12.0_DropIsCustomFromObjectAndFieldMetadataFastInstanceCommand_1780579070012',
  })
  @Column({ type: 'boolean', default: false })
  isCustom: WasRemovedInUpgrade<boolean>;

  @Column({ default: false })
  isRemote: boolean;

  @Column({ default: false })
  isActive: boolean;

  @Column({ default: false })
  isSystem: boolean;

  @WasIntroducedInUpgrade({
    upgradeCommandName:
      RENAME_IS_UI_READ_ONLY_TO_IS_UI_EDITABLE_UPGRADE_COMMAND_NAME,
  })
  @Column({ default: true })
  isUIEditable: boolean;

  // Superseded by isUIEditable.
  //
  // Veridian patch (AGPL inline, cf VERIDIAN-PATCHES.md): upstream intentionally
  // left this column WITHOUT @WasRemovedInUpgrade — their rationale is a rolling
  // ArgoCD deploy where previous-release pods still SELECT isUIReadOnly mid-roll
  // (core-team-issues#2542). But the 2.13 rename instance command
  // (RENAME_IS_UI_READ_ONLY_TO_IS_UI_EDITABLE) actually DROPS the physical column
  // (renames it to isUIEditable). Without the decorator, TypeORM keeps SELECTing
  // a column that no longer exists on every workspace whose upgrade cursor has
  // passed the rename → `column ObjectMetadataEntity.isUIReadOnly does not exist`
  // crashes the ORM metadata cache (WorkspaceORMEntityMetadatasCacheService),
  // which deadlocks SyncStandardUiCapabilityFlags AND breaks every data query
  // (GraphQL + REST). We do single-container compose deploys (no rolling roll),
  // so the upstream rolling-deploy concern does not apply: adding the decorator
  // hides the column once the rename has run, exactly like the isCustom column
  // above. Ref todo/2026-06-14-upgrade-ui-capability-flags-fail.md.
  @WasRemovedInUpgrade({
    upgradeCommandName: RENAME_IS_UI_READ_ONLY_TO_IS_UI_EDITABLE_UPGRADE_COMMAND_NAME,
  })
  @Column({ type: 'boolean', default: false })
  isUIReadOnly: WasRemovedInUpgrade<boolean>;

  @WasIntroducedInUpgrade({
    upgradeCommandName:
      RENAME_IS_UI_READ_ONLY_TO_IS_UI_EDITABLE_UPGRADE_COMMAND_NAME,
  })
  @Column({ default: true })
  isUICreatable: boolean;

  @Column({ default: true })
  isAuditLogged: boolean;

  @Column({ default: false })
  isSearchable: boolean;

  @Column({ type: 'jsonb', nullable: true })
  duplicateCriteria: JsonbProperty<WorkspaceEntityDuplicateCriteria[]> | null;

  @Column({ nullable: true, type: 'varchar' })
  shortcut: string | null;

  // TODO: This should not be nullable - legacy field introduced when label identifier was nullable
  // TODO: This should be a joinColumn and we should have a FK on this too https://github.com/twentyhq/core-team-issues/issues/2172
  @Column({ nullable: true, type: 'uuid' })
  labelIdentifierFieldMetadataId: string | null;

  @Column({ nullable: true, type: 'uuid' })
  imageIdentifierFieldMetadataId: string | null;

  @Column({ default: false })
  isLabelSyncedWithName: boolean;

  @OneToMany(() => FieldMetadataEntity, (field) => field.object, {
    cascade: true,
  })
  fields: Relation<FieldMetadataEntity[]>;

  @OneToMany(() => IndexMetadataEntity, (index) => index.objectMetadata, {
    cascade: true,
  })
  indexMetadatas: Relation<IndexMetadataEntity[]>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(
    () => ObjectPermissionEntity,
    (objectPermission) => objectPermission.objectMetadata,
    {
      cascade: true,
    },
  )
  objectPermissions: Relation<ObjectPermissionEntity[]>;

  @OneToMany(
    () => FieldPermissionEntity,
    (fieldPermission) => fieldPermission.objectMetadata,
    {
      cascade: true,
    },
  )
  fieldPermissions: Relation<FieldPermissionEntity[]>;

  @OneToMany(() => ViewEntity, (view) => view.objectMetadata, {
    cascade: true,
  })
  views: Relation<ViewEntity[]>;
}
