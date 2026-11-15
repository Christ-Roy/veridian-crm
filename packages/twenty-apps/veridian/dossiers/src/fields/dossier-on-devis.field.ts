import { defineField, FieldType, OnDeleteAction, RelationType } from 'twenty-sdk/define';

import {
  DEVIS_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
  DEVIS_UNIVERSAL_IDENTIFIER,
  DOSSIER_ON_DEVIS_UNIVERSAL_IDENTIFIER,
  DOSSIER_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

export default defineField({
  universalIdentifier: DOSSIER_ON_DEVIS_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: DEVIS_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'dossier',
  label: 'Dossier',
  icon: 'IconFolder',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: DOSSIER_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: DEVIS_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
  universalSettings: { relationType: RelationType.MANY_TO_ONE, onDelete: OnDeleteAction.SET_NULL, joinColumnName: 'dossierId' },
});
