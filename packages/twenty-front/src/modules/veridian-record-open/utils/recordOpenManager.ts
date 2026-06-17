// Veridian — module AGPL (fork twentyhq/twenty). Mécanique "ouverture de fiche".
//
// MANAGER MODULE-LEVEL (un seul par onglet navigateur) — cœur de la NOUVELLE
// logique inversée (Robert 2026-06-17) : le décompte de confirmation démarre à
// la FERMETURE d'une fiche, pas à son ouverture.
//
// POURQUOI UN MANAGER MODULE-LEVEL (et pas un setTimeout dans un useEffect) :
// le décompte démarre PRÉCISÉMENT au démontage de la fiche (fermeture du
// side-panel / changement de recordId / navigation hors fiche). Un setTimeout
// posé dans le useEffect de la fiche serait nettoyé AU MÊME instant par le
// cleanup de l'effet → il ne survivrait jamais à la fermeture. Le timer doit
// donc vivre HORS du cycle de vie React : ici, dans un Map module-level. L'effet
// `VeridianRecordOpenEffect` ne fait que DÉCLENCHER `scheduleRecordOpen` à sa
// fermeture, puis disparaît ; le manager mène le décompte à terme tout seul et
// exécute l'écriture (via le callback capturé) même si plus aucune fiche/row
// n'est montée.
//
// Le manager porte TROIS responsabilités :
//   1. TIMERS (Map openKey → handle) : armer / annuler le décompte de 10 s.
//   2. PENDING ATOM (réactif) : refléter les clés en décompte pour faire
//      scintiller la LIGNE dans la vue table (lue par `RecordTableTr`).
//   3. IDEMPOTENCE (Map openKey → état) : garantir UNE seule écriture par
//      ouverture confirmée, jamais de double écriture.
//
// Accès à l'atom hors React : Twenty n'enveloppe pas l'app d'un `<Provider
// store>` custom → tous les composants lisent le store jotai PAR DÉFAUT.
// `getDefaultStore()` (de jotai) rend donc EXACTEMENT le même store que celui
// que lisent les rows. Le manager écrit l'atom via ce store ; les rows abonnées
// re-render. (Vérifié : aucun `<Provider store={...}>` dans twenty-front.)

import { getDefaultStore } from 'jotai';

import { veridianPendingOpenKeysState } from '@/veridian-record-open/states/veridianPendingOpenKeysState';
import { VERIDIAN_RECORD_OPEN_DELAY_MS } from '@/veridian-record-open/utils/buildRecordOpenInput';

/**
 * Construit la clé d'ouverture canonique. Une seule source de vérité pour le
 * format, partagée par l'Effect, les rows et le manager.
 */
export const buildRecordOpenKey = (
  objectNameSingular: string,
  recordId: string,
): string => `${objectNameSingular}:${recordId}`;

/**
 * Callback d'écriture exécuté à l'expiration du décompte (confirmation).
 * Capturé au moment du `scheduleRecordOpen` → il survit au démontage de la
 * fiche/row qui l'a planifié. Il fait l'appel API réel (`useUpdateOneRecord`)
 * et lit le statut courant one-shot. Renvoie une promesse (succès/échec pilote
 * l'idempotence).
 */
export type RecordOpenWriteFn = () => Promise<unknown>;

type ScheduledOpen = {
  timeoutId: ReturnType<typeof setTimeout>;
  write: RecordOpenWriteFn;
};

/**
 * États possibles d'un `openKey` dans la garde d'idempotence :
 * - `'inflight'` : le décompte a expiré, l'écriture est en cours d'envoi.
 * - `'confirmed'` : l'écriture a réussi → on ne ré-écrit plus pour cette clé.
 * En cas d'échec d'update, la clé est RELÂCHÉE → une prochaine ouverture/
 * fermeture de la même fiche réessaiera.
 */
type RecordOpenState = 'inflight' | 'confirmed';

// Timers en cours (clé en décompte → handle + callback d'écriture).
const scheduledOpens = new Map<string, ScheduledOpen>();

// Garde d'idempotence des écritures (clé → état).
const recordOpenGuardState = new Map<string, RecordOpenState>();

const getStore = () => getDefaultStore();

const addPendingKey = (openKey: string): void => {
  const store = getStore();
  const current = store.get(veridianPendingOpenKeysState.atom);
  if (current.has(openKey)) {
    return;
  }
  const next = new Set(current);
  next.add(openKey);
  store.set(veridianPendingOpenKeysState.atom, next);
};

const removePendingKey = (openKey: string): void => {
  const store = getStore();
  const current = store.get(veridianPendingOpenKeysState.atom);
  if (!current.has(openKey)) {
    return;
  }
  const next = new Set(current);
  next.delete(openKey);
  store.set(veridianPendingOpenKeysState.atom, next);
};

/** Réclame l'écriture pour cette clé (idempotence). False si déjà détenue. */
const claimWrite = (openKey: string): boolean => {
  if (recordOpenGuardState.has(openKey)) {
    return false;
  }
  recordOpenGuardState.set(openKey, 'inflight');
  return true;
};

const confirmWrite = (openKey: string): void => {
  recordOpenGuardState.set(openKey, 'confirmed');
};

const releaseWrite = (openKey: string): void => {
  recordOpenGuardState.delete(openKey);
};

/**
 * Arme le DÉCOMPTE DE CONFIRMATION pour une fiche qui vient d'être FERMÉE.
 *
 * - Si un décompte est DÉJÀ en cours pour cette clé (fermeture re-déclenchée
 *   sans annulation entre-temps), il est remplacé (re-arme proprement).
 * - Si la clé a déjà été CONFIRMÉE (écriture passée), on n'arme rien : la fiche
 *   est déjà marquée ouverte, inutile de re-décompter.
 * - Ajoute la clé au pending atom (→ la row scintille).
 * - À l'expiration : retire la clé du pending atom, réclame l'idempotence,
 *   exécute le callback d'écriture (capturé) — même si plus rien n'est monté.
 *
 * @returns `true` si un décompte a été armé, `false` si ignoré (déjà confirmé).
 */
export const scheduleRecordOpen = (
  openKey: string,
  write: RecordOpenWriteFn,
): boolean => {
  // Déjà confirmée → ne pas re-décompter (idempotence : une fiche déjà marquée
  // ouverte ne se re-marque pas en la re-fermant).
  if (recordOpenGuardState.get(openKey) === 'confirmed') {
    return false;
  }

  // Re-arme : annule un éventuel décompte précédent pour la même clé.
  const existing = scheduledOpens.get(openKey);
  if (existing) {
    clearTimeout(existing.timeoutId);
  }

  addPendingKey(openKey);

  const timeoutId = setTimeout(() => {
    // Fin du décompte : la fiche n'a pas été re-cliquée → on confirme.
    scheduledOpens.delete(openKey);
    removePendingKey(openKey);

    // Idempotence : ne pas écrire deux fois la même clé.
    if (!claimWrite(openKey)) {
      return;
    }

    void write()
      .then(() => {
        confirmWrite(openKey);
      })
      .catch(() => {
        // Échec → relâcher pour réessai à la prochaine fermeture de cette fiche.
        releaseWrite(openKey);
      });
  }, VERIDIAN_RECORD_OPEN_DELAY_MS);

  scheduledOpens.set(openKey, { timeoutId, write });
  return true;
};

/**
 * ANNULE le décompte d'une fiche (le commercial a RE-CLIQUÉ dessus pendant les
 * 10 s : fausse manip). Coupe le timer, retire la clé du pending atom (→ la row
 * arrête de scintiller). N'écrit RIEN : la fiche reste A_APPELER.
 *
 * @returns `true` si un décompte était bien en cours pour cette clé (→ le clic
 *   doit être CONSOMMÉ par l'appelant, la fiche ne doit PAS se ré-ouvrir),
 *   `false` sinon (aucun décompte → clic normal, laisser ouvrir).
 */
export const cancelRecordOpen = (openKey: string): boolean => {
  const existing = scheduledOpens.get(openKey);
  if (!existing) {
    return false;
  }
  clearTimeout(existing.timeoutId);
  scheduledOpens.delete(openKey);
  removePendingKey(openKey);
  return true;
};

/** True si un décompte de confirmation est actuellement en cours pour la clé. */
export const isRecordOpenPending = (openKey: string): boolean =>
  scheduledOpens.has(openKey);

/**
 * Réinitialise tout l'état du manager (timers + idempotence + pending atom).
 * Réservé aux tests (isolation entre cas) — pas d'usage en prod (l'état doit
 * persister pour la durée de vie de l'onglet).
 */
export const __resetRecordOpenManagerForTests = (): void => {
  for (const { timeoutId } of scheduledOpens.values()) {
    clearTimeout(timeoutId);
  }
  scheduledOpens.clear();
  recordOpenGuardState.clear();
  getStore().set(veridianPendingOpenKeysState.atom, new Set<string>());
};
