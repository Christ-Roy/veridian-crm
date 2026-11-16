import { type defineConnectionProvider } from 'twenty-sdk/define';

type ConfigOAuth = Extract<Parameters<typeof defineConnectionProvider>[0], { type: 'oauth' }>['oauth'];

// Scopes minimaux : créer des événements avec Meet (calendar.events) et lire les séances, participants,
// enregistrements et transcriptions (meetings.space.readonly). openid + email : Twenty nomme la connexion.
// access_type=offline + prompt=consent : Google rend un jeton de rafraîchissement, que Twenty fait tourner.
// 🔴 Pas de revokeEndpoint ni d'include_granted_scopes : le client OAuth est celui de la synchro mail et agenda
// du CRM ; chez Google, révoquer un jeton révoque TOUT l'accord du compte à ce client (la synchro tomberait), et
// include_granted_scopes ferait hériter ce jeton des scopes Gmail de la synchro.
export const OAUTH_GOOGLE: ConfigOAuth = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  scopes: [
    'openid',
    'email',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/meetings.space.readonly',
  ],
  clientIdVariable: 'GOOGLE_CLIENT_ID',
  clientSecretVariable: 'GOOGLE_CLIENT_SECRET',
  authorizationParams: { access_type: 'offline', prompt: 'consent select_account' },
  tokenRequestContentType: 'form-urlencoded',
  usePkce: true,
};
