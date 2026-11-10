import { t } from '@lingui/core/macro';
import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';
import { type CurrentWorkspaceMember } from '@/auth/states/currentWorkspaceMemberState';
import { getVeridianSystemAuthorFullName } from '@/veridian-brand/getVeridianSystemAuthorFullName';
import { isDefined } from 'twenty-shared/utils';

export const getTimelineActivityAuthorFullName = (
  event: TimelineActivity,
  currentWorkspaceMember: CurrentWorkspaceMember,
) => {
  if (isDefined(event.workspaceMember)) {
    return currentWorkspaceMember.id === event.workspaceMember.id
      ? t`You`
      : `${event.workspaceMember?.name.firstName} ${event.workspaceMember?.name.lastName}`;
  }
  // Veridian (VERIDIAN-PATCHES.md) : ni « Twenty » ni auteur devant une ligne qui se décrit seule.
  return getVeridianSystemAuthorFullName(event);
};
