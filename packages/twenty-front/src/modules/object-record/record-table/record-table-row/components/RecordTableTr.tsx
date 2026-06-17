import { getBasePathToShowPage } from '@/object-metadata/utils/getBasePathToShowPage';
import { useIsRecordReadOnly } from '@/object-record/read-only/hooks/useIsRecordReadOnly';
import { useRecordTableContextOrThrow } from '@/object-record/record-table/contexts/RecordTableContext';
import { RecordTableRowContextProvider } from '@/object-record/record-table/contexts/RecordTableRowContext';
import { RecordTableRowDiv } from '@/object-record/record-table/record-table-row/components/RecordTableRowDiv';
import { isRowSelectedComponentFamilyState } from '@/object-record/record-table/record-table-row/states/isRowSelectedComponentFamilyState';
import { isRecordTableRowActiveComponentFamilyState } from '@/object-record/record-table/states/isRecordTableRowActiveComponentFamilyState';
import { isRecordTableRowFocusActiveComponentState } from '@/object-record/record-table/states/isRecordTableRowFocusActiveComponentState';
import { isRecordTableRowFocusedComponentFamilyState } from '@/object-record/record-table/states/isRecordTableRowFocusedComponentFamilyState';

import { useAtomComponentFamilyStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentFamilyStateValue';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
// Veridian PATCH INLINE (cf VERIDIAN-PATCHES.md) : mécanique "ouverture de fiche"
import { veridianPendingOpenKeysState } from '@/veridian-record-open/states/veridianPendingOpenKeysState';
import { buildRecordOpenKey } from '@/veridian-record-open/utils/recordOpenManager';
import { forwardRef, type ReactNode } from 'react';

type RecordTableTrProps = {
  children: ReactNode;
  recordId: string;
  focusIndex: number;
  isDragging?: boolean;
} & Omit<
  React.ComponentProps<typeof RecordTableRowDiv>,
  'isActive' | 'isNextRowActiveOrFocused' | 'isFocused'
>;

export const RecordTableTr = forwardRef<HTMLDivElement, RecordTableTrProps>(
  ({ children, recordId, focusIndex, isDragging = false, ...props }, ref) => {
    const { objectMetadataItem } = useRecordTableContextOrThrow();

    const isRowSelected = useAtomComponentFamilyStateValue(
      isRowSelectedComponentFamilyState,
      recordId,
    );

    const isRecordTableRowActive = useAtomComponentFamilyStateValue(
      isRecordTableRowActiveComponentFamilyState,
      focusIndex,
    );

    const isRecordTableRowFocused = useAtomComponentFamilyStateValue(
      isRecordTableRowFocusedComponentFamilyState,
      focusIndex,
    );

    const isRecordTableRowFocusActive = useAtomComponentStateValue(
      isRecordTableRowFocusActiveComponentState,
    );

    const isRecordReadOnly = useIsRecordReadOnly({
      recordId,
      objectMetadataId: objectMetadataItem.id,
    });

    // Veridian PATCH INLINE (cf VERIDIAN-PATCHES.md) : la ligne SCINTILLE pendant
    // le décompte de confirmation 10s de SA fiche (déclenché à la FERMETURE).
    // Le `recordOpenManager` (module-level) ajoute l'openKey de la fiche fermée
    // à l'atom global `veridianPendingOpenKeysState` (Set) pendant le décompte ;
    // on teste l'appartenance de l'openKey de cette row pour piloter
    // `data-veridian-record-opening` (l'animation CSS vit dans `RecordTableRowDiv`).
    // Lecture seule, isolée. (Set : plusieurs fiches peuvent décompter en
    // parallèle si on navigue, cf le state.)
    const veridianPendingOpenKeys = useAtomStateValue(
      veridianPendingOpenKeysState,
    );
    const isVeridianRecordOpening = veridianPendingOpenKeys.has(
      buildRecordOpenKey(objectMetadataItem.nameSingular, recordId),
    );

    return (
      <RecordTableRowContextProvider
        value={{
          recordId: recordId,
          rowIndex: focusIndex,
          pathToShowPage:
            getBasePathToShowPage({
              objectNameSingular: objectMetadataItem.nameSingular,
            }) + recordId,
          objectNameSingular: objectMetadataItem.nameSingular,
          isSelected: isRowSelected,
          isRecordReadOnly,
        }}
      >
        <RecordTableRowDiv
          className="table-row"
          isDragging={isDragging}
          ref={ref}
          data-active={isRecordTableRowActive}
          data-focused={
            isRecordTableRowFocusActive &&
            isRecordTableRowFocused &&
            !isRecordTableRowActive
          }
          // Veridian PATCH INLINE (cf VERIDIAN-PATCHES.md) : décompte de
          // confirmation en cours sur cette fiche (fermée il y a < 10s) → la row
          // scintille (CSS dans RecordTableRowDiv) ; re-cliquer dessus annule.
          data-veridian-record-opening={isVeridianRecordOpening}
          // oxlint-disable-next-line react/jsx-props-no-spreading
          {...props}
        >
          {children}
        </RecordTableRowDiv>
      </RecordTableRowContextProvider>
    );
  },
);
