import { gql } from '@apollo/client';
import { useQuery } from '@apollo/client/react';

import { useIsLogged } from '@/auth/hooks/useIsLogged';
import { isWorkspaceSuspendedRefusal } from '@/veridian-suspension/utils/isWorkspaceSuspendedRefusal';

const VERIDIAN_SUSPENSION_PROBE = gql`
  query VeridianSuspensionProbe {
    currentUser {
      id
    }
  }
`;

// Une sonde légère : l'identité complète est refusée à un espace suspendu, l'écran ne peut plus la lire.
export const useIsWorkspaceSuspendedRefusal = (): boolean => {
  const isLogged = useIsLogged();
  const { error } = useQuery(VERIDIAN_SUSPENSION_PROBE, {
    skip: !isLogged,
    fetchPolicy: 'network-only',
  });

  return isWorkspaceSuspendedRefusal(error);
};
