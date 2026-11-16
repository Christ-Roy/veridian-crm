import { defineCommandMenuItem, isSelectAll, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import {
  COMMANDE_MEET_SOCIETE_UNIVERSAL_IDENTIFIER,
  PANNEAU_MEET_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

// « Créer un Meet », épinglé dans l'en-tête de la fiche Société.
export default defineCommandMenuItem({
  universalIdentifier: COMMANDE_MEET_SOCIETE_UNIVERSAL_IDENTIFIER,
  label: 'Créer un Meet',
  shortLabel: 'Meet',
  isPinned: true,
  availabilityType: 'RECORD_SELECTION',
  availabilityObjectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  frontComponentUniversalIdentifier: PANNEAU_MEET_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  conditionalAvailabilityExpression: !isSelectAll,
});
