import { defineObject, FieldType } from 'twenty-sdk/define';

import { DOSSIER_FIELDS, DOSSIER_UNIVERSAL_IDENTIFIER, IMPORTANCE_OPTION_IDS } from '../identifiants';
import { optionsImportance } from '../utils/importance.util';

// Un dossier de tâches. Parent vide : dossier racine (un sujet, un client). Avec parent : sous-dossier.
// Un enregistrement par dossier : créer un dossier n'est jamais une migration de schéma.
export default defineObject({
  universalIdentifier: DOSSIER_UNIVERSAL_IDENTIFIER,
  nameSingular: 'dossier',
  namePlural: 'dossiers',
  labelSingular: 'Dossier',
  labelPlural: 'Dossiers',
  description: 'Dossier de tâches : sujet racine ou sous-dossier',
  icon: 'IconFolder',
  labelIdentifierFieldMetadataUniversalIdentifier: DOSSIER_FIELDS.nom,
  fields: [
    {
      universalIdentifier: DOSSIER_FIELDS.nom,
      type: FieldType.TEXT,
      name: 'nom',
      label: 'Nom',
      icon: 'IconAbc',
    },
    {
      universalIdentifier: DOSSIER_FIELDS.importance,
      type: FieldType.SELECT,
      name: 'importance',
      label: 'Importance',
      description: 'Obligatoire. Ordonne les dossiers dans la page Tâches',
      icon: 'IconFlag',
      isNullable: false,
      defaultValue: "'NORMALE'",
      options: optionsImportance(IMPORTANCE_OPTION_IDS.dossier),
    },
  ],
});
