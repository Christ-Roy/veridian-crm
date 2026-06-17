import {
  __resetRecordOpenGuardForTests,
  buildRecordOpenKey,
  claimRecordOpen,
  confirmRecordOpen,
  isRecordOpenClaimed,
  releaseRecordOpen,
} from '@/veridian-record-open/utils/recordOpenGuard';

// Veridian (cf VERIDIAN-PATCHES.md) : garde d'idempotence MODULE-LEVEL partagée
// entre les instances de VeridianRecordOpenEffect (side-panel ⟷ pleine page).
// C'est elle qui empêche la DOUBLE écriture quand la même fiche est montée 2×.

describe('recordOpenGuard (dé-doublonnage multi-instance)', () => {
  beforeEach(() => __resetRecordOpenGuardForTests());

  it('construit une clé canonique objectNameSingular:recordId', () => {
    expect(buildRecordOpenKey('company', 'rec-1')).toBe('company:rec-1');
    expect(buildRecordOpenKey('person', 'p-9')).toBe('person:p-9');
  });

  it('la PREMIÈRE réclamation gagne, la seconde concurrente perd', () => {
    const key = buildRecordOpenKey('company', 'rec-1');
    expect(claimRecordOpen(key)).toBe(true); // instance side-panel
    expect(claimRecordOpen(key)).toBe(false); // instance pleine page concurrente
  });

  it('une clé confirmée reste verrouillée (pas de ré-écriture)', () => {
    const key = buildRecordOpenKey('company', 'rec-1');
    expect(claimRecordOpen(key)).toBe(true);
    confirmRecordOpen(key);
    expect(isRecordOpenClaimed(key)).toBe(true);
    expect(claimRecordOpen(key)).toBe(false);
  });

  it('relâcher une clé (échec update) permet un nouveau claim', () => {
    const key = buildRecordOpenKey('company', 'rec-1');
    expect(claimRecordOpen(key)).toBe(true);
    releaseRecordOpen(key);
    expect(isRecordOpenClaimed(key)).toBe(false);
    expect(claimRecordOpen(key)).toBe(true); // réessai possible
  });

  it('des fiches différentes ont des clés indépendantes', () => {
    const keyA = buildRecordOpenKey('company', 'rec-1');
    const keyB = buildRecordOpenKey('person', 'p-1');
    expect(claimRecordOpen(keyA)).toBe(true);
    expect(claimRecordOpen(keyB)).toBe(true); // pas bloqué par keyA
  });

  it('relâcher une clé non détenue est un no-op sûr', () => {
    expect(() => releaseRecordOpen('company:absent')).not.toThrow();
    expect(isRecordOpenClaimed('company:absent')).toBe(false);
  });
});
