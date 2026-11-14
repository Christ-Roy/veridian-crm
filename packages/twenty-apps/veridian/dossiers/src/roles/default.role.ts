import { defineApplicationRole } from 'twenty-sdk/define';

import { DEFAULT_ROLE_UNIVERSAL_IDENTIFIER } from '../identifiants';

// Le jeton du composant est l'intersection de ce rôle et de celui du membre : il lit les tâches, change leur
// statut et en crée dans un dossier. Jamais de suppression.
export default defineApplicationRole({
  universalIdentifier: DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
  label: 'Dossiers Veridian',
  description: "Rôle de l'app Dossiers : lit et modifie les tâches, ne supprime rien",
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canUpdateAllSettings: false,
  canBeAssignedToAgents: false,
  canBeAssignedToUsers: false,
  canBeAssignedToApiKeys: false,
});
