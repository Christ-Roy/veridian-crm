import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';

// Auteur d'une activité écrite sans membre (clé API, worker, app). L'amont affiche le littéral « Twenty »,
// hors catalogue, donc hors de replaceBrandInMessages : la marque fuyait sur chaque ligne système.
export const VERIDIAN_SYSTEM_AUTHOR_FULL_NAME = 'Veridian CRM';

// Types de l'app « Téléphonie Veridian » (packages/twenty-apps/internal/veridian-telephonie/src/identifiants.ts) :
// leur ligne se lit seule, « Appel Entrant · 3 min 12 s », sans auteur devant.
const SELF_DESCRIBING_TIMELINE_ACTIVITY_TYPE_UNIVERSAL_IDENTIFIERS = new Set([
  '85be64c1-4057-4bc1-a2f7-b4a160ee1999',
  'ffb00bad-6200-43ac-a7bb-bb2dcac8d8a8',
]);

export const getVeridianSystemAuthorFullName = (
  event: Pick<TimelineActivity, 'timelineActivityTypeSnapshot'>,
) =>
  SELF_DESCRIBING_TIMELINE_ACTIVITY_TYPE_UNIVERSAL_IDENTIFIERS.has(
    event.timelineActivityTypeSnapshot?.universalIdentifier ?? '',
  )
    ? ''
    : VERIDIAN_SYSTEM_AUTHOR_FULL_NAME;
