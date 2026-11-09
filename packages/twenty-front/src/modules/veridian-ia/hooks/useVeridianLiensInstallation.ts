import { useEffect, useState } from 'react';

import { REACT_APP_SERVER_BASE_URL } from '~/config';

// Read through our own server, which validates the Hub links and answers `disponible: false`
// when the Hub is down: the buttons then stay hidden instead of leading nowhere.
export type VeridianAssistant = {
  cle: string;
  libelle: string;
  installation: string;
  etape: string | null;
};

export type VeridianLiensInstallation = {
  url: string;
  assistants: VeridianAssistant[];
  claudeCode: string;
  phrase: string;
};

export type VeridianLiensEtat = 'chargement' | 'indisponible' | 'pret';

export const useVeridianLiensInstallation = () => {
  const [liens, setLiens] = useState<VeridianLiensInstallation | null>(null);
  const [etat, setEtat] = useState<VeridianLiensEtat>('chargement');

  useEffect(() => {
    let isCancelled = false;

    fetch(`${REACT_APP_SERVER_BASE_URL}/veridian/ia/liens`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (isCancelled) {
          return;
        }

        if (body?.disponible === true) {
          setLiens(body as VeridianLiensInstallation);
          setEtat('pret');
        } else {
          setEtat('indisponible');
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setEtat('indisponible');
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  return { liens, etat };
};
