// Veridian — module AGPL (fork twentyhq/twenty). Mécanique "ouverture de fiche".
//
// Atom GLOBAL qui porte l'`openKey` (`<objectNameSingular>:<recordId>`) de la
// fiche dont la FENÊTRE D'ANNULATION 5 s est actuellement active — ou `null`.
//
// Pourquoi un atom global et pas la garde module-level `recordOpenGuard` :
// `recordOpenGuard` est un `Map` non réactif (il sérialise les écritures, il ne
// déclenche pas de re-render). Pour faire RÉAGIR la LIGNE de la fiche dans la
// vue table (animation pendant les 5 s), il faut un état RÉACTIF jotai que la
// ligne (`RecordTableTr`) peut lire. L'`VeridianRecordOpenEffect` (côté fiche
// ouverte en side-panel/pleine page) le pose à l'ouverture de la fenêtre et le
// remet à `null` à la fin (confirmation OU annulation) → la row s'anime
// exactement pendant la fenêtre, puis s'arrête.
//
// Mono-valeur (une seule fenêtre active à la fois) : ouvrir une fiche pendant
// qu'une autre est en fenêtre remplace la clé active — cohérent avec le fait
// qu'un commercial ne travaille qu'une fiche à la fois.

import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

export const veridianActiveOpenKeyState = createAtomState<string | null>({
  key: 'veridianActiveOpenKeyState',
  defaultValue: null,
});
