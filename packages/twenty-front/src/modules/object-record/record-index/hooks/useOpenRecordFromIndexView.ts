import { useSidePanelMenu } from '@/side-panel/hooks/useSidePanelMenu';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { MAIN_CONTEXT_STORE_INSTANCE_ID } from '@/context-store/constants/MainContextStoreInstanceId';
import { contextStoreRecordShowParentViewComponentState } from '@/context-store/states/contextStoreRecordShowParentViewComponentState';
import { currentRecordFilterGroupsComponentState } from '@/object-record/record-filter-group/states/currentRecordFilterGroupsComponentState';
import { currentRecordFiltersComponentState } from '@/object-record/record-filter/states/currentRecordFiltersComponentState';
import { useRecordIndexContextOrThrow } from '@/object-record/record-index/contexts/RecordIndexContext';
import { recordIndexOpenRecordInState } from '@/object-record/record-index/states/recordIndexOpenRecordInState';
import { currentRecordSortsComponentState } from '@/object-record/record-sort/states/currentRecordSortsComponentState';
import { canOpenObjectInSidePanel } from '@/object-record/utils/canOpenObjectInSidePanel';
import { useAtomComponentStateCallbackState } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateCallbackState';
import { ViewOpenRecordIn } from '~/generated-metadata/graphql';
import { useStore } from 'jotai';
import { useCallback } from 'react';
import { AppPath } from 'twenty-shared/types';
import { useIsMobile } from 'twenty-ui-deprecated/utilities';
import { useNavigateApp } from '~/hooks/useNavigateApp';
// Veridian PATCH INLINE (cf VERIDIAN-PATCHES.md) : interception du RE-CLIC pour
// annuler le décompte d'ouverture SANS ré-ouvrir la fiche.
import {
  buildRecordOpenKey,
  cancelRecordOpen,
} from '@/veridian-record-open/utils/recordOpenManager';

export const useOpenRecordFromIndexView = () => {
  const { recordIndexId } = useRecordIndexContextOrThrow();

  const { objectNameSingular } = useRecordIndexContextOrThrow();

  const navigate = useNavigateApp();
  const { openRecordInSidePanel } = useOpenRecordInSidePanel();

  const isMobile = useIsMobile();

  const currentRecordFilters = useAtomComponentStateCallbackState(
    currentRecordFiltersComponentState,
    recordIndexId,
  );

  const currentRecordSorts = useAtomComponentStateCallbackState(
    currentRecordSortsComponentState,
    recordIndexId,
  );

  const currentRecordFilterGroups = useAtomComponentStateCallbackState(
    currentRecordFilterGroupsComponentState,
    recordIndexId,
  );

  const { closeSidePanelMenu } = useSidePanelMenu();

  const store = useStore();

  const openRecordFromIndexView = useCallback(
    ({ recordId }: { recordId: string }) => {
      // Veridian PATCH INLINE (cf VERIDIAN-PATCHES.md) : si cette fiche est en
      // DÉCOMPTE de confirmation (fermée il y a < 10s, elle scintille), un clic
      // dessus = le commercial veut ANNULER (fausse manip), PAS la ré-ouvrir.
      // On consomme le clic : annule le décompte (la row arrête de scintiller,
      // la fiche reste A_APPELER) et on RETURN sans ouvrir. C'est le SEUL
      // chokepoint d'ouverture depuis un index (table/board/calendar y passent).
      const veridianOpenKey = buildRecordOpenKey(objectNameSingular, recordId);
      if (cancelRecordOpen(veridianOpenKey)) {
        return;
      }

      const recordIndexOpenRecordIn = store.get(
        recordIndexOpenRecordInState.atom,
      );

      const parentViewFilters = store.get(currentRecordFilters);

      const parentViewSorts = store.get(currentRecordSorts);

      const parentViewFilterGroups = store.get(currentRecordFilterGroups);

      store.set(
        contextStoreRecordShowParentViewComponentState.atomFamily({
          instanceId: MAIN_CONTEXT_STORE_INSTANCE_ID,
        }),
        {
          parentViewComponentId: recordIndexId,
          parentViewObjectNameSingular: objectNameSingular,
          parentViewFilterGroups,
          parentViewFilters,
          parentViewSorts,
        },
      );

      if (
        !isMobile &&
        recordIndexOpenRecordIn === ViewOpenRecordIn.SIDE_PANEL &&
        canOpenObjectInSidePanel(objectNameSingular)
      ) {
        openRecordInSidePanel({
          recordId,
          objectNameSingular,
          resetNavigationStack: true,
        });
      } else {
        closeSidePanelMenu();
        navigate(AppPath.RecordShowPage, {
          objectNameSingular,
          objectRecordId: recordId,
        });
      }
    },
    [
      currentRecordFilters,
      currentRecordSorts,
      currentRecordFilterGroups,
      recordIndexId,
      objectNameSingular,
      navigate,
      openRecordInSidePanel,
      isMobile,
      closeSidePanelMenu,
      store,
    ],
  );

  return { openRecordFromIndexView };
};
