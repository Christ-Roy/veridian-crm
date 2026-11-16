import { defineApplicationRole } from 'twenty-sdk/define';

import { DEFAULT_ROLE_UNIVERSAL_IDENTIFIER } from '../identifiants';

// Le jeton du composant est l'intersection de ce rôle et de celui du membre : il lit les fiches, crée et met à
// jour réunions, notes, liens de notes et enregistrements d'appel. Jamais de suppression.
export default defineApplicationRole({
  universalIdentifier: DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
  label: 'Google Meet',
  description: "Rôle de l'app Google Meet : lit les fiches, écrit réunions, notes et enregistrements, ne supprime rien",
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canUpdateAllSettings: false,
  canBeAssignedToAgents: false,
  canBeAssignedToUsers: false,
  canBeAssignedToApiKeys: false,
});
