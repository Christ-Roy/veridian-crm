import { render } from '@testing-library/react';

// Veridian PATCH-SURVIVAL (cf VERIDIAN-PATCHES.md) : PageLayoutRecordPageRenderer
// DOIT monter <VeridianRecordOpenEffect> (mécanique d'ouverture de fiche). Ce
// renderer est rendu DANS LES DEUX contextes record — pleine page
// (isInSidePanel=false, via RecordShowPage) ET side-panel (isInSidePanel=true,
// via SidePanelRecordPage) — donc un seul point de montage ici couvre les deux.
// L'effet reçoit objectNameSingular + recordId dérivés de `targetRecordIdentifier`.
// Si un sync upstream réécrit ce renderer et efface le patch inline, ce test
// casse — pas la prod.
//
// On neutralise tout le graphe natif (page-layout renderer, side-panel footer,
// effects, banners) par des marqueurs : ce test ne vérifie QUE la présence + le
// câblage de l'effet Veridian, dans les deux valeurs de `isInSidePanel`.

const mockVeridianEffectSpy = jest.fn();

jest.mock('@/veridian-record-open/components/VeridianRecordOpenEffect', () => ({
  VeridianRecordOpenEffect: (props: {
    recordId: string;
    objectNameSingular: string;
  }) => {
    mockVeridianEffectSpy(props);
    return <div data-testid="veridian-record-open-effect" />;
  },
}));

// `deletedAt` / `pageLayoutId` : on renvoie des valeurs neutres pour court-
// circuiter banner + PageLayoutRenderer.
jest.mock(
  '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorValue',
  () => ({ useAtomFamilySelectorValue: () => null }),
);
jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: () => [],
}));
jest.mock('@/page-layout/hooks/usePageLayoutIdForRecord', () => ({
  usePageLayoutIdForRecord: () => ({ pageLayoutId: undefined }),
}));

// Composants/effets lourds → marqueurs neutres.
jest.mock(
  '@/command-menu-item/components/RecordPageSidePanelCommandMenu',
  () => ({ RecordPageSidePanelCommandMenu: () => <div /> }),
);
jest.mock(
  '@/command-menu-item/components/RecordShowSidePanelOpenRecordButton',
  () => ({ RecordShowSidePanelOpenRecordButton: () => <div /> }),
);
jest.mock(
  '@/information-banner/components/deleted-record/InformationBannerDeletedRecord',
  () => ({ InformationBannerDeletedRecord: () => <div /> }),
);
jest.mock(
  '@/object-record/record-show/components/RecordShowContainerContextStoreTargetedRecordsEffect',
  () => ({ RecordShowContainerContextStoreTargetedRecordsEffect: () => <div /> }),
);
jest.mock(
  '@/object-record/record-show/components/RecordShowEffect',
  () => ({ RecordShowEffect: () => <div /> }),
);
jest.mock('@/page-layout/components/PageLayoutRenderer', () => ({
  PageLayoutRenderer: () => <div />,
}));
jest.mock('@/ui/layout/contexts/LayoutRenderingContext', () => ({
  LayoutRenderingProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
jest.mock('@/ui/layout/side-panel/components/SidePanelFooter', () => ({
  SidePanelFooter: () => <div />,
}));
jest.mock(
  '@/ui/layout/side-panel/states/sidePanelWidgetFooterCommandMenuItemsState',
  () => ({ sidePanelWidgetFooterCommandMenuItemsState: {} }),
);
jest.mock(
  '@/object-record/record-store/states/selectors/recordStoreFamilySelector',
  () => ({ recordStoreFamilySelector: {} }),
);

import { PageLayoutRecordPageRenderer } from '@/object-record/record-show/components/PageLayoutRecordPageRenderer';

const targetRecordIdentifier = {
  id: 'rec-123',
  targetObjectNameSingular: 'company',
};

describe('PageLayoutRecordPageRenderer (Veridian record-open patch-survival)', () => {
  beforeEach(() => mockVeridianEffectSpy.mockClear());

  it.each([
    ['pleine page', false],
    ['side-panel', true],
  ])('monte VeridianRecordOpenEffect (%s)', (_label, isInSidePanel) => {
    const { getByTestId } = render(
      <PageLayoutRecordPageRenderer
        targetRecordIdentifier={targetRecordIdentifier}
        isInSidePanel={isInSidePanel as boolean}
      />,
    );
    expect(getByTestId('veridian-record-open-effect')).toBeInTheDocument();
  });

  it('passe objectNameSingular + recordId dérivés de targetRecordIdentifier', () => {
    render(
      <PageLayoutRecordPageRenderer
        targetRecordIdentifier={targetRecordIdentifier}
        isInSidePanel={false}
      />,
    );
    expect(mockVeridianEffectSpy).toHaveBeenCalledTimes(1);
    expect(mockVeridianEffectSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        objectNameSingular: 'company',
        recordId: 'rec-123',
      }),
    );
  });
});
