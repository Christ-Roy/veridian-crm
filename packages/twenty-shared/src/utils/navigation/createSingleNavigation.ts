// Veridian : relancer la même navigation à chaque rendu annule la précédente, sans fin
// sur le domaine nu dès que le serveur met plus d'un rendu à répondre.
export const createSingleNavigation = (
  open: (url: string, target: string) => void,
) => {
  let navigatingToUrl: string | undefined;

  return (url: string, target?: string) => {
    if (target !== undefined) {
      open(url, target);

      return;
    }

    if (url === navigatingToUrl) {
      return;
    }

    navigatingToUrl = url;
    open(url, '_self');
  };
};
