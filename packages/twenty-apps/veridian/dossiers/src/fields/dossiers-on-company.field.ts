import { defineField, FieldType, RelationType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import {
  DOSSIER_UNIVERSAL_IDENTIFIER,
  DOSSIERS_ON_COMPANY_UNIVERSAL_IDENTIFIER,
  SOCIETE_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

export default defineField({
  universalIdentifier: DOSSIERS_ON_COMPANY_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  type: FieldType.RELATION,
  name: 'dossiers',
  label: 'Dossiers de tâches',
  icon: 'IconFolder',
  relationTargetObjectMetadataUniversalIdentifier: DOSSIER_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: SOCIETE_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
  universalSettings: { relationType: RelationType.ONE_TO_MANY },
});
