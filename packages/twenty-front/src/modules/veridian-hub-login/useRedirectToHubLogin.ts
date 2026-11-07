import { useEffect } from 'react';

import { useIsLogged } from '@/auth/hooks/useIsLogged';
import { useReturnToPath } from '@/auth/hooks/useReturnToPath';

// Nobody signs in on Twenty itself. A full load of /welcome reaches the server, which applies
// CONTRAT-HUB §6bis.8.0. The marker stops a reload loop if that route ever goes missing.
export const useRedirectToHubLogin = () => {
  const isLogged = useIsLogged();
  const { getReturnToPath } = useReturnToPath();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (isLogged || params.has('hub') || window.self !== window.top) {
      return;
    }

    // PageChangeEffect keeps the requested page in this state before sending here.
    const returnToPath = getReturnToPath() ?? params.get('returnToPath') ?? '';
    const next = `${window.location.origin}${returnToPath}`;

    window.location.replace(`/welcome?hub=1&next=${encodeURIComponent(next)}`);
  }, [getReturnToPath, isLogged]);
};
