// Les quatre vues natives des tâches : « Tâches » (nature HUMAIN, le temps de Robert) et « Production » (nature IA),
// chacune en tableau et en kanban groupé par importance (Robert y range ses priorités par glisser-déposer).
// Les tâches faites sont filtrées. Grouper sur une RELATION donne une vue vide : on groupe sur le SELECT importance.
import { STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS, ViewFilterOperand, ViewOpenRecordIn, ViewSortDirection, ViewType } from 'twenty-sdk/define';

import {
  A_CONTACTER_ON_TASK_UNIVERSAL_IDENTIFIER,
  BESOIN_AGENDA_ON_TASK_UNIVERSAL_IDENTIFIER,
  DUREE_ON_TASK_UNIVERSAL_IDENTIFIER,
  IMPORTANCE_ON_TASK_UNIVERSAL_IDENTIFIER,
  NATURE_ON_TASK_UNIVERSAL_IDENTIFIER,
  RANGEMENT_ON_TASK_UNIVERSAL_IDENTIFIER,
} from '../identifiants';
import { IMPORTANCES } from './importance.util';
import { type Nature } from './nature.util';
import { uuidStable } from './uuid-stable.util';

const TASK = STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.task;

const COLONNES: [string, string, number][] = [
  ['title', TASK.fields.title.universalIdentifier, 320],
  ['importance', IMPORTANCE_ON_TASK_UNIVERSAL_IDENTIFIER, 110],
  ['status', TASK.fields.status.universalIdentifier, 110],
  ['dueAt', TASK.fields.dueAt.universalIdentifier, 130],
  ['besoinAgenda', BESOIN_AGENDA_ON_TASK_UNIVERSAL_IDENTIFIER, 140],
  ['dureeEstimee', DUREE_ON_TASK_UNIVERSAL_IDENTIFIER, 120],
  ['aContacter', A_CONTACTER_ON_TASK_UNIVERSAL_IDENTIFIER, 160],
  ['rangement', RANGEMENT_ON_TASK_UNIVERSAL_IDENTIFIER, 180],
  ['nature', NATURE_ON_TASK_UNIVERSAL_IDENTIFIER, 110],
];

export const vueTaches = ({ id, nom, nature, kanban, position }: { id: string; nom: string; nature: Nature; kanban: boolean; position: number }) => ({
  universalIdentifier: id,
  name: nom,
  objectUniversalIdentifier: TASK.universalIdentifier,
  type: kanban ? ViewType.KANBAN : ViewType.TABLE,
  icon: kanban ? 'IconLayoutKanban' : nature === 'HUMAIN' ? 'IconUserCheck' : 'IconRobot',
  position,
  openRecordIn: ViewOpenRecordIn.SIDE_PANEL,
  ...(kanban ? { mainGroupByFieldMetadataUniversalIdentifier: IMPORTANCE_ON_TASK_UNIVERSAL_IDENTIFIER, shouldHideEmptyGroups: false } : {}),
  fields: COLONNES.map(([nomChamp, champ, size], i) => ({
    universalIdentifier: uuidStable(`${id}:colonne:${nomChamp}`),
    fieldMetadataUniversalIdentifier: champ,
    position: i,
    isVisible: true,
    size,
  })),
  filters: [
    {
      universalIdentifier: uuidStable(`${id}:filtre:nature`),
      fieldMetadataUniversalIdentifier: NATURE_ON_TASK_UNIVERSAL_IDENTIFIER,
      operand: ViewFilterOperand.IS,
      value: [nature],
    },
    {
      universalIdentifier: uuidStable(`${id}:filtre:pas-faites`),
      fieldMetadataUniversalIdentifier: TASK.fields.status.universalIdentifier,
      operand: ViewFilterOperand.IS_NOT,
      value: ['DONE'],
    },
  ],
  // Le kanban garde l'ordre posé à la main (glisser-déposer) : pas de tri imposé.
  sorts: kanban
    ? []
    : [
        { universalIdentifier: uuidStable(`${id}:tri:importance`), fieldMetadataUniversalIdentifier: IMPORTANCE_ON_TASK_UNIVERSAL_IDENTIFIER, direction: ViewSortDirection.ASC },
        { universalIdentifier: uuidStable(`${id}:tri:echeance`), fieldMetadataUniversalIdentifier: TASK.fields.dueAt.universalIdentifier, direction: ViewSortDirection.ASC },
      ],
  groups: kanban
    ? IMPORTANCES.map((valeur, position) => ({ universalIdentifier: uuidStable(`${id}:groupe:${valeur}`), fieldValue: valeur, position, isVisible: true }))
    : [],
});
