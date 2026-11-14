import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import {
  DOSSIER_UNIVERSAL_IDENTIFIER,
  PARENT_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
  SOUS_DOSSIERS_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

// Supprimer un dossier racine ne supprime pas ses sous-dossiers : ils deviennent racines.
export default defineField({
  universalIdentifier: PARENT_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: DOSSIER_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'parent',
  label: 'Dossier parent',
  icon: 'IconFolderUp',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: DOSSIER_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: SOUS_DOSSIERS_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'parentId',
  },
});
