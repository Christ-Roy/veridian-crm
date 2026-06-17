import { render } from '@testing-library/react';

// Veridian PATCH-SURVIVAL (cf VERIDIAN-PATCHES.md) : RecordTableTr DOIT poser
// `data-veridian-record-opening` sur la row quand l'openKey de SA fiche
// (`<objectNameSingular>:<recordId>`) est l'openKey actif dans l'atom global
// `veridianActiveOpenKeyState` (posé par VeridianRecordOpenEffect pendant la
// fenêtre d'annulation 5s). C'est le point (c) — animation de la LIGNE dans la
// vue table. Si un sync upstream réécrit RecordTableTr et efface le patch, ce
// test casse — pas la prod.
//
// On neutralise tout le graphe natif (context table, component-states, contexte
// row, RecordTableRowDiv) par des marqueurs ; on pilote la valeur de l'atom
// global via le mock de useAtomStateValue (lecture seule côté row).

const mockObjectNameSingular = 'company';

jest.mock('@/object-record/record-table/contexts/RecordTableContext', () => ({
  useRecordTableContextOrThrow: () => ({
    objectMetadataItem: { id: 'meta-1', nameSingular: mockObjectNameSingular },
  }),
}));

jest.mock(
  '@/object-record/record-table/contexts/RecordTableRowContext',
  () => ({
    RecordTableRowContextProvider: ({
      children,
    }: {
      children?: React.ReactNode;
    }) => <div>{children}</div>,
  }),
);

// RecordTableRowDiv → div transparent qui forwarde les data-* (dont le nôtre).
jest.mock(
  '@/object-record/record-table/record-table-row/components/RecordTableRowDiv',
  () => ({
    RecordTableRowDiv: ({
      children,
      ...rest
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => (
      <div data-testid="record-table-row-div" {...rest}>
        {children}
      </div>
    ),
  }),
);

jest.mock('@/object-metadata/utils/getBasePathToShowPage', () => ({
  getBasePathToShowPage: () => '/objects/companies/',
}));
jest.mock('@/object-record/read-only/hooks/useIsRecordReadOnly', () => ({
  useIsRecordReadOnly: () => false,
}));
jest.mock(
  '@/ui/utilities/state/jotai/hooks/useAtomComponentFamilyStateValue',
  () => ({ useAtomComponentFamilyStateValue: () => false }),
);
jest.mock(
  '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue',
  () => ({ useAtomComponentStateValue: () => false }),
);

// Atoms référencés mais non lus directement (marqueurs neutres).
jest.mock(
  '@/object-record/record-table/record-table-row/states/isRowSelectedComponentFamilyState',
  () => ({ isRowSelectedComponentFamilyState: {} }),
);
jest.mock(
  '@/object-record/record-table/states/isRecordTableRowActiveComponentFamilyState',
  () => ({ isRecordTableRowActiveComponentFamilyState: {} }),
);
jest.mock(
  '@/object-record/record-table/states/isRecordTableRowFocusActiveComponentState',
  () => ({ isRecordTableRowFocusActiveComponentState: {} }),
);
jest.mock(
  '@/object-record/record-table/states/isRecordTableRowFocusedComponentFamilyState',
  () => ({ isRecordTableRowFocusedComponentFamilyState: {} }),
);
jest.mock('@/veridian-record-open/states/veridianActiveOpenKeyState', () => ({
  veridianActiveOpenKeyState: {},
}));

// Valeur courante de l'atom global pilotable par test (lue par useAtomStateValue).
let mockActiveOpenKey: string | null = null;
jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: () => mockActiveOpenKey,
}));

import { RecordTableTr } from '@/object-record/record-table/record-table-row/components/RecordTableTr';

const renderRow = () =>
  render(
    <RecordTableTr recordId="rec-1" focusIndex={0}>
      <div />
    </RecordTableTr>,
  );

describe('RecordTableTr (Veridian record-open patch-survival — point (c) row)', () => {
  it("anime la row quand l'openKey actif == celui de la row", () => {
    mockActiveOpenKey = 'company:rec-1';
    const { getByTestId } = renderRow();
    expect(getByTestId('record-table-row-div')).toHaveAttribute(
      'data-veridian-record-opening',
      'true',
    );
  });

  it("n'anime PAS la row quand aucune fenêtre n'est active", () => {
    mockActiveOpenKey = null;
    const { getByTestId } = renderRow();
    expect(getByTestId('record-table-row-div')).not.toHaveAttribute(
      'data-veridian-record-opening',
      'true',
    );
  });

  it("n'anime PAS la row si la fenêtre active concerne une AUTRE fiche", () => {
    mockActiveOpenKey = 'company:rec-2';
    const { getByTestId } = renderRow();
    expect(getByTestId('record-table-row-div')).not.toHaveAttribute(
      'data-veridian-record-opening',
      'true',
    );
  });
});
