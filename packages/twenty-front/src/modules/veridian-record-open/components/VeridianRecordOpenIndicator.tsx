// Veridian — module AGPL (fork twentyhq/twenty). Mécanique "ouverture de fiche".
//
// Indicateur visuel de la FENÊTRE D'ANNULATION 5 s (cf VISION §4.1.3) : pendant
// que le timer tourne, un commercial peut re-cliquer / refermer pour ANNULER
// (= le prospect n'a pas décroché, la fiche reste "À appeler"). L'animation
// signale "il se passe quelque chose, re-clique pour annuler" et se résorbe sur
// la durée exacte du timer.
//
// Rendu :
//   - un GLOW de bordure interne qui pulse (attire l'œil, signale l'état actif) ;
//   - une BARRE DE PROGRESSION fine en haut qui se vide sur la durée du timer
//     (countdown visuel des 5 s).
//
// Le composant ne porte AUCUNE logique métier (ni timer, ni écriture) : il est
// monté/démonté par `VeridianRecordOpenEffect` exactement pendant la fenêtre. Le
// démontage (annulation OU confirmation) suffit à arrêter l'animation.
//
// CSS : Linaria (`@linaria/react`, extraction build-time) avec `@keyframes`
// inline dans le template `styled` + tokens `themeCssVariables` — exactement le
// pattern du front Twenty (cf `ai/components/ShimmeringText.tsx`). La durée vient
// d'une CSS custom property `--veridian-open-duration` posée en inline-style → la
// constante JS VERIDIAN_RECORD_OPEN_DELAY_MS reste l'unique source de vérité
// (pas de "5000" dupliqué en CSS).

import { styled } from '@linaria/react';
import { type CSSProperties } from 'react';
import { themeCssVariables } from 'twenty-ui-deprecated/theme-constants';

import { VERIDIAN_RECORD_OPEN_DELAY_MS } from '@/veridian-record-open/utils/buildRecordOpenInput';

const StyledOverlay = styled.div`
  animation: veridian-open-glow-pulse 1.4s ease-in-out infinite;
  border-radius: inherit;
  bottom: 0;
  left: 0;
  pointer-events: none;
  position: absolute;
  right: 0;
  top: 0;
  z-index: 2;

  @keyframes veridian-open-glow-pulse {
    0% {
      box-shadow:
        inset 0 0 0 1px ${themeCssVariables.color.blue},
        inset 0 0 12px 0 ${themeCssVariables.background.transparent.blue};
      opacity: 0.9;
    }
    50% {
      box-shadow:
        inset 0 0 0 2px ${themeCssVariables.color.blue},
        inset 0 0 22px 2px ${themeCssVariables.background.transparent.blue};
      opacity: 1;
    }
    100% {
      box-shadow:
        inset 0 0 0 1px ${themeCssVariables.color.blue},
        inset 0 0 12px 0 ${themeCssVariables.background.transparent.blue};
      opacity: 0.9;
    }
  }
`;

const StyledProgressTrack = styled.div`
  height: 3px;
  left: 0;
  overflow: hidden;
  pointer-events: none;
  position: absolute;
  right: 0;
  top: 0;
  z-index: 3;
`;

const StyledProgressBar = styled.div`
  animation: veridian-open-progress-drain
    var(--veridian-open-duration, 5000ms) linear forwards;
  background: ${themeCssVariables.color.blue};
  height: 100%;
  transform-origin: left center;
  width: 100%;

  @keyframes veridian-open-progress-drain {
    from {
      transform: scaleX(1);
    }
    to {
      transform: scaleX(0);
    }
  }
`;

/**
 * Overlay d'animation de la fenêtre d'annulation. Se positionne en absolu DANS
 * un conteneur `position: relative` (le wrapper monté par l'Effect). N'a pas
 * d'état : sa présence = fenêtre active, son démontage = fin (annulée OU
 * confirmée).
 */
export const VeridianRecordOpenIndicator = () => {
  const durationStyle: Record<string, string> = {
    '--veridian-open-duration': `${VERIDIAN_RECORD_OPEN_DELAY_MS}ms`,
  };

  return (
    <div
      aria-hidden="true"
      data-testid="veridian-record-open-indicator"
      style={durationStyle as CSSProperties}
    >
      <StyledOverlay />
      <StyledProgressTrack>
        <StyledProgressBar />
      </StyledProgressTrack>
    </div>
  );
};
