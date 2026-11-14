import { defineField, FieldType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import { IMPORTANCE_ON_TASK_UNIVERSAL_IDENTIFIER, IMPORTANCE_OPTION_IDS } from '../identifiants';
import { optionsImportance } from '../utils/importance.util';

// Obligatoire : non nul, NORMALE par défaut (les tâches existantes la reçoivent à l'installation).
export default defineField({
  universalIdentifier: IMPORTANCE_ON_TASK_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.task.universalIdentifier,
  type: FieldType.SELECT,
  name: 'importance',
  label: 'Importance',
  description: 'Obligatoire. Ordonne les tâches dans leur dossier',
  icon: 'IconFlag',
  isNullable: false,
  defaultValue: "'NORMALE'",
  options: optionsImportance(IMPORTANCE_OPTION_IDS.task),
});
