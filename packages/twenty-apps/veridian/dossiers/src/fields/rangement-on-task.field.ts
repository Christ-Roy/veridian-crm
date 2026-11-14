import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import {
  DOSSIER_UNIVERSAL_IDENTIFIER,
  RANGEMENT_ON_TASK_UNIVERSAL_IDENTIFIER,
  TACHES_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

// Le dossier d'une tâche. Le nom `dossier` est déjà pris par l'ancien champ SELECT : d'où `rangement`.
// Dossier supprimé : la tâche reste, dans « Sans dossier ».
export default defineField({
  universalIdentifier: RANGEMENT_ON_TASK_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.task.universalIdentifier,
  type: FieldType.RELATION,
  name: 'rangement',
  label: 'Rangée dans',
  icon: 'IconFolder',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: DOSSIER_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: TACHES_ON_DOSSIER_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'rangementId',
  },
});
