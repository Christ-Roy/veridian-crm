import { defineField, FieldType, RelationType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import {
  DOSSIER_UNIVERSAL_IDENTIFIER,
  RANGEMENT_ON_TASK_UNIVERSAL_IDENTIFIER,
  TACHES_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

export default defineField({
  universalIdentifier: TACHES_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: DOSSIER_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'taches',
  label: 'Tâches',
  icon: 'IconCheckbox',
  relationTargetObjectMetadataUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.task.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier: RANGEMENT_ON_TASK_UNIVERSAL_IDENTIFIER,
  universalSettings: { relationType: RelationType.ONE_TO_MANY },
});
