import { styled } from '@linaria/react';
import { themeCssVariables } from 'twenty-ui-deprecated/theme-constants';

const StyledTr = styled.div<{
  isDragging: boolean;
}>`
  border-top: ${({ isDragging }) =>
    isDragging ? `1px solid ${themeCssVariables.border.color.medium}` : 'none'};

  display: flex;
  flex-direction: row;

  &[data-focused='true'],
  &[data-active='true'] {
    div.table-cell,
    div.table-cell-0-0 {
      &:not(:first-of-type) {
        background-color: ${themeCssVariables.accent.quaternary};
        border-bottom: 1px solid ${themeCssVariables.border.color.medium};
        border-color: ${themeCssVariables.border.color.medium};
      }
      &:nth-of-type(2) {
        border-left: 1px solid ${themeCssVariables.border.color.medium};

        margin-left: -1px;

        div {
          margin-left: -1px;
        }
      }
      &:last-of-type {
        border-radius: 0 ${themeCssVariables.border.radius.sm}
          ${themeCssVariables.border.radius.sm} 0;
        border-right: 1px solid ${themeCssVariables.border.color.medium};
      }
    }
  }

  /* Veridian PATCH INLINE (cf VERIDIAN-PATCHES.md) : animation de la LIGNE
     pendant le DÉCOMPTE de confirmation 10s (déclenché à la FERMETURE de la
     fiche). Quand la fiche de cette row est en décompte (openKey présent dans
     l'atom global `veridianPendingOpenKeysState` posé par le recordOpenManager),
     RecordTableTr met data-veridian-record-opening='true' → glow bleu pulsant
     sur les cellules → invite à re-cliquer pour annuler. S'arrête à la fin du
     décompte (confirmation) OU à l'annulation (re-clic). Isolé : ne touche que
     cet état, n'altère pas focused/active. */
  &[data-veridian-record-opening='true'] {
    div.table-cell,
    div.table-cell-0-0 {
      &:not(:first-of-type) {
        animation: veridian-row-open-pulse 1.4s ease-in-out infinite;
      }
    }
  }

  @keyframes veridian-row-open-pulse {
    0% {
      background-color: ${themeCssVariables.background.transparent.blue};
      box-shadow: inset 0 0 0 0 ${themeCssVariables.color.blue};
    }
    50% {
      background-color: ${themeCssVariables.background.transparent.blue};
      box-shadow: inset 2px 0 0 0 ${themeCssVariables.color.blue};
    }
    100% {
      background-color: ${themeCssVariables.background.transparent.blue};
      box-shadow: inset 0 0 0 0 ${themeCssVariables.color.blue};
    }
  }
`;

export const RecordTableRowDiv = StyledTr;
