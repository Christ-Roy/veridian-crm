import { useEffect } from 'react';

import { useIsLogged } from '@/auth/hooks/useIsLogged';

// Nobody signs in on Twenty itself. A full load of /welcome reaches the server, which applies
// CONTRAT-HUB §6bis.8.0. The marker stops a reload loop if that route ever goes missing.
export const useRedirectToHubLogin = () => {
  const isLogged = useIsLogged();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (isLogged || params.has('hub') || window.self !== window.top) {
      return;
    }

    const next = `${window.location.origin}${params.get('returnToPath') ?? ''}`;

    window.location.replace(`/welcome?hub=1&next=${encodeURIComponent(next)}`);
  }, [isLogged]);
};
