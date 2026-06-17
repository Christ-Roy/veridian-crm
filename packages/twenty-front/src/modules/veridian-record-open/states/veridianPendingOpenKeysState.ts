// Veridian — module AGPL (fork twentyhq/twenty). Mécanique "ouverture de fiche".
//
// Atom GLOBAL réactif portant l'ENSEMBLE des `openKey`
// (`<objectNameSingular>:<recordId>`) dont le DÉCOMPTE DE CONFIRMATION est
// actuellement en cours — c.-à-d. les fiches qui viennent d'être FERMÉES et dont
// les 10 s n'ont pas encore expiré (ni été annulées par re-clic).
//
// POURQUOI UN SET (et plus une mono-valeur) : avec la nouvelle logique, le
// décompte démarre à la FERMETURE et SURVIT à la navigation. Un commercial peut
// fermer la fiche A (→ A en décompte), puis ouvrir+fermer la fiche B (→ B en
// décompte) AVANT que les 10 s de A ne soient écoulées. Plusieurs fiches peuvent
// donc scintiller en parallèle → il faut un ENSEMBLE de clés, pas une seule.
//
// POURQUOI UN ATOM (et pas seulement le Map de timers du `recordOpenManager`) :
// le Map de timers est NON réactif (il planifie/annule des écritures, il ne
// déclenche aucun re-render). Pour faire SCINTILLER la LIGNE de la fiche dans la
// vue table pendant le décompte, il faut un état RÉACTIF jotai que la row
// (`RecordTableTr`) peut lire. Le `recordOpenManager` (module-level) est le SEUL
// écrivain de cet atom : il ajoute la clé quand il arme le timer et la retire à
// la confirmation OU à l'annulation. La row n'en est que lectrice.
//
// La valeur est un `ReadonlySet<string>` immuable : chaque mutation crée un
// nouveau Set (référence neuve) → jotai détecte le changement et re-render les
// rows abonnées. (Muter le Set en place ne déclencherait aucun re-render.)

import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

export const veridianPendingOpenKeysState = createAtomState<
  ReadonlySet<string>
>({
  key: 'veridianPendingOpenKeysState',
  defaultValue: new Set<string>(),
});
