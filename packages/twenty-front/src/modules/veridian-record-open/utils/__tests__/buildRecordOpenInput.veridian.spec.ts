import {
  VERIDIAN_FICHE_OUVERTE_AT_FIELD,
  VERIDIAN_FICHE_OUVERTE_PAR_FK_FIELD,
  VERIDIAN_RECORD_OPEN_DELAY_MS,
  buildRecordOpenInput,
  isVeridianRecordOpenObject,
} from '@/veridian-record-open/utils/buildRecordOpenInput';

// Veridian (cf VERIDIAN-PATCHES.md) : logique pure de la mécanique d'ouverture
// de fiche. Le payload relation DOIT passer par la foreign key
// `ficheOuverteParId` (Twenty persiste les many-to-one par leur FK, pas par
// `{ id }` ; cf usePersistField → getForeignKeyNameFromRelationFieldName).

describe('buildRecordOpenInput (Veridian record-open)', () => {
  it('utilise la FK relation `ficheOuverteParId` (pas `ficheOuvertePar`/`{ id }`)', () => {
    const input = buildRecordOpenInput('wm-42', new Date('2026-06-17T10:00:00.000Z'));

    expect(VERIDIAN_FICHE_OUVERTE_PAR_FK_FIELD).toBe('ficheOuverteParId');
    expect(input).toHaveProperty('ficheOuverteParId', 'wm-42');
    // pas la forme objet/relation, qui serait stripée par sanitizeRecordInput
    expect(input).not.toHaveProperty('ficheOuvertePar');
  });

  it('sérialise `ficheOuverteAt` en ISO (format DATE_TIME Twenty)', () => {
    const input = buildRecordOpenInput(
      'wm-42',
      new Date('2026-06-17T10:00:00.000Z'),
    );

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

  it('cible UNIQUEMENT company et person (les objets portant les champs)', () => {
    expect(isVeridianRecordOpenObject('company')).toBe(true);
    expect(isVeridianRecordOpenObject('person')).toBe(true);
    expect(isVeridianRecordOpenObject('opportunity')).toBe(false);
    expect(isVeridianRecordOpenObject('note')).toBe(false);
    expect(isVeridianRecordOpenObject('')).toBe(false);
  });

  it('le délai de confirmation est de 5 secondes', () => {
    expect(VERIDIAN_RECORD_OPEN_DELAY_MS).toBe(5000);
  });
});
