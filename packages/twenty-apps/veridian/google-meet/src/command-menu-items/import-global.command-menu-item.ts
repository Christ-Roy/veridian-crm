import { defineCommandMenuItem } from 'twenty-sdk/define';

import {
  COMMANDE_IMPORT_GLOBAL_UNIVERSAL_IDENTIFIER,
  IMPORT_GLOBAL_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

// Depuis la palette (Ctrl+K), partout : importe les comptes rendus de tous les Meet passés non clos.
export default defineCommandMenuItem({
  universalIdentifier: COMMANDE_IMPORT_GLOBAL_UNIVERSAL_IDENTIFIER,
  label: 'Importer les comptes rendus Google Meet',
  shortLabel: 'Comptes rendus Meet',
  isPinned: false,
  availabilityType: 'GLOBAL',
  frontComponentUniversalIdentifier: IMPORT_GLOBAL_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
});
