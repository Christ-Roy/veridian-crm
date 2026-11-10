import { defineView, ViewFilterOperand, ViewSortDirection, ViewType } from 'twenty-sdk/define';

import { PERSON_ON_TEXT_MESSAGE_UNIVERSAL_IDENTIFIER, SMS_PERSONNE_VIEW, TEXT_MESSAGE_FIELDS, TEXT_MESSAGE_UNIVERSAL_IDENTIFIER } from '../identifiants';

// Colonnes de l'onglet SMS de la fiche Person. Visible de tout le workspace : une vue UNLISTED n'est pas servie au navigateur, le tableau resterait vide.
export default defineView({
  universalIdentifier: SMS_PERSONNE_VIEW.view,
  name: "SMS d'une personne",
  objectUniversalIdentifier: TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
  type: ViewType.TABLE,
  icon: 'IconMessage',
  fields: [
    { universalIdentifier: SMS_PERSONNE_VIEW.fields.envoyeLe, fieldMetadataUniversalIdentifier: TEXT_MESSAGE_FIELDS.envoyeLe, position: 1, isVisible: true, size: 170 },
    { universalIdentifier: SMS_PERSONNE_VIEW.fields.apercu, fieldMetadataUniversalIdentifier: TEXT_MESSAGE_FIELDS.apercu, position: 0, isVisible: true, size: 420 },
    { universalIdentifier: SMS_PERSONNE_VIEW.fields.texte, fieldMetadataUniversalIdentifier: TEXT_MESSAGE_FIELDS.texte, position: 2, isVisible: false, size: 300 },
    { universalIdentifier: SMS_PERSONNE_VIEW.fields.canal, fieldMetadataUniversalIdentifier: TEXT_MESSAGE_FIELDS.canal, position: 3, isVisible: true, size: 110 },
  ],
  // Le tableau de l'onglet ne montre que les lignes de la personne affichée (filtre « fiche courante » natif).
  filters: [
    {
      universalIdentifier: SMS_PERSONNE_VIEW.filtrePersonne,
      fieldMetadataUniversalIdentifier: PERSON_ON_TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
      operand: ViewFilterOperand.IS,
      value: JSON.stringify({ selectedRecordIds: [], isCurrentRecordSelected: true }),
    },
  ],
  sorts: [
    { universalIdentifier: SMS_PERSONNE_VIEW.sort, fieldMetadataUniversalIdentifier: TEXT_MESSAGE_FIELDS.envoyeLe, direction: ViewSortDirection.DESC },
  ],
});
