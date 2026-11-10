import { defineApplicationRole } from 'twenty-sdk/define';

import { DEFAULT_ROLE_UNIVERSAL_IDENTIFIER } from '../identifiants';

// Rôle exigé par le SDK pour le code de l'app. L'app n'a ni fonction ni composant qui lise des données :
// le rôle n'accorde rien. L'ingestion passe par une clé API du workspace, avec ses propres droits.
export default defineApplicationRole({
  universalIdentifier: DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
  label: 'Téléphonie Veridian',
  description: "Rôle par défaut de l'app Téléphonie Veridian, sans droit",
  canReadAllObjectRecords: false,
  canUpdateAllObjectRecords: false,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canUpdateAllSettings: false,
  canBeAssignedToAgents: false,
  canBeAssignedToUsers: false,
  canBeAssignedToApiKeys: false,
});
