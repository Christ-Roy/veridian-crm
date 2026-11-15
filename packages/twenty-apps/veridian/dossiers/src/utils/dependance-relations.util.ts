// Les quatre champs de relation de la dépendance, déclarés ensemble : `dependance.tache` ↔ `task.prerequis`
// (ce que la tâche attend) et `dependance.prerequis` ↔ `task.bloque` (ce que la tâche bloque).
import { FieldType, OnDeleteAction, RelationType, STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS } from 'twenty-sdk/define';

import {
  BLOQUE_ON_TASK_UNIVERSAL_IDENTIFIER,
  DEPENDANCE_UNIVERSAL_IDENTIFIER,
  PREREQUIS_ON_DEPENDANCE_UNIVERSAL_IDENTIFIER,
  PREREQUIS_ON_TASK_UNIVERSAL_IDENTIFIER,
  TACHE_ON_DEPENDANCE_UNIVERSAL_IDENTIFIER,
} from '../identifiants';

const TASK = STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.task.universalIdentifier;

const versTache = (id: string, name: string, label: string, reverse: string, join: string) => ({
  universalIdentifier: id,
  objectUniversalIdentifier: DEPENDANCE_UNIVERSAL_IDENTIFIER,
  type: FieldType.RELATION as FieldType.RELATION,
  name,
  label,
  icon: 'IconCheckbox',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: TASK,
  relationTargetFieldMetadataUniversalIdentifier: reverse,
  // Une tâche supprimée emporte ses liens de dépendance : un lien vers rien n'a pas de sens.
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE as RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE as OnDeleteAction.CASCADE,
    joinColumnName: join,
  },
});

const depuisTache = (id: string, name: string, label: string, reverse: string) => ({
  universalIdentifier: id,
  objectUniversalIdentifier: TASK,
  type: FieldType.RELATION as FieldType.RELATION,
  name,
  label,
  icon: 'IconArrowsJoin',
  relationTargetObjectMetadataUniversalIdentifier: DEPENDANCE_UNIVERSAL_IDENTIFIER,
  relationTargetFieldMetadataUniversalIdentifier: reverse,
  universalSettings: { relationType: RelationType.ONE_TO_MANY as RelationType.ONE_TO_MANY },
});

export const TACHE_ON_DEPENDANCE = versTache(
  TACHE_ON_DEPENDANCE_UNIVERSAL_IDENTIFIER, 'tache', 'Tâche qui attend', PREREQUIS_ON_TASK_UNIVERSAL_IDENTIFIER, 'tacheId');
export const PREREQUIS_ON_DEPENDANCE = versTache(
  PREREQUIS_ON_DEPENDANCE_UNIVERSAL_IDENTIFIER, 'prerequis', 'Prérequis', BLOQUE_ON_TASK_UNIVERSAL_IDENTIFIER, 'prerequisId');
export const PREREQUIS_ON_TASK = depuisTache(
  PREREQUIS_ON_TASK_UNIVERSAL_IDENTIFIER, 'prerequis', 'Attend', TACHE_ON_DEPENDANCE_UNIVERSAL_IDENTIFIER);
export const BLOQUE_ON_TASK = depuisTache(
  BLOQUE_ON_TASK_UNIVERSAL_IDENTIFIER, 'bloque', 'Bloque', PREREQUIS_ON_DEPENDANCE_UNIVERSAL_IDENTIFIER);
