import { defineField, FieldType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { DUREE_ON_TASK_UNIVERSAL_IDENTIFIER } from '../identifiants';

export default defineField({
  universalIdentifier: DUREE_ON_TASK_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.task.universalIdentifier,
  type: FieldType.NUMBER,
  name: 'dureeEstimee',
  label: 'Durée estimée (min)',
  description: 'Temps estimé en minutes : longueur de l’événement à prévoir, et longueur de la barre du Gantt (7 h = 1 jour)',
  icon: 'IconClock',
  isNullable: true,
  defaultValue: null,
});
