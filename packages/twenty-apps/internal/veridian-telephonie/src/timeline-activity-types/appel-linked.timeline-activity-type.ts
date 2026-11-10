import { defineTimelineActivityType } from 'twenty-sdk/define';

import {
  APPEL_FIELDS,
  APPEL_UNIVERSAL_IDENTIFIER,
  PERSON_ON_APPEL_UNIVERSAL_IDENTIFIER,
  APPEL_LINKED_TIMELINE_ACTIVITY_TYPE_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

// Twenty écrit seul la ligne sur la timeline de la personne quand un appel lui est rattaché (création,
// rattachement après coup, changement de personne), ancrée à son début et non au moment de l'import.
export default defineTimelineActivityType({
  universalIdentifier: APPEL_LINKED_TIMELINE_ACTIVITY_TYPE_UNIVERSAL_IDENTIFIER,
  name: 'appelLinked',
  label: 'Appel',
  icon: 'IconPhone',
  emit: {
    on: 'linked',
    objectUniversalIdentifier: APPEL_UNIVERSAL_IDENTIFIER,
    through: {
      relationFieldUniversalIdentifier: PERSON_ON_APPEL_UNIVERSAL_IDENTIFIER,
      happensAtFieldUniversalIdentifier: APPEL_FIELDS.debutLe,
    },
  },
});
