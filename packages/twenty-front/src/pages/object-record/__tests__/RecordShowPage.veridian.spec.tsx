import { render } from '@testing-library/react';
import { type ReactNode } from 'react';

// Veridian PATCH-SURVIVAL (cf VERIDIAN-PATCHES.md) : RecordShowPage DOIT monter
// <VeridianRecordOpenEffect> (mécanique d'ouverture de fiche) dans la vue pleine
// page, avec objectNameSingular + objectRecordId. Si un sync upstream réécrit
// RecordShowPage et efface le patch inline, ce test casse — pas la prod.
//
// RecordShowPage tire un gros graphe de providers (context-store, command-menu,
// page-layout renderer, SSE…). On les neutralise par des marqueurs : ce test ne
// vérifie QUE la présence + le câblage de l'effet Veridian, pas le rendu natif.

const mockVeridianEffectSpy = jest.fn();

jest.mock(
  '@/veridian-record-open/components/VeridianRecordOpenEffect',
  () => ({
    VeridianRecordOpenEffect: (props: {
      recordId: string;
      objectNameSingular: string;
    }) => {
      mockVeridianEffectSpy(props);
      return <div data-testid="veridian-record-open-effect" />;
    },
  }),
);

jest.mock('react-router-dom', () => ({
  useParams: () => ({
    objectNameSingular: 'company',
    objectRecordId: 'rec-123',
  }),
}));

jest.mock('@/object-record/record-show/hooks/useRecordShowPage', () => ({
  useRecordShowPage: (objectNameSingular: string, objectRecordId: string) => ({
    objectNameSingular,
    objectRecordId,
    objectMetadataItem: {},
  }),
}));

jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: () => false,
}));

jest.mock(
  '@/object-record/record-show/utils/computeRecordShowComponentInstanceId',
  () => ({
    computeRecordShowComponentInstanceId: (id: string) => `instance-${id}`,
  }),
);

// Marqueurs neutres pour tout le décor (providers + composants lourds).
// IMPORTANT : déclaration `function` (hoistée) et NON `const` arrow — les
// factories `jest.mock` ci-dessous l'appellent au CHARGEMENT du module (les
// Context.Provider sont résolus eagerly quand RecordShowPage est importé). Un
// `const` serait dans la TDZ au moment de la résolution des mocks hoistés par
// @swc/jest → `Cannot access 'mockPassThrough' before initialization`.
function mockPassThrough(testId: string) {
  return ({ children }: { children?: ReactNode }) => (
    <div data-testid={testId}>{children}</div>
  );
}

jest.mock('@/side-panel/components/SidePanelToggleButton', () => ({
  SidePanelToggleButton: () => <div />,
}));
jest.mock('@/command-menu-item/components/RecordShowCommandMenu', () => ({
  RecordShowCommandMenu: () => <div />,
}));
jest.mock(
  '@/command-menu/states/contexts/CommandMenuComponentInstanceContext',
  () => ({
    CommandMenuComponentInstanceContext: {
      Provider: mockPassThrough('cmd-menu-provider'),
    },
  }),
);
jest.mock(
  '@/activities/timeline-activities/contexts/TimelineActivityContext',
  () => ({
    TimelineActivityContext: { Provider: mockPassThrough('timeline-provider') },
  }),
);
jest.mock('@/context-store/constants/MainContextStoreInstanceId', () => ({
  MAIN_CONTEXT_STORE_INSTANCE_ID: 'main',
}));
jest.mock(
  '@/context-store/states/contexts/ContextStoreComponentInstanceContext',
  () => ({
    ContextStoreComponentInstanceContext: {
      Provider: mockPassThrough('context-store-provider'),
    },
  }),
);
jest.mock(
  '@/layout-customization/states/isLayoutCustomizationModeEnabledState',
  () => ({ isLayoutCustomizationModeEnabledState: {} }),
);
jest.mock(
  '@/object-record/components/RecordComponentInstanceContextsWrapper',
  () => ({
    RecordComponentInstanceContextsWrapper: mockPassThrough('record-wrapper'),
  }),
);
jest.mock(
  '@/object-record/record-show/components/PageLayoutRecordPageRenderer',
  () => ({ PageLayoutRecordPageRenderer: () => <div /> }),
);
jest.mock(
  '@/object-record/record-show/components/RecordShowPageSSESubscribeEffect',
  () => ({ RecordShowPageSSESubscribeEffect: () => <div /> }),
);
jest.mock('@/ui/layout/page/components/PageCardLayout', () => ({
  PageCardLayout: mockPassThrough('page-card-layout'),
}));
jest.mock('~/pages/object-record/RecordShowPageHeader', () => ({
  RecordShowPageHeader: mockPassThrough('record-header'),
}));
jest.mock('~/pages/object-record/RecordShowPageTitle', () => ({
  RecordShowPageTitle: () => <div />,
}));

import { RecordShowPage } from '~/pages/object-record/RecordShowPage';

describe('RecordShowPage (Veridian record-open patch-survival)', () => {
  beforeEach(() => mockVeridianEffectSpy.mockClear());

  it('monte VeridianRecordOpenEffect dans la vue pleine page', () => {
    const { getByTestId } = render(<RecordShowPage />);
    expect(getByTestId('veridian-record-open-effect')).toBeInTheDocument();
  });

  it('passe objectNameSingular + objectRecordId à l\'effet', () => {
    render(<RecordShowPage />);
    expect(mockVeridianEffectSpy).toHaveBeenCalledTimes(1);
    expect(mockVeridianEffectSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        objectNameSingular: 'company',
        recordId: 'rec-123',
      }),
    );
  });
});
