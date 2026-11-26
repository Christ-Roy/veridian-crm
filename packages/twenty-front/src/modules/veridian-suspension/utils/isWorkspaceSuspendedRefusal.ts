import { CombinedGraphQLErrors } from '@apollo/client/errors';

// Veridian (26/11/2026) : un espace suspendu refuse aussi l'identité (CONTRAT-HUB §5.4) ; le serveur répond
// FORBIDDEN, sous-code WORKSPACE_SUSPENDED. C'est ce refus qui fait afficher l'écran « suspendu ».
export const isWorkspaceSuspendedRefusal = (error: unknown): boolean =>
  CombinedGraphQLErrors.is(error) &&
  error.errors.some(
    (graphQLError) =>
      graphQLError.extensions?.subCode === 'WORKSPACE_SUSPENDED',
  );
