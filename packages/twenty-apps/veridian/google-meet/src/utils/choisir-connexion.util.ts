import type { ConnexionGoogle } from '../types/meet.types';

// Même règle que `findConnectionForRequest` du SDK (app Teams) : le compte du membre d'abord, sinon le compte
// partagé de l'espace. Une connexion en échec d'authentification n'est jamais utilisée : on le dit.
// Côté front, le serveur ne rend déjà que les connexions USER du membre qui regarde : `userWorkspaceId` null
// veut dire « toute connexion USER reçue est la sienne ».

export type ChoixConnexion =
  | { etat: 'OK'; connexion: ConnexionGoogle & { accessToken: string } }
  | { etat: 'A_RECONNECTER'; connexion: ConnexionGoogle }
  | { etat: 'ABSENTE' };

export const choisirConnexion = (connexions: ConnexionGoogle[], userWorkspaceId: string | null = null): ChoixConnexion => {
  const ordonnees = [
    ...connexions.filter((c) => c.scope === 'USER' && (userWorkspaceId === null || c.userWorkspaceId === userWorkspaceId)),
    ...connexions.filter((c) => c.scope === 'WORKSPACE'),
  ];
  const saine = ordonnees.find((c) => c.authFailedAt === null && typeof c.accessToken === 'string' && c.accessToken !== '');
  if (saine && saine.accessToken) return { etat: 'OK', connexion: { ...saine, accessToken: saine.accessToken } };
  if (ordonnees.length > 0) return { etat: 'A_RECONNECTER', connexion: ordonnees[0] };
  return { etat: 'ABSENTE' };
};
