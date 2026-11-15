import { defineObject, FieldType } from 'twenty-sdk/define';

import { DEPENDANCE_LIBELLE_FIELD, DEPENDANCE_UNIVERSAL_IDENTIFIER } from '../identifiants';

// Lien de dépendance entre deux tâches : `tache` ne peut avancer qu'une fois `prerequis` faite.
// Objet de liaison : une tâche peut attendre plusieurs prérequis (Twenty n'a pas de relation plusieurs à plusieurs).
export default defineObject({
  universalIdentifier: DEPENDANCE_UNIVERSAL_IDENTIFIER,
  nameSingular: 'dependance',
  namePlural: 'dependances',
  labelSingular: 'Dépendance',
  labelPlural: 'Dépendances',
  description: 'Une tâche attend un prérequis',
  icon: 'IconArrowsJoin',
  labelIdentifierFieldMetadataUniversalIdentifier: DEPENDANCE_LIBELLE_FIELD,
  fields: [
    { universalIdentifier: DEPENDANCE_LIBELLE_FIELD, type: FieldType.TEXT, name: 'libelle', label: 'Libellé', icon: 'IconAbc' },
  ],
});
