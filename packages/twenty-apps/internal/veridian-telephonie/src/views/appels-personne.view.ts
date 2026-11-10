import { defineView, ViewFilterOperand, ViewSortDirection, ViewType } from 'twenty-sdk/define';

import { APPELS_PERSONNE_VIEW, APPEL_FIELDS, APPEL_UNIVERSAL_IDENTIFIER, PERSON_ON_APPEL_UNIVERSAL_IDENTIFIER } from '../identifiants';

// Colonnes de l'onglet Appels de la fiche Person. Visible de tout le workspace : une vue UNLISTED n'est pas servie au navigateur, le tableau resterait vide.
export default defineView({
  universalIdentifier: APPELS_PERSONNE_VIEW.view,
  name: "Appels d'une personne",
  objectUniversalIdentifier: APPEL_UNIVERSAL_IDENTIFIER,
  type: ViewType.TABLE,
  icon: 'IconPhone',
  fields: [
    { universalIdentifier: APPELS_PERSONNE_VIEW.fields.titre, fieldMetadataUniversalIdentifier: APPEL_FIELDS.titre, position: 0, isVisible: true, size: 180 },
    { universalIdentifier: APPELS_PERSONNE_VIEW.fields.debutLe, fieldMetadataUniversalIdentifier: APPEL_FIELDS.debutLe, position: 1, isVisible: true, size: 170 },
    { universalIdentifier: APPELS_PERSONNE_VIEW.fields.enregistrement, fieldMetadataUniversalIdentifier: APPEL_FIELDS.enregistrement, position: 2, isVisible: true, size: 200 },
    { universalIdentifier: APPELS_PERSONNE_VIEW.fields.transcription, fieldMetadataUniversalIdentifier: APPEL_FIELDS.transcription, position: 3, isVisible: true, size: 380 },
    { universalIdentifier: APPELS_PERSONNE_VIEW.fields.canal, fieldMetadataUniversalIdentifier: APPEL_FIELDS.canal, position: 4, isVisible: true, size: 120 },
  ],
  // Le tableau de l'onglet ne montre que les lignes de la personne affichée (filtre « fiche courante » natif).
  filters: [
    {
      universalIdentifier: APPELS_PERSONNE_VIEW.filtrePersonne,
      fieldMetadataUniversalIdentifier: PERSON_ON_APPEL_UNIVERSAL_IDENTIFIER,
      operand: ViewFilterOperand.IS,
      value: JSON.stringify({ selectedRecordIds: [], isCurrentRecordSelected: true }),
    },
  ],
  sorts: [
    { universalIdentifier: APPELS_PERSONNE_VIEW.sort, fieldMetadataUniversalIdentifier: APPEL_FIELDS.debutLe, direction: ViewSortDirection.DESC },
  ],
});
