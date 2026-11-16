import { defineConnectionProvider } from 'twenty-sdk/define';

import { CONNEXION_UTILISATEUR_UNIVERSAL_IDENTIFIER, FOURNISSEUR_UTILISATEUR } from '../identifiants';
import { OAUTH_GOOGLE } from './oauth-google';

// Le compte Google de chaque membre (Réglages > Utilisateur > Préférences des apps). Prioritaire sur le compte
// partagé : un Meet se crée dans l'agenda de celui qui clique.
export default defineConnectionProvider({
  universalIdentifier: CONNEXION_UTILISATEUR_UNIVERSAL_IDENTIFIER,
  name: FOURNISSEUR_UTILISATEUR,
  displayName: 'Google (mon agenda)',
  type: 'oauth',
  scope: 'USER',
  oauth: OAUTH_GOOGLE,
});
