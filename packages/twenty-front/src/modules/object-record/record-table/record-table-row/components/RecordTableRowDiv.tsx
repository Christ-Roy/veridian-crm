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
     pendant la fenêtre d'annulation 5s (point (c)). Quand la fiche de cette row
     est en cours d'ouverture (atom global posé par VeridianRecordOpenEffect),
     RecordTableTr met data-veridian-record-opening='true' → glow bleu pulsant
     sur les cellules. S'arrête au démontage de l'attribut (confirmation OU
     annulation). Isolé : ne touche que cet état, n'altère pas focused/active. */
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
