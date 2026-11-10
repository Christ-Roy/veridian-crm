import { defineView, ViewFilterOperand, ViewSortDirection, ViewType } from 'twenty-sdk/define';

import { PERSON_ON_TEXT_MESSAGE_UNIVERSAL_IDENTIFIER, SMS_A_RATTACHER_VIEW, TEXT_MESSAGE_FIELDS, TEXT_MESSAGE_UNIVERSAL_IDENTIFIER } from '../identifiants';

// SMS et MMS sans personne, rangés par numéro (les expéditeurs nommés, « CIC », « Telegram », se regroupent aussi).
export default defineView({
  universalIdentifier: SMS_A_RATTACHER_VIEW.view,
  name: 'SMS à rattacher',
  objectUniversalIdentifier: TEXT_MESSAGE_UNIVERSAL_IDENTIFIER,
  type: ViewType.TABLE,
  icon: 'IconMessageOff',
  fields: [
    { universalIdentifier: SMS_A_RATTACHER_VIEW.fields.apercu, fieldMetadataUniversalIdentifier: TEXT_MESSAGE_FIELDS.apercu, position: 0, isVisible: true, size: 380 },
    { universalIdentifier: SMS_A_RATTACHER_VIEW.fields.numero, fieldMetadataUniversalIdentifier: TEXT_MESSAGE_FIELDS.numero, position: 1, isVisible: true, size: 160 },
    { universalIdentifier: SMS_A_RATTACHER_VIEW.fields.envoyeLe, fieldMetadataUniversalIdentifier: TEXT_MESSAGE_FIELDS.envoyeLe, position: 2, isVisible: true, size: 170 },
  ],
  filters: [
    { universalIdentifier: SMS_A_RATTACHER_VIEW.filtreSansPersonne, fieldMetadataUniversalIdentifier: PERSON_ON_TEXT_MESSAGE_UNIVERSAL_IDENTIFIER, operand: ViewFilterOperand.IS_EMPTY, value: '' },
  ],
  sorts: [
    { universalIdentifier: SMS_A_RATTACHER_VIEW.triNumero, fieldMetadataUniversalIdentifier: TEXT_MESSAGE_FIELDS.numero, direction: ViewSortDirection.ASC },
  ],
});
