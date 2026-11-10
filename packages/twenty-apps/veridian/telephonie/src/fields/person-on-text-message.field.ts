import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import {
  TEXT_MESSAGES_ON_PERSON_UNIVERSAL_IDENTIFIER,
  PERSON_ON_TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
  TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

// Côté « plusieurs » : la clé étrangère. Un numéro inconnu laisse la relation vide, jamais une personne créée.
export default defineField({
  universalIdentifier: PERSON_ON_TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION,
  name: 'person',
  label: 'Personne',
  icon: 'IconUser',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier: TEXT_MESSAGES_ON_PERSON_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: 'personId',
  },
});
