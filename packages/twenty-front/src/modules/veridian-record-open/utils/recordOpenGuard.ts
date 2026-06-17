// Veridian — module AGPL (fork twentyhq/twenty). Mécanique "ouverture de fiche".
//
// Garde d'idempotence PARTAGÉE entre toutes les instances montées de
// `VeridianRecordOpenEffect` (pleine page ET side-panel). Dans Twenty, ouvrir
// une ligne depuis la liste monte un side-panel ; cliquer "ouvrir en grand"
// monte la pleine page. La même fiche peut donc être montée 2× SIMULTANÉMENT
// (side-panel + pleine page) → 2 timers 5 s → risque de DOUBLE écriture.
//
// La garde par `useRef` de l'ancien composant est PAR INSTANCE : elle ne couvre
// pas le cas 2 instances concurrentes. Cette garde-ci est un état MODULE-LEVEL
// (un seul par onglet navigateur) qui sérialise les ouvertures par `openKey`
// (`<objectNameSingular>:<recordId>`) : la PREMIÈRE instance qui confirme
// "réclame" la clé ; toute autre instance qui confirme la même clé pendant que
// la première est en vol (ou déjà confirmée) ne ré-écrit pas.
//
// Pas de jotai/recoil ici : un module-level `Map` suffit (état purement client,
// non sérialisé, non rendu) et reste testable/réinitialisable.

/**
 * États possibles d'un `openKey` dans la garde partagée :
 * - `'inflight'` : une instance a confirmé (≥ 5 s) et l'update est en cours
 *   d'envoi. Toute autre confirmation concurrente est ignorée.
 * - `'confirmed'` : l'update a réussi. La fiche est ouverte ; on ne ré-écrit
 *   plus tant que la clé n'est pas relâchée (changement de recordId / refresh).
 *
 * En cas d'échec d'update, la clé est RELÂCHÉE (supprimée) → une prochaine
 * ouverture confirmée de la même fiche réessaiera.
 */
type RecordOpenState = 'inflight' | 'confirmed';

const recordOpenGuardState = new Map<string, RecordOpenState>();

/**
 * Construit la clé d'ouverture canonique. Une seule source de vérité pour le
 * format, partagée par l'Effect et la garde.
 */
export const buildRecordOpenKey = (
  objectNameSingular: string,
  recordId: string,
): string => `${objectNameSingular}:${recordId}`;

/**
 * Tente de RÉCLAMER l'écriture pour cette `openKey`.
 *
 * @returns `true` si l'appelant a obtenu le droit d'écrire (clé passée en
 *   `inflight`), `false` si une autre instance détient déjà la clé
 *   (`inflight` ou `confirmed`) → l'appelant ne doit PAS écrire.
 *
 * Atomique vis-à-vis du single-thread JS : entre le `has` et le `set` il n'y a
 * pas de point de await, donc deux timers qui expirent sur le même tick sont
 * sérialisés (le premier réclame, le second voit `inflight`).
 */
export const claimRecordOpen = (openKey: string): boolean => {
  if (recordOpenGuardState.has(openKey)) {
    return false;
  }
  recordOpenGuardState.set(openKey, 'inflight');
  return true;
};

/** Marque la clé comme confirmée (update réussi). */
export const confirmRecordOpen = (openKey: string): void => {
  recordOpenGuardState.set(openKey, 'confirmed');
};

/**
 * Relâche la clé (update échoué) → réessai possible à la prochaine ouverture
 * confirmée. No-op si la clé n'est pas détenue.
 */
export const releaseRecordOpen = (openKey: string): void => {
  recordOpenGuardState.delete(openKey);
};

/** True si la clé est déjà réclamée (inflight ou confirmée). */
export const isRecordOpenClaimed = (openKey: string): boolean =>
  recordOpenGuardState.has(openKey);

/**
 * Réinitialise toute la garde. Réservé aux tests (isolation entre cas) — pas
 * d'usage en prod (l'état doit persister pour la durée de vie de l'onglet).
 */
export const __resetRecordOpenGuardForTests = (): void => {
  recordOpenGuardState.clear();
};
