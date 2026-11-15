import { defineField, FieldType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { BESOIN_AGENDA_ON_TASK_UNIVERSAL_IDENTIFIER, BESOIN_AGENDA_OPTION_IDS } from '../identifiants';
import { BESOINS_AGENDA, LIBELLES_BESOIN_AGENDA } from '../utils/nature.util';

// Prépare un événement d'agenda sans le créer : Robert (ou plus tard une IA qui propose) décide de le poser.
export default defineField({
  universalIdentifier: BESOIN_AGENDA_ON_TASK_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.task.universalIdentifier,
  type: FieldType.SELECT,
  name: 'besoinAgenda',
  label: 'Événement à prévoir',
  description: 'Aucun, rendez-vous ou appel. Préparé ici, jamais créé dans l’agenda sans l’accord de Robert',
  icon: 'IconCalendarEvent',
  isNullable: false,
  defaultValue: "'AUCUN'",
  options: BESOINS_AGENDA.map((value, position) => ({
    id: BESOIN_AGENDA_OPTION_IDS[value],
    value,
    label: LIBELLES_BESOIN_AGENDA[value],
    position,
    color: value === 'AUCUN' ? 'gray' : value === 'APPEL' ? 'blue' : 'green',
  })),
});
