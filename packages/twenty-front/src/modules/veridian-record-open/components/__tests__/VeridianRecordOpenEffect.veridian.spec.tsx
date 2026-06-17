import { StrictMode } from 'react';
import { act, render } from '@testing-library/react';

import { VeridianRecordOpenEffect } from '@/veridian-record-open/components/VeridianRecordOpenEffect';
import { VERIDIAN_RECORD_OPEN_DELAY_MS } from '@/veridian-record-open/utils/buildRecordOpenInput';
import { __resetRecordOpenManagerForTests } from '@/veridian-record-open/utils/recordOpenManager';

// Veridian (cf VERIDIAN-PATCHES.md) : logique INVERSÉE — le décompte démarre à
// la FERMETURE de la fiche (démontage / changement de recordId), pas à
// l'ouverture. On isole le composant de l'API/auth/store réels :
//   - useUpdateOneRecord → spy observable
//   - currentWorkspaceMember → membre de test
//   - store jotai (useStore) → renvoie le statutColdCall courant (mutable) pour
//     tester la progression A_APPELER → FICHE_OUVERTE (et l'absence de régression)
// puis on pilote le décompte 10s avec les fake timers Jest.
//
// On garde le VRAI recordOpenManager (Map de timers + pending atom réels) : c'est
// LUI qui mène le décompte hors du cycle de vie React → on prouve ainsi que
// l'écriture survit au démontage de la fiche. On le réinitialise en beforeEach.
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

jest.mock(
  '@/object-record/record-store/states/selectors/recordStoreFamilySelector',
  () => ({
    recordStoreFamilySelector: {
      selectorFamily: ({ fieldName }: { fieldName: string }) => ({ fieldName }),
    },
  }),
);

// On garde le vrai jotai (le manager utilise getDefaultStore pour le pending
// atom réel) et on n'override QUE le useStore lu par l'Effect (lecture du statut).
jest.mock('jotai', () => ({
  ...jest.requireActual('jotai'),
  useStore: () => ({
    get: (selectorKey: { fieldName: string }) =>
      selectorKey?.fieldName === 'statutColdCall'
        ? mockCurrentStatutColdCall
        : undefined,
  }),
}));

describe('VeridianRecordOpenEffect (décompte à la FERMETURE de la fiche)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUpdateOneRecord.mockClear();
    mockUpdateOneRecord.mockResolvedValue({ id: 'rec-1' });
    mockCurrentWorkspaceMember = { id: 'wm-99', name: { firstName: 'Robert' } };
    mockCurrentStatutColdCall = 'A_APPELER';
    __resetRecordOpenManagerForTests();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("n'écrit RIEN à l'OUVERTURE (mount) — même après 10s tant que la fiche reste ouverte", () => {
    render(
      <VeridianRecordOpenEffect recordId="rec-1" objectNameSingular="company" />,
    );

    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS * 2);
    });

    // La fiche est toujours ouverte (montée) → aucun décompte armé → 0 écriture.
    expect(mockUpdateOneRecord).not.toHaveBeenCalled();
  });

  it("n'écrit RIEN immédiatement à la fermeture (décompte pas encore écoulé)", () => {
    const { unmount } = render(
      <VeridianRecordOpenEffect recordId="rec-1" objectNameSingular="company" />,
    );

    unmount(); // fermeture → décompte armé
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS - 1);
    });

    expect(mockUpdateOneRecord).not.toHaveBeenCalled();
  });

  it('écrit ficheOuverteAt + ficheOuverteParId 10s APRÈS la fermeture (survit au démontage)', () => {
    const { unmount } = render(
      <VeridianRecordOpenEffect recordId="rec-1" objectNameSingular="company" />,
    );

    unmount(); // la fiche (et sa row) ne sont plus montées…
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });

    // …et pourtant le décompte (module-level) a confirmé l'écriture.
    expect(mockUpdateOneRecord).toHaveBeenCalledTimes(1);
    const callArg = mockUpdateOneRecord.mock.calls[0][0];
    expect(callArg.objectNameSingular).toBe('company');
    expect(callArg.idToUpdate).toBe('rec-1');
    expect(callArg.updateOneRecordInput.ficheOuverteParId).toBe('wm-99');
    expect(typeof callArg.updateOneRecordInput.ficheOuverteAt).toBe('string');
  });

  it('fait progresser le statut A_APPELER → FICHE_OUVERTE à la confirmation', () => {
    mockCurrentStatutColdCall = 'A_APPELER';
    const { unmount } = render(
      <VeridianRecordOpenEffect recordId="rec-1" objectNameSingular="company" />,
    );
    unmount();
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
      const { unmount } = render(
        <VeridianRecordOpenEffect
          recordId="rec-1"
          objectNameSingular="company"
        />,
      );
      unmount();
      act(() => {
        jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
      });
      expect(mockUpdateOneRecord).toHaveBeenCalledTimes(1);
      const input = mockUpdateOneRecord.mock.calls[0][0].updateOneRecordInput;
      expect(input).not.toHaveProperty('statutColdCall');
      expect(input.ficheOuverteParId).toBe('wm-99');
      expect(typeof input.ficheOuverteAt).toBe('string');
    },
  );

  it('lit le statut courant À LA CONFIRMATION (one-shot), pas à la fermeture', () => {
    // À la fermeture le statut est A_APPELER ; il passe à QUALIFIE pendant les
    // 10s (autre action) → la confirmation doit lire QUALIFIE → pas de régression.
    mockCurrentStatutColdCall = 'A_APPELER';
    const { unmount } = render(
      <VeridianRecordOpenEffect recordId="rec-1" objectNameSingular="company" />,
    );
    unmount();
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    mockCurrentStatutColdCall = 'QUALIFIE';
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });
    const input = mockUpdateOneRecord.mock.calls[0][0].updateOneRecordInput;
    expect(input).not.toHaveProperty('statutColdCall');
  });

  it('change de recordId (X→Y) → arme le décompte de X (fermée), pas de Y (ouverte)', () => {
    const { rerender } = render(
      <VeridianRecordOpenEffect recordId="rec-1" objectNameSingular="company" />,
    );

    // Le commercial bascule sur une autre fiche (side-panel) → rec-1 fermée.
    rerender(
      <VeridianRecordOpenEffect recordId="rec-2" objectNameSingular="company" />,
    );

    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });

    // Seule rec-1 (fermée) est confirmée ; rec-2 est encore ouverte → rien.
    expect(mockUpdateOneRecord).toHaveBeenCalledTimes(1);
    expect(mockUpdateOneRecord.mock.calls[0][0].idToUpdate).toBe('rec-1');
  });

  it('confirme aussi rec-2 quand elle est fermée à son tour', () => {
    const { rerender, unmount } = render(
      <VeridianRecordOpenEffect recordId="rec-1" objectNameSingular="company" />,
    );
    rerender(
      <VeridianRecordOpenEffect recordId="rec-2" objectNameSingular="company" />,
    );
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS); // rec-1 confirmée
    });
    unmount(); // rec-2 fermée
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS); // rec-2 confirmée
    });

    const ids = mockUpdateOneRecord.mock.calls.map((c) => c[0].idToUpdate);
    expect(ids).toEqual(['rec-1', 'rec-2']);
  });

  it('marche aussi sur person', () => {
    const { unmount } = render(
      <VeridianRecordOpenEffect recordId="p-1" objectNameSingular="person" />,
    );
    unmount();
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });
    expect(mockUpdateOneRecord).toHaveBeenCalledTimes(1);
    expect(mockUpdateOneRecord.mock.calls[0][0].objectNameSingular).toBe(
      'person',
    );
  });

  it("n'écrit pas sur un objet hors périmètre (opportunity)", () => {
    const { unmount } = render(
      <VeridianRecordOpenEffect
        recordId="o-1"
        objectNameSingular="opportunity"
      />,
    );
    unmount();
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });
    expect(mockUpdateOneRecord).not.toHaveBeenCalled();
  });

  it("n'écrit pas si aucun commercial connecté", () => {
    mockCurrentWorkspaceMember = null;
    const { unmount } = render(
      <VeridianRecordOpenEffect recordId="rec-1" objectNameSingular="company" />,
    );
    unmount();
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });
    expect(mockUpdateOneRecord).not.toHaveBeenCalled();
  });

  it("STRICT MODE : mount→cleanup→mount NE produit PAS de fausse confirmation (fiche reste ouverte)", () => {
    // <StrictMode> rejoue setup→cleanup→setup au montage. Le cleanup spurious
    // planifierait un décompte alors que la fiche est ENCORE ouverte ; le 2e
    // setup l'annule (cancelRecordOpen au mount). On vérifie qu'aucune écriture
    // ne part tant que la fiche reste montée.
    render(
      <StrictMode>
        <VeridianRecordOpenEffect
          recordId="rec-1"
          objectNameSingular="company"
        />
      </StrictMode>,
    );

    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS * 2);
    });

    expect(mockUpdateOneRecord).not.toHaveBeenCalled();
  });

  it('STRICT MODE : confirme quand même APRÈS une vraie fermeture (unmount)', () => {
    const { unmount } = render(
      <StrictMode>
        <VeridianRecordOpenEffect
          recordId="rec-1"
          objectNameSingular="company"
        />
      </StrictMode>,
    );
    unmount(); // vraie fermeture (pas de re-mount derrière)
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });
    expect(mockUpdateOneRecord).toHaveBeenCalledTimes(1);
    expect(mockUpdateOneRecord.mock.calls[0][0].idToUpdate).toBe('rec-1');
  });

  it('réouverture hors index (ré-mount de la MÊME fiche) annule le décompte en cours', () => {
    // open A → close A (décompte armé) → on ROUVRE A par un chemin hors index
    // (re-mount de l'Effect pour A) AVANT les 10s → le mount annule le décompte.
    const { unmount } = render(
      <VeridianRecordOpenEffect recordId="rec-1" objectNameSingular="company" />,
    );
    unmount(); // close A → décompte armé
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    // ré-ouverture de A (nouveau mount)
    const { unmount: unmount2 } = render(
      <VeridianRecordOpenEffect recordId="rec-1" objectNameSingular="company" />,
    );
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });
    // Le décompte initial a été annulé par le re-mount → pas d'écriture tant que
    // A reste ouverte.
    expect(mockUpdateOneRecord).not.toHaveBeenCalled();

    // …et à la VRAIE fermeture suivante, un nouveau décompte confirme.
    unmount2();
    act(() => {
      jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    });
    expect(mockUpdateOneRecord).toHaveBeenCalledTimes(1);
  });
});
