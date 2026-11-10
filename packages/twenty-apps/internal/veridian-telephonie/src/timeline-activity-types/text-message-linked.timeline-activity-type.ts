import { defineTimelineActivityType } from 'twenty-sdk/define';

import {
  TEXT_MESSAGE_FIELDS,
  TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
  PERSON_ON_TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
  TEXT_MESSAGE_LINKED_TIMELINE_ACTIVITY_TYPE_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

// Twenty écrit seul la ligne sur la timeline de la personne quand un SMS lui est rattaché (création,
// rattachement après coup, changement de personne), ancrée à sa date et non au moment de l'import.
export default defineTimelineActivityType({
  universalIdentifier: TEXT_MESSAGE_LINKED_TIMELINE_ACTIVITY_TYPE_UNIVERSAL_IDENTIFIER,
  name: 'textMessageLinked',
  label: 'SMS',
  icon: 'IconMessage',
  emit: {
    on: 'linked',
    objectUniversalIdentifier: TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
    through: {
      relationFieldUniversalIdentifier: PERSON_ON_TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
      happensAtFieldUniversalIdentifier: TEXT_MESSAGE_FIELDS.envoyeLe,
    },
  },
});
