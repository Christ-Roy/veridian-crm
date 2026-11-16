import { defineConnectionProvider } from 'twenty-sdk/define';

import { CONNEXION_ESPACE_UNIVERSAL_IDENTIFIER, FOURNISSEUR_ESPACE } from '../identifiants';
import { OAUTH_GOOGLE } from './oauth-google';

// Compte Google partagé de l'espace : se connecte dans Réglages > Applications > Google Meet > Connexions.
// Utilisé quand le membre n'a pas branché son propre compte.
export default defineConnectionProvider({
  universalIdentifier: CONNEXION_ESPACE_UNIVERSAL_IDENTIFIER,
  name: FOURNISSEUR_ESPACE,
  displayName: 'Google Agenda et Meet',
  type: 'oauth',
  scope: 'WORKSPACE',
  oauth: OAUTH_GOOGLE,
});
