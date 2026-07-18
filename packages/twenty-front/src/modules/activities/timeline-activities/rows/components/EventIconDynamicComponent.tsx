import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';
import { ObjectMetadataIcon } from '@/object-metadata/components/ObjectMetadataIcon';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { EventIconVeridianTunnel } from '@/veridian-tunnel-timeline/components/EventIconVeridianTunnel';
import { isVeridianTunnelEvent } from '@/veridian-tunnel-timeline/utils/veridianTunnelEvent';
import {
  parseTimelineActivityAction,
  type TimelineActivityAction,
} from 'twenty-shared/timeline';
import {
  IconCirclePlus,
  IconEditCircle,
  type IconComponent,
  IconRestore,
  IconTrash,
} from 'twenty-ui/icon';

const RECORD_CHANGE_ICONS: Partial<
  Record<TimelineActivityAction, IconComponent>
> = {
  created: IconCirclePlus,
  updated: IconEditCircle,
  deleted: IconTrash,
  restored: IconRestore,
};

export const EventIconDynamicComponent = ({
  event,
  linkedObjectMetadataItem,
}: {
  event: TimelineActivity;
  linkedObjectMetadataItem: EnrichedObjectMetadataItem | null;
}) => {
  // Veridian patch (AGPL inline, cf VERIDIAN-PATCHES.md) : icône parlante pour
  // les events tunnel (linkedObjectMetadataItem=null → sinon Icon123).
  if (isVeridianTunnelEvent(event.name)) {
    return <EventIconVeridianTunnel eventName={event.name} />;
  }

  const action = parseTimelineActivityAction(event.name);

  const ActionIcon = RECORD_CHANGE_ICONS[action];

  if (ActionIcon) {
    return <ActionIcon />;
  }

  return <ObjectMetadataIcon objectMetadataItem={linkedObjectMetadataItem} />;
};
