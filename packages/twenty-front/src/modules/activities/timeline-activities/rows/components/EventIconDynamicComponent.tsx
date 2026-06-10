import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';
import { ObjectMetadataIcon } from '@/object-metadata/components/ObjectMetadataIcon';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { EventIconVeridianTunnel } from '@/veridian-tunnel-timeline/components/EventIconVeridianTunnel';
import { isVeridianTunnelEvent } from '@/veridian-tunnel-timeline/utils/veridianTunnelEvent';
import {
  IconCirclePlus,
  IconEditCircle,
  IconRestore,
  IconTrash,
} from 'twenty-ui/display';

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

  const [, eventAction] = event.name.split('.');

  if (eventAction === 'created') {
    return <IconCirclePlus />;
  }
  if (eventAction === 'updated') {
    return <IconEditCircle />;
  }
  if (eventAction === 'deleted') {
    return <IconTrash />;
  }
  if (eventAction === 'restored') {
    return <IconRestore />;
  }

  return <ObjectMetadataIcon objectMetadataItem={linkedObjectMetadataItem} />;
};
