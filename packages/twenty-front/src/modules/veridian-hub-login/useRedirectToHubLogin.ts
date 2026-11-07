import { useEffect } from 'react';

import { useIsLogged } from '@/auth/hooks/useIsLogged';

// Nobody signs in on Twenty itself. A full load of /welcome reaches the server, which answers
// with a redirect to the Hub. The marker stops a reload loop if that route ever goes missing.
export const useRedirectToHubLogin = () => {
  const isLogged = useIsLogged();

  useEffect(() => {
    if (!isLogged && !window.location.search.includes('hub=1')) {
      window.location.replace('/welcome?hub=1');
    }
  }, [isLogged]);
};
