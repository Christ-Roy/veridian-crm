// Don't use this hook directly! Prefer the high level hooks like:
// useRedirectToDefaultDomain and useRedirectToWorkspaceDomain

import { useDebouncedCallback } from 'use-debounce';

let navigatingToUrl: string | undefined;

export const useRedirect = () => {
  const redirect = useDebouncedCallback((url: string, target?: string) => {
    // Veridian : relancer la même navigation à chaque rendu annule la précédente, sans fin
    // sur le domaine nu dès que le serveur met plus d'un rendu à répondre.
    if (target === undefined && url === navigatingToUrl) {
      return;
    }

    if (target === undefined) {
      navigatingToUrl = url;
    }

    window.open(url, target ?? '_self');
  }, 1);

  return {
    redirect,
  };
};
