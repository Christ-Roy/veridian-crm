import { defineView, ViewFilterOperand, ViewSortDirection, ViewType } from 'twenty-sdk/define';

import { APPEL_FIELDS, APPEL_UNIVERSAL_IDENTIFIER, APPELS_A_RATTACHER_VIEW, PERSON_ON_APPEL_UNIVERSAL_IDENTIFIER } from '../identifiants';

// Appels sans personne, rangés par numéro : les mêmes inconnus se suivent, on voit qui créer en contact.
export default defineView({
  universalIdentifier: APPELS_A_RATTACHER_VIEW.view,
  name: 'Appels à rattacher',
  objectUniversalIdentifier: APPEL_UNIVERSAL_IDENTIFIER,
  type: ViewType.TABLE,
  icon: 'IconPhoneOff',
  fields: [
    { universalIdentifier: APPELS_A_RATTACHER_VIEW.fields.titre, fieldMetadataUniversalIdentifier: APPEL_FIELDS.titre, position: 0, isVisible: true, size: 170 },
    { universalIdentifier: APPELS_A_RATTACHER_VIEW.fields.numero, fieldMetadataUniversalIdentifier: APPEL_FIELDS.numero, position: 1, isVisible: true, size: 160 },
    { universalIdentifier: APPELS_A_RATTACHER_VIEW.fields.nomSurTelephone, fieldMetadataUniversalIdentifier: APPEL_FIELDS.nomSurTelephone, position: 2, isVisible: true, size: 220 },
    { universalIdentifier: APPELS_A_RATTACHER_VIEW.fields.debutLe, fieldMetadataUniversalIdentifier: APPEL_FIELDS.debutLe, position: 3, isVisible: true, size: 170 },
  ],
  filters: [
    { universalIdentifier: APPELS_A_RATTACHER_VIEW.filtreSansPersonne, fieldMetadataUniversalIdentifier: PERSON_ON_APPEL_UNIVERSAL_IDENTIFIER, operand: ViewFilterOperand.IS_EMPTY, value: '' },
  ],
  sorts: [
    { universalIdentifier: APPELS_A_RATTACHER_VIEW.triNumero, fieldMetadataUniversalIdentifier: APPEL_FIELDS.numero, direction: ViewSortDirection.ASC },
    { universalIdentifier: APPELS_A_RATTACHER_VIEW.triDate, fieldMetadataUniversalIdentifier: APPEL_FIELDS.debutLe, direction: ViewSortDirection.DESC },
  ],
});
