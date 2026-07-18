import { renderHook } from '@testing-library/react';

// Veridian PATCH-SURVIVAL (cf VERIDIAN-PATCHES.md) : useOpenRecordFromIndexView
// est le CHOKEPOINT d'ouverture d'une fiche depuis un index (table/board/
// calendar y passent tous). Le patch inline DOIT intercepter le RE-CLIC sur une
// fiche EN DÉCOMPTE (fermée il y a < 10s, elle scintille) : annuler le décompte
// (cancelRecordOpen) ET consommer le clic → la fiche NE se ré-ouvre PAS (pas de
// side-panel, pas de navigation). Si un sync upstream réécrit ce hook et efface
// le patch, ce test casse — pas la prod.
//
// On garde le VRAI recordOpenManager (c'est lui qui dit si une fiche est en
// décompte) ; on neutralise tout le reste du graphe natif du hook par des
// marqueurs, et on observe l'effet d'ouverture via les spies navigate /
// openRecordInSidePanel.

const mockObjectNameSingular = 'company';

const mockNavigate = jest.fn();
const mockOpenRecordInSidePanel = jest.fn();
const mockCloseSidePanelMenu = jest.fn();

jest.mock('@/object-record/record-index/contexts/RecordIndexContext', () => ({
  useRecordIndexContextOrThrow: () => ({
    recordIndexId: 'index-1',
    objectNameSingular: mockObjectNameSingular,
  }),
}));
jest.mock('~/hooks/useNavigateApp', () => ({
  useNavigateApp: () => mockNavigate,
}));
jest.mock('@/side-panel/hooks/useOpenRecordInSidePanel', () => ({
  useOpenRecordInSidePanel: () => ({
    openRecordInSidePanel: mockOpenRecordInSidePanel,
  }),
}));
jest.mock('@/side-panel/hooks/useSidePanelMenu', () => ({
  useSidePanelMenu: () => ({ closeSidePanelMenu: mockCloseSidePanelMenu }),
}));
jest.mock('twenty-ui/utilities', () => ({ useIsMobile: () => false }));
jest.mock(
  '@/ui/utilities/state/jotai/hooks/useAtomComponentStateCallbackState',
  () => ({ useAtomComponentStateCallbackState: () => ({}) }),
);
jest.mock('@/object-record/utils/canOpenObjectInSidePanel', () => ({
  canOpenObjectInSidePanel: () => true,
}));
// Atoms / constants référencés mais non lus directement (marqueurs neutres).
jest.mock(
  '@/object-record/record-index/states/recordIndexOpenRecordInState',
  () => ({ recordIndexOpenRecordInState: { atom: {} } }),
);
jest.mock(
  '@/object-record/record-filter/states/currentRecordFiltersComponentState',
  () => ({ currentRecordFiltersComponentState: {} }),
);
jest.mock(
  '@/object-record/record-sort/states/currentRecordSortsComponentState',
  () => ({ currentRecordSortsComponentState: {} }),
);
jest.mock(
  '@/object-record/record-filter-group/states/currentRecordFilterGroupsComponentState',
  () => ({ currentRecordFilterGroupsComponentState: {} }),
);
jest.mock(
  '@/context-store/states/contextStoreRecordShowParentViewComponentState',
  () => ({
    contextStoreRecordShowParentViewComponentState: { atomFamily: () => ({}) },
  }),
);
jest.mock('@/context-store/constants/MainContextStoreInstanceId', () => ({
  MAIN_CONTEXT_STORE_INSTANCE_ID: 'main',
}));
jest.mock('~/generated-metadata/graphql', () => ({
  ViewOpenRecordIn: { SIDE_PANEL: 'SIDE_PANEL', RECORD_PAGE: 'RECORD_PAGE' },
}));
// Upstream (sync 2026-07-18) a déplacé l'enum `SidePanelPages` dans
// `twenty-shared/types` ; `sidePanelPageState.ts` (tiré transitivement par le
// hook) lit `SidePanelPages.CommandMenuDisplay` au chargement du module. Un mock
// qui n'exporte QUE `AppPath` rend l'enum `undefined` → "suite failed to run".
// On spread le vrai module (enums purs, sans dép lourde) et on garde le stub
// AppPath minimal dont le hook a besoin.
jest.mock('twenty-shared/types', () => ({
  ...jest.requireActual('twenty-shared/types'),
  AppPath: { RecordShowPage: 'RecordShowPage' },
}));

// store.get(recordIndexOpenRecordInState.atom) → 'RECORD_PAGE' (navigation) pour
// simplifier l'observation : on n'a besoin que de savoir SI on ouvre, pas où.
jest.mock('jotai', () => ({
  ...jest.requireActual('jotai'),
  useStore: () => ({ get: () => 'RECORD_PAGE', set: () => undefined }),
}));

import { useOpenRecordFromIndexView } from '@/object-record/record-index/hooks/useOpenRecordFromIndexView';
import {
  __resetRecordOpenManagerForTests,
  buildRecordOpenKey,
  isRecordOpenPending,
  scheduleRecordOpen,
} from '@/veridian-record-open/utils/recordOpenManager';

describe('useOpenRecordFromIndexView (Veridian re-clic = annule sans ré-ouvrir)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockNavigate.mockClear();
    mockOpenRecordInSidePanel.mockClear();
    mockCloseSidePanelMenu.mockClear();
    __resetRecordOpenManagerForTests();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('ouvre normalement une fiche qui n\'est PAS en décompte', () => {
    const { result } = renderHook(() => useOpenRecordFromIndexView());
    result.current.openRecordFromIndexView({ recordId: 'rec-1' });

    // Pas de décompte → ouverture normale (navigation, ici RECORD_PAGE).
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockOpenRecordInSidePanel).not.toHaveBeenCalled();
  });

  it('RE-CLIC sur une fiche en décompte → ANNULE le décompte ET ne ré-ouvre PAS', () => {
    const key = buildRecordOpenKey(mockObjectNameSingular, 'rec-1');
    const write = jest.fn().mockResolvedValue(undefined);
    scheduleRecordOpen(key, write); // la fiche scintille (décompte armé)
    expect(isRecordOpenPending(key)).toBe(true);

    const { result } = renderHook(() => useOpenRecordFromIndexView());
    result.current.openRecordFromIndexView({ recordId: 'rec-1' });

    // Clic consommé : décompte annulé, AUCUNE ouverture.
    expect(isRecordOpenPending(key)).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockOpenRecordInSidePanel).not.toHaveBeenCalled();

    // Et l'annulation empêche l'écriture (la fiche reste A_APPELER).
    jest.advanceTimersByTime(60000);
    expect(write).not.toHaveBeenCalled();
  });

  it('un clic sur une AUTRE fiche pendant le décompte de rec-1 ouvre normalement (rec-2)', () => {
    const key1 = buildRecordOpenKey(mockObjectNameSingular, 'rec-1');
    scheduleRecordOpen(key1, jest.fn().mockResolvedValue(undefined));

    const { result } = renderHook(() => useOpenRecordFromIndexView());
    result.current.openRecordFromIndexView({ recordId: 'rec-2' });

    // rec-2 n'est pas en décompte → ouverture normale ; rec-1 reste en décompte.
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(isRecordOpenPending(key1)).toBe(true);
  });
});
