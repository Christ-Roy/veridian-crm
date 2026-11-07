// Don't use this hook directly! Prefer the high level hooks like:
// useRedirectToDefaultDomain and useRedirectToWorkspaceDomain

import { createSingleNavigation } from 'twenty-shared/utils';
import { useDebouncedCallback } from 'use-debounce';

const navigate = createSingleNavigation((url, target) => {
  window.open(url, target);
});

export const useRedirect = () => {
  const redirect = useDebouncedCallback(navigate, 1);

  return {
    redirect,
  };
};
