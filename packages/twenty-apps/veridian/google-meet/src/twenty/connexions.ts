import { FOURNISSEUR_ESPACE, FOURNISSEUR_UTILISATEUR } from '../identifiants';
import type { ConnexionGoogle } from '../types/meet.types';
import { choisirConnexion, type ChoixConnexion } from '../utils/choisir-connexion.util';
import { graphql } from './graphql';

// Connexions Google de l'app (jetons OAuth tenus et rafraîchis par Twenty). Le serveur ne rend au membre que
// ses propres connexions USER et les connexions WORKSPACE.

const LISTE = `query { appConnections { id providerName handle scope userWorkspaceId accessToken authFailedAt } }`;

const SIGNALER = `mutation Signaler($input: ReportAppConnectionAuthFailureInput!) { reportAppConnectionAuthFailure(input: $input) }`;

export const listerConnexions = async (): Promise<ConnexionGoogle[]> => {
  const d = await graphql<{ appConnections: ConnexionGoogle[] }>('metadata', LISTE);
  return d.appConnections.filter((c) => c.providerName === FOURNISSEUR_UTILISATEUR || c.providerName === FOURNISSEUR_ESPACE);
};

export const connexionPourMoi = async (): Promise<ChoixConnexion> => choisirConnexion(await listerConnexions());

// Google a refusé le jeton : Twenty marque la connexion en échec et propose « Reconnecter » dans les réglages.
export const signalerEchecAuth = async (connexionId: string, raison: string): Promise<void> => {
  await graphql<unknown>('metadata', SIGNALER, { input: { id: connexionId, reason: raison.slice(0, 500) } });
};
