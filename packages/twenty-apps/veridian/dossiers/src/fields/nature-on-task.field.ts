import { defineField, FieldType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { NATURE_ON_TASK_UNIVERSAL_IDENTIFIER, NATURE_OPTION_IDS } from '../identifiants';
import { optionsNature } from '../utils/nature.util';

// Obligatoire. HUMAIN par défaut : une tâche non classée tombe dans la liste de Robert, où elle se voit.
export default defineField({
  universalIdentifier: NATURE_ON_TASK_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.task.universalIdentifier,
  type: FieldType.SELECT,
  name: 'nature',
  label: 'Nature',
  description: 'Obligatoire. Robert : temps humain réel (rendez-vous, appels, décisions). Production : exécuté par des agents ou des IA',
  icon: 'IconUserBolt',
  isNullable: false,
  defaultValue: "'HUMAIN'",
  options: optionsNature(NATURE_OPTION_IDS),
});
