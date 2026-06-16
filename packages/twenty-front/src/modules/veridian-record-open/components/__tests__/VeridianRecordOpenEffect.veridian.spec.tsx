import { act, render } from '@testing-library/react';

import { VeridianRecordOpenEffect } from '@/veridian-record-open/components/VeridianRecordOpenEffect';
import { VERIDIAN_RECORD_OPEN_DELAY_MS } from '@/veridian-record-open/utils/buildRecordOpenInput';

// Veridian (cf VERIDIAN-PATCHES.md) : logique TIMER de la mécanique d'ouverture
// de fiche. On isole le composant de l'API/auth/store réels :
//   - useUpdateOneRecord → spy observable
//   - currentWorkspaceMember → membre de test
//   - store jotai → renvoie le statutColdCall courant (mutable) pour tester la
//     progression A_APPELER → FICHE_OUVERTE (et l'absence de régression)
// puis on pilote le timer 5s avec les fake timers Jest.
//
// NB : les variables référencées dans une factory `jest.mock` DOIVENT être
// préfixées `mock` (garde-fou jest "out-of-scope variables").

const mockUpdateOneRecord = jest.fn().mockResolvedValue({ id: 'rec-1' });

jest.mock('@/object-record/hooks/useUpdateOneRecord', () => ({
  useUpdateOneRecord: () => ({ updateOneRecord: mockUpdateOneRecord }),
}));

let mockCurrentWorkspaceMember:
  | { id: string; name: { firstName: string } }
  | null = { id: 'wm-99', name: { firstName: 'Robert' } };

jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: () => mockCurrentWorkspaceMember,
}));

// Statut courant servi par le store jotai (lecture one-shot à la confirmation).
let mockCurrentStatutColdCall: string | null | undefined = 'A_APPELER';

// Le composant appelle store.get(recordStoreFamilySelector.selectorFamily(...)).
// On fait renvoyer au selector une clé portant le fieldName, et au store.get le
// statut courant quand on lit `statutColdCall`.
jest.mock(
  '@/object-record/record-store/states/selectors/recordStoreFamilySelector',
  () => ({
    recordStoreFamilySelector: {
      selectorFamily: ({ fieldName }: { fieldName: string }) => ({ fieldName }),
    },
  }),
);

// On garde le vrai jotai (les atoms réels sont créés au chargement de modules
// voisins, ex currentWorkspaceMemberState) et on n'override QUE useStore.
jest.mock('jotai', () => ({
  ...jest.requireActual('jotai'),
  useStore: () => ({
    get: (selectorKey: { fieldName: string }) =>
      selectorKey?.fieldName === 'statutColdCall'
        ? mockCurrentStatutColdCall
        : undefined,
  }),
}));

describe('VeridianRecordOpenEffect (timer ouverture de fiche)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUpdateOneRecord.mockClear();
    mockCurrentWorkspaceMember = { id: 'wm-99', name: { firstName: 'Robert' } };
    mockCurrentStatutColdCall = 'A_APPELER';
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("n'écrit RIEN avant 5s", () => {
    render(
      <VeridianRecordOpenEffect
        recordId="rec-1"
        objectNameSingular="company"
      />,
    );

    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS - 1);
    });

    expect(mockUpdateOneRecord).not.toHaveBeenCalled();
  });

  it('écrit ficheOuverteAt + ficheOuverteParId après ≥5s', () => {
    render(
      <VeridianRecordOpenEffect
        recordId="rec-1"
        objectNameSingular="company"
      />,
    );

    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });

    expect(mockUpdateOneRecord).toHaveBeenCalledTimes(1);
    const callArg = mockUpdateOneRecord.mock.calls[0][0];
    expect(callArg.objectNameSingular).toBe('company');
    expect(callArg.idToUpdate).toBe('rec-1');
    expect(callArg.updateOneRecordInput.ficheOuverteParId).toBe('wm-99');
    expect(typeof callArg.updateOneRecordInput.ficheOuverteAt).toBe('string');
  });

  it('fait progresser le statut A_APPELER → FICHE_OUVERTE', () => {
    mockCurrentStatutColdCall = 'A_APPELER';
    render(
      <VeridianRecordOpenEffect
        recordId="rec-1"
        objectNameSingular="company"
      />,
    );
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });
    expect(
      mockUpdateOneRecord.mock.calls[0][0].updateOneRecordInput.statutColdCall,
    ).toBe('FICHE_OUVERTE');
  });

  it.each(['RAPPELER', 'EN_DISCUSSION', 'QUALIFIE', 'FICHE_OUVERTE', null])(
    "ne régresse PAS le statut d'une fiche déjà travaillée (%s) — mais horodate quand même",
    (statut) => {
      mockCurrentStatutColdCall = statut as string | null;
      render(
        <VeridianRecordOpenEffect
          recordId="rec-1"
          objectNameSingular="company"
        />,
      );
      act(() => {
        jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
      });
      expect(mockUpdateOneRecord).toHaveBeenCalledTimes(1);
      const input = mockUpdateOneRecord.mock.calls[0][0].updateOneRecordInput;
      expect(input).not.toHaveProperty('statutColdCall');
      // l'horodatage + l'identité du commercial sont posés dans tous les cas
      expect(input.ficheOuverteParId).toBe('wm-99');
      expect(typeof input.ficheOuverteAt).toBe('string');
    },
  );

  it('annule (rien écrit) si la fiche est fermée AVANT 5s (unmount)', () => {
    const { unmount } = render(
      <VeridianRecordOpenEffect
        recordId="rec-1"
        objectNameSingular="company"
      />,
    );

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    unmount();
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });

    expect(mockUpdateOneRecord).not.toHaveBeenCalled();
  });

  it("annule l'écriture de l'ancienne fiche si recordId change avant 5s", () => {
    const { rerender } = render(
      <VeridianRecordOpenEffect
        recordId="rec-1"
        objectNameSingular="company"
      />,
    );

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    // Le commercial saute sur une autre fiche avant les 5s.
    rerender(
      <VeridianRecordOpenEffect
        recordId="rec-2"
        objectNameSingular="company"
      />,
    );

    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });

    // rec-1 ne doit JAMAIS être écrit ; seul rec-2 est confirmé.
    expect(mockUpdateOneRecord).toHaveBeenCalledTimes(1);
    expect(mockUpdateOneRecord.mock.calls[0][0].idToUpdate).toBe('rec-2');
  });

  it('idempotence : une seule écriture par ouverture confirmée (re-render stable)', () => {
    const { rerender } = render(
      <VeridianRecordOpenEffect
        recordId="rec-1"
        objectNameSingular="company"
      />,
    );

    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });
    // re-render sans changement de recordId → pas de seconde écriture.
    rerender(
      <VeridianRecordOpenEffect
        recordId="rec-1"
        objectNameSingular="company"
      />,
    );
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });

    expect(mockUpdateOneRecord).toHaveBeenCalledTimes(1);
  });

  it('marche aussi sur person', () => {
    render(
      <VeridianRecordOpenEffect recordId="p-1" objectNameSingular="person" />,
    );
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });
    expect(mockUpdateOneRecord).toHaveBeenCalledTimes(1);
    expect(mockUpdateOneRecord.mock.calls[0][0].objectNameSingular).toBe(
      'person',
    );
  });

  it("n'écrit pas sur un objet hors périmètre (opportunity)", () => {
    render(
      <VeridianRecordOpenEffect
        recordId="o-1"
        objectNameSingular="opportunity"
      />,
    );
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });
    expect(mockUpdateOneRecord).not.toHaveBeenCalled();
  });

  it("n'écrit pas si aucun commercial connecté", () => {
    mockCurrentWorkspaceMember = null;
    render(
      <VeridianRecordOpenEffect
        recordId="rec-1"
        objectNameSingular="company"
      />,
    );
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });
    expect(mockUpdateOneRecord).not.toHaveBeenCalled();
  });
});
