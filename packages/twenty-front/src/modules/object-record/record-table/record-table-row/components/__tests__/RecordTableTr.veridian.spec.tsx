import { render } from '@testing-library/react';

// Veridian PATCH-SURVIVAL (cf VERIDIAN-PATCHES.md) : RecordTableTr DOIT poser
// `data-veridian-record-opening` sur la row quand l'openKey de SA fiche
// (`<objectNameSingular>:<recordId>`) APPARTIENT au Set de l'atom global
// `veridianPendingOpenKeysState` (posé par le recordOpenManager pendant le
// décompte de confirmation 10s, déclenché à la FERMETURE de la fiche). C'est
// l'animation de la LIGNE dans la vue table (la row scintille → re-cliquer
// annule). Si un sync upstream réécrit RecordTableTr et efface le patch, ce
// test casse — pas la prod.
//
// On neutralise tout le graphe natif (context table, component-states, contexte
// row, RecordTableRowDiv) par des marqueurs ; on pilote la valeur de l'atom
// global (un Set) via le mock de useAtomStateValue (lecture seule côté row).

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
jest.mock('@/veridian-record-open/states/veridianPendingOpenKeysState', () => ({
  veridianPendingOpenKeysState: {},
}));

// Set des clés en décompte, pilotable par test (lu par useAtomStateValue).
let mockPendingOpenKeys: ReadonlySet<string> = new Set();
jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: () => mockPendingOpenKeys,
}));

import { RecordTableTr } from '@/object-record/record-table/record-table-row/components/RecordTableTr';

const renderRow = () =>
  render(
    <RecordTableTr recordId="rec-1" focusIndex={0} isDragging={false}>
      <div />
    </RecordTableTr>,
  );

describe('RecordTableTr (Veridian record-open patch-survival — row scintille)', () => {
  it("anime la row quand son openKey est dans le Set des décomptes en cours", () => {
    mockPendingOpenKeys = new Set(['company:rec-1']);
    const { getByTestId } = renderRow();
    expect(getByTestId('record-table-row-div')).toHaveAttribute(
      'data-veridian-record-opening',
      'true',
    );
  });

  it("n'anime PAS la row quand aucun décompte n'est en cours", () => {
    mockPendingOpenKeys = new Set();
    const { getByTestId } = renderRow();
    expect(getByTestId('record-table-row-div')).not.toHaveAttribute(
      'data-veridian-record-opening',
      'true',
    );
  });

  it("n'anime PAS la row si le décompte concerne une AUTRE fiche", () => {
    mockPendingOpenKeys = new Set(['company:rec-2']);
    const { getByTestId } = renderRow();
    expect(getByTestId('record-table-row-div')).not.toHaveAttribute(
      'data-veridian-record-opening',
      'true',
    );
  });

  it('anime la row même si PLUSIEURS fiches décomptent en parallèle (Set multi)', () => {
    mockPendingOpenKeys = new Set(['person:p-9', 'company:rec-1', 'company:rec-2']);
    const { getByTestId } = renderRow();
    expect(getByTestId('record-table-row-div')).toHaveAttribute(
      'data-veridian-record-opening',
      'true',
    );
  });
});
