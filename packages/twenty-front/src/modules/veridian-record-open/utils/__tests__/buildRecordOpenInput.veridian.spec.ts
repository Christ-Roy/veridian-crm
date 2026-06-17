import {
  VERIDIAN_FICHE_OUVERTE_AT_FIELD,
  VERIDIAN_FICHE_OUVERTE_PAR_FK_FIELD,
  VERIDIAN_RECORD_OPEN_DELAY_MS,
  VERIDIAN_STATUT_A_APPELER,
  VERIDIAN_STATUT_FICHE_OUVERTE,
  buildRecordOpenInput,
  isVeridianRecordOpenObject,
} from '@/veridian-record-open/utils/buildRecordOpenInput';

// Veridian (cf VERIDIAN-PATCHES.md) : logique pure de la mécanique d'ouverture
// de fiche. Le payload relation DOIT passer par la foreign key
// `ficheOuverteParId` (Twenty persiste les many-to-one par leur FK, pas par
// `{ id }` ; cf usePersistField → getForeignKeyNameFromRelationFieldName).
// La progression de statut est A_APPELER → FICHE_OUVERTE UNIQUEMENT (jamais de
// régression d'une fiche déjà travaillée).

describe('buildRecordOpenInput (Veridian record-open)', () => {
  it('utilise la FK relation `ficheOuverteParId` (pas `ficheOuvertePar`/`{ id }`)', () => {
    const input = buildRecordOpenInput('wm-42', {
      openedAt: new Date('2026-06-17T10:00:00.000Z'),
    });

    expect(VERIDIAN_FICHE_OUVERTE_PAR_FK_FIELD).toBe('ficheOuverteParId');
    expect(input).toHaveProperty('ficheOuverteParId', 'wm-42');
    // pas la forme objet/relation, qui serait stripée par sanitizeRecordInput
    expect(input).not.toHaveProperty('ficheOuvertePar');
  });

  it('sérialise `ficheOuverteAt` en ISO (format DATE_TIME Twenty)', () => {
    const input = buildRecordOpenInput('wm-42', {
      openedAt: new Date('2026-06-17T10:00:00.000Z'),
    });

    expect(VERIDIAN_FICHE_OUVERTE_AT_FIELD).toBe('ficheOuverteAt');
    expect(input.ficheOuverteAt).toBe('2026-06-17T10:00:00.000Z');
    expect(Number.isNaN(Date.parse(input.ficheOuverteAt))).toBe(false);
  });

  it('horodate à maintenant par défaut', () => {
    const before = Date.now();
    const input = buildRecordOpenInput('wm-1');
    const after = Date.now();

    const ts = Date.parse(input.ficheOuverteAt);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  describe('progression du statut (A_APPELER → FICHE_OUVERTE, jamais de régression)', () => {
    it('fait progresser FICHE_OUVERTE quand le statut courant est A_APPELER', () => {
      const input = buildRecordOpenInput('wm-1', {
        currentStatutColdCall: VERIDIAN_STATUT_A_APPELER,
      });
      expect(input.statutColdCall).toBe(VERIDIAN_STATUT_FICHE_OUVERTE);
      expect(VERIDIAN_STATUT_FICHE_OUVERTE).toBe('FICHE_OUVERTE');
    });

    it.each([
      'FICHE_OUVERTE',
      'RAPPELER',
      'EN_DISCUSSION',
      'QUALIFIE',
      'PAS_INTERESSE',
      'INJOIGNABLE',
    ])(
      'ne touche PAS au statut si la fiche est déjà travaillée (%s)',
      (statut) => {
        const input = buildRecordOpenInput('wm-1', {
          currentStatutColdCall: statut,
        });
        expect(input).not.toHaveProperty('statutColdCall');
      },
    );

    it('ne touche pas au statut si statut courant inconnu/null/undefined', () => {
      expect(
        buildRecordOpenInput('wm-1', { currentStatutColdCall: null }),
      ).not.toHaveProperty('statutColdCall');
      expect(
        buildRecordOpenInput('wm-1', { currentStatutColdCall: undefined }),
      ).not.toHaveProperty('statutColdCall');
      expect(buildRecordOpenInput('wm-1')).not.toHaveProperty('statutColdCall');
    });

    it('pose toujours ficheOuverteAt + ficheOuverteParId, statut ou pas', () => {
      const withStatus = buildRecordOpenInput('wm-1', {
        currentStatutColdCall: VERIDIAN_STATUT_A_APPELER,
      });
      const withoutStatus = buildRecordOpenInput('wm-1', {
        currentStatutColdCall: 'QUALIFIE',
      });
      for (const input of [withStatus, withoutStatus]) {
        expect(input).toHaveProperty('ficheOuverteAt');
        expect(input).toHaveProperty('ficheOuverteParId', 'wm-1');
      }
    });
  });

  it('cible UNIQUEMENT company et person (les objets portant les champs)', () => {
    expect(isVeridianRecordOpenObject('company')).toBe(true);
    expect(isVeridianRecordOpenObject('person')).toBe(true);
    expect(isVeridianRecordOpenObject('opportunity')).toBe(false);
    expect(isVeridianRecordOpenObject('note')).toBe(false);
    expect(isVeridianRecordOpenObject('')).toBe(false);
  });

  it('le délai de confirmation (décompte à la fermeture) est de 10 secondes', () => {
    expect(VERIDIAN_RECORD_OPEN_DELAY_MS).toBe(10000);
  });
});
