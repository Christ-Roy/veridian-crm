import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';

// Veridian tunnel — réduction du bruit timeline produit par le bridge.
//
// Le bridge réconciliateur pousse le score via `PATCH /rest/people/{id}
// {score}` (contrat §4c.4). Chaque PATCH génère un event natif
// `person.updated` dont le `diff` ne contient QUE `{score}`. Sur un prospect
// actif ça empile des dizaines de lignes « score modifié » qui noient les vrais
// jalons (email.*, audit.*, score.threshold) et les updates humaines.
//
// Discriminant (carte reco §2, contrat §4c) : les écritures du bridge passent
// par API key → `workspaceMemberId === null`. Une update humaine a un
// workspaceMember non nul. On ne masque donc QUE les `*.updated` API-key dont
// le diff se limite au champ `score` — toute update humaine, ou toute update
// API touchant d'autres champs, reste visible.

const isScoreOnlyDiff = (diff: unknown): boolean => {
  if (diff == null || typeof diff !== 'object') {
    return false;
  }
  const keys = Object.keys(diff as Record<string, unknown>);
  return keys.length === 1 && keys[0] === 'score';
};

/**
 * Vrai si l'event doit être masqué : `person.updated` (ou tout `*.updated`)
 * écrit par le bridge (API key, `workspaceMemberId` nul) dont le diff = score
 * seul. Le `score.threshold` (jalon explicite, name tunnel) n'est PAS un
 * `.updated` → jamais concerné.
 */
export const isVeridianBridgeScoreNoise = (
  activity: TimelineActivity,
): boolean => {
  const [, action] = (activity.name ?? '').split('.');
  if (action !== 'updated') {
    return false;
  }
  // Update humaine (workspaceMember présent) → toujours visible.
  if (activity.workspaceMemberId != null) {
    return false;
  }
  return isScoreOnlyDiff(activity.properties?.diff);
};

export const filterOutVeridianBridgeNoise = (
  activities: TimelineActivity[],
): TimelineActivity[] =>
  activities.filter((activity) => !isVeridianBridgeScoreNoise(activity));
