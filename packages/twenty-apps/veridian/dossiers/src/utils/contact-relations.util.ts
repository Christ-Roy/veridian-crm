// La personne à contacter pour une tâche (rendez-vous ou appel à prévoir) : `task.aContacter` ↔ `person.tachesAContacter`.
import { FieldType, OnDeleteAction, RelationType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { A_CONTACTER_ON_TASK_UNIVERSAL_IDENTIFIER, TACHES_A_CONTACTER_ON_PERSON_UNIVERSAL_IDENTIFIER } from '../identifiants';

const TASK = STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.task.universalIdentifier;
const PERSON = STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier;

export const A_CONTACTER_ON_TASK = {
  universalIdentifier: A_CONTACTER_ON_TASK_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: TASK,
  type: FieldType.RELATION as FieldType.RELATION,
  name: 'aContacter',
  label: 'À contacter',
  description: 'La personne du rendez-vous ou de l’appel à prévoir',
  icon: 'IconUser',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: PERSON,
  relationTargetFieldMetadataUniversalIdentifier: TACHES_A_CONTACTER_ON_PERSON_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE as RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL as OnDeleteAction.SET_NULL,
    joinColumnName: 'aContacterId',
  },
};

export const TACHES_A_CONTACTER_ON_PERSON = {
  universalIdentifier: TACHES_A_CONTACTER_ON_PERSON_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: PERSON,
  type: FieldType.RELATION as FieldType.RELATION,
  name: 'tachesAContacter',
  label: 'Tâches où la contacter',
  icon: 'IconCheckbox',
  relationTargetObjectMetadataUniversalIdentifier: TASK,
  relationTargetFieldMetadataUniversalIdentifier: A_CONTACTER_ON_TASK_UNIVERSAL_IDENTIFIER,
  universalSettings: { relationType: RelationType.ONE_TO_MANY as RelationType.ONE_TO_MANY },
};
