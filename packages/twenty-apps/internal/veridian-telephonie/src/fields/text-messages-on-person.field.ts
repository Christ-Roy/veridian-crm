import {
  defineField,
  FieldType,
  RelationType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import {
  TEXT_MESSAGES_ON_PERSON_UNIVERSAL_IDENTIFIER,
  PERSON_ON_TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
  TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

export default defineField({
  universalIdentifier: TEXT_MESSAGES_ON_PERSON_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.RELATION,
  name: 'textMessages',
  label: 'SMS',
  icon: 'IconMessage',
  relationTargetObjectMetadataUniversalIdentifier: TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: PERSON_ON_TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
