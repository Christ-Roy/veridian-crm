import { type defineConnectionProvider } from 'twenty-sdk/define';

type ConfigOAuth = Extract<Parameters<typeof defineConnectionProvider>[0], { type: 'oauth' }>['oauth'];

// Client OAuth dédié à cette app : projet Google Cloud `veridian-meet-crm` (organisation veridian.site,
// audience Interne : pas de validation Google, pas d'expiration des jetons à 7 jours).
// Scopes minimaux : créer des événements avec Meet (calendar.events) et lire les séances, participants,
// enregistrements et transcriptions (meetings.space.readonly). openid + email : Twenty nomme la connexion.
// access_type=offline + prompt=consent : Google rend un jeton de rafraîchissement, que Twenty fait tourner.
// Le client n'est partagé avec rien d'autre : révoquer à la déconnexion ne coupe que cette app.
export const OAUTH_GOOGLE: ConfigOAuth = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
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
