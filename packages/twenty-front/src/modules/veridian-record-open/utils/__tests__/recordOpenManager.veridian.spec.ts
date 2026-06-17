import { getDefaultStore } from 'jotai';

import { veridianPendingOpenKeysState } from '@/veridian-record-open/states/veridianPendingOpenKeysState';
import { VERIDIAN_RECORD_OPEN_DELAY_MS } from '@/veridian-record-open/utils/buildRecordOpenInput';
import {
  __resetRecordOpenManagerForTests,
  buildRecordOpenKey,
  cancelRecordOpen,
  isRecordOpenPending,
  scheduleRecordOpen,
} from '@/veridian-record-open/utils/recordOpenManager';

// Veridian (cf VERIDIAN-PATCHES.md) : MANAGER MODULE-LEVEL de la mécanique
// d'ouverture INVERSÉE. Le décompte démarre à la FERMETURE, vit hors React
// (Map module-level), pilote le pending atom (scintillement de la row) et
// garantit l'idempotence des écritures.
//
// Tests purs : on pilote le décompte avec les fake timers Jest et on observe
// (a) l'écriture (callback), (b) le pending atom (Set), (c) l'annulation.

const store = getDefaultStore();
const pendingKeys = () => store.get(veridianPendingOpenKeysState.atom);

describe('recordOpenManager (décompte à la fermeture)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    __resetRecordOpenManagerForTests();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('construit une clé canonique objectNameSingular:recordId', () => {
    expect(buildRecordOpenKey('company', 'rec-1')).toBe('company:rec-1');
    expect(buildRecordOpenKey('person', 'p-9')).toBe('person:p-9');
  });

  it("n'écrit RIEN avant l'expiration du décompte", () => {
    const write = jest.fn().mockResolvedValue(undefined);
    scheduleRecordOpen('company:rec-1', write);

    jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS - 1);
    expect(write).not.toHaveBeenCalled();
  });

  it("écrit (callback) quand le décompte s'écoule sans annulation", () => {
    const write = jest.fn().mockResolvedValue(undefined);
    scheduleRecordOpen('company:rec-1', write);

    jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('ajoute la clé au pending atom pendant le décompte, la retire à la confirmation', () => {
    const write = jest.fn().mockResolvedValue(undefined);
    scheduleRecordOpen('company:rec-1', write);

    expect(pendingKeys().has('company:rec-1')).toBe(true);

    jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    expect(pendingKeys().has('company:rec-1')).toBe(false);
  });

  it('chaque mutation du pending atom crée un NOUVEAU Set (réactivité jotai)', () => {
    const before = pendingKeys();
    scheduleRecordOpen('company:rec-1', jest.fn().mockResolvedValue(undefined));
    const after = pendingKeys();
    expect(after).not.toBe(before); // référence neuve → jotai re-render les rows
  });

  it('cancelRecordOpen annule le décompte : AUCUNE écriture, clé retirée du pending', () => {
    const write = jest.fn().mockResolvedValue(undefined);
    scheduleRecordOpen('company:rec-1', write);

    expect(pendingKeys().has('company:rec-1')).toBe(true);

    const consumed = cancelRecordOpen('company:rec-1');
    expect(consumed).toBe(true); // un décompte était en cours → clic consommé
    expect(pendingKeys().has('company:rec-1')).toBe(false);

    jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS * 2);
    expect(write).not.toHaveBeenCalled();
  });

  it('cancelRecordOpen renvoie false si aucun décompte en cours (clic normal)', () => {
    expect(cancelRecordOpen('company:absent')).toBe(false);
  });

  it("isRecordOpenPending reflète l'état du décompte", () => {
    expect(isRecordOpenPending('company:rec-1')).toBe(false);
    scheduleRecordOpen('company:rec-1', jest.fn().mockResolvedValue(undefined));
    expect(isRecordOpenPending('company:rec-1')).toBe(true);
    jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    expect(isRecordOpenPending('company:rec-1')).toBe(false);
  });

  it('plusieurs fiches peuvent décompter EN PARALLÈLE (Set multi-clés)', () => {
    scheduleRecordOpen('company:rec-1', jest.fn().mockResolvedValue(undefined));
    scheduleRecordOpen('person:p-1', jest.fn().mockResolvedValue(undefined));

    const keys = pendingKeys();
    expect(keys.has('company:rec-1')).toBe(true);
    expect(keys.has('person:p-1')).toBe(true);
    expect(keys.size).toBe(2);
  });

  it('annuler UNE fiche ne touche pas le décompte des autres', () => {
    const writeA = jest.fn().mockResolvedValue(undefined);
    const writeB = jest.fn().mockResolvedValue(undefined);
    scheduleRecordOpen('company:rec-1', writeA);
    scheduleRecordOpen('person:p-1', writeB);

    cancelRecordOpen('company:rec-1');

    jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    expect(writeA).not.toHaveBeenCalled(); // annulée
    expect(writeB).toHaveBeenCalledTimes(1); // confirmée
  });

  it('idempotence : une clé CONFIRMÉE ne se re-décompte pas (re-fermeture)', async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    expect(scheduleRecordOpen('company:rec-1', write)).toBe(true);

    jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    // laisse résoudre la promesse d'écriture → état 'confirmed'
    await Promise.resolve();
    await Promise.resolve();

    // re-fermer la même fiche → ignoré (déjà confirmée).
    expect(scheduleRecordOpen('company:rec-1', write)).toBe(false);
    jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('re-armer une clé en décompte (sans annulation) remplace le timer, une seule écriture', () => {
    const write1 = jest.fn().mockResolvedValue(undefined);
    const write2 = jest.fn().mockResolvedValue(undefined);
    scheduleRecordOpen('company:rec-1', write1);
    jest.advanceTimersByTime(4000);
    // re-fermeture avant expiration → re-arme (nouveau callback, timer remis à 0)
    scheduleRecordOpen('company:rec-1', write2);

    jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    expect(write1).not.toHaveBeenCalled(); // l'ancien timer a été coupé
    expect(write2).toHaveBeenCalledTimes(1);
  });

  it("échec d'écriture → relâche la clé → un nouveau décompte ré-écrira", async () => {
    const failing = jest.fn().mockRejectedValue(new Error('boom'));
    scheduleRecordOpen('company:rec-1', failing);
    jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(failing).toHaveBeenCalledTimes(1);

    // la clé n'est PAS verrouillée 'confirmed' → re-fermeture re-arme.
    const retry = jest.fn().mockResolvedValue(undefined);
    expect(scheduleRecordOpen('company:rec-1', retry)).toBe(true);
    jest.advanceTimersByTime(VERIDIAN_RECORD_OPEN_DELAY_MS);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
