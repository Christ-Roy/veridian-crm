import { defineCommandMenuItem, isSelectAll } from 'twenty-sdk/define';

import {
  COMMANDE_MEET_DOSSIER_UNIVERSAL_IDENTIFIER,
  DOSSIER_OBJECT_UNIVERSAL_IDENTIFIER,
  PANNEAU_MEET_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

// « Créer un Meet », épinglé dans l'en-tête d'un Dossier (objet de l'app Dossiers Veridian).
export default defineCommandMenuItem({
  universalIdentifier: COMMANDE_MEET_DOSSIER_UNIVERSAL_IDENTIFIER,
  label: 'Créer un Meet',
  shortLabel: 'Meet',
  isPinned: true,
  availabilityType: 'RECORD_SELECTION',
  availabilityObjectUniversalIdentifier: DOSSIER_OBJECT_UNIVERSAL_IDENTIFIER,
  frontComponentUniversalIdentifier: PANNEAU_MEET_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  conditionalAvailabilityExpression: !isSelectAll,
});
