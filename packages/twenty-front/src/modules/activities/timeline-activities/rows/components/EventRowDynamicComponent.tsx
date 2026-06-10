import { EventRowActivity } from '@/activities/timeline-activities/rows/activity/components/EventRowActivity';
import { EventRowCalendarEvent } from '@/activities/timeline-activities/rows/calendar/components/EventRowCalendarEvent';
import { type EventRowDynamicComponentProps } from '@/activities/timeline-activities/rows/components/EventRowDynamicComponent.types';
import { EventRowMainObject } from '@/activities/timeline-activities/rows/main-object/components/EventRowMainObject';
import { EventRowMessage } from '@/activities/timeline-activities/rows/message/components/EventRowMessage';
import { EventRowVeridianTunnel } from '@/veridian-tunnel-timeline/components/EventRowVeridianTunnel';
import { isVeridianTunnelEvent } from '@/veridian-tunnel-timeline/utils/veridianTunnelEvent';
import { CoreObjectNameSingular } from 'twenty-shared/types';

export const EventRowDynamicComponent = ({
  labelIdentifierValue,
  event,
  mainObjectMetadataItem,
  linkedObjectMetadataItem,
  authorFullName,
  createdAt,
}: EventRowDynamicComponentProps) => {
  // Veridian patch (AGPL inline, cf VERIDIAN-PATCHES.md) : les events tunnel
  // (email.*/audit.*/score.*) n'ont pas de linkedObjectMetadataId → le switch
  // natif les enverrait sur EventRowMainObject qui retourne null (ligne vide).
  // On les route vers le rendu tunnel AVANT le switch.
  if (isVeridianTunnelEvent(event.name)) {
    return <EventRowVeridianTunnel event={event} />;
  }

  switch (linkedObjectMetadataItem?.nameSingular) {
    case 'calendarEvent':
      return (
        <EventRowCalendarEvent
          labelIdentifierValue={labelIdentifierValue}
          event={event}
          mainObjectMetadataItem={mainObjectMetadataItem}
          linkedObjectMetadataItem={linkedObjectMetadataItem}
          authorFullName={authorFullName}
        />
      );
    case 'message':
      return (
        <EventRowMessage
          labelIdentifierValue={labelIdentifierValue}
          event={event}
          mainObjectMetadataItem={mainObjectMetadataItem}
          linkedObjectMetadataItem={linkedObjectMetadataItem}
          authorFullName={authorFullName}
        />
      );
    case 'task':
      return (
        <EventRowActivity
          labelIdentifierValue={labelIdentifierValue}
          event={event}
          mainObjectMetadataItem={mainObjectMetadataItem}
          linkedObjectMetadataItem={linkedObjectMetadataItem}
          authorFullName={authorFullName}
          objectNameSingular={CoreObjectNameSingular.Task}
          createdAt={createdAt}
        />
      );
    case 'note':
      return (
        <EventRowActivity
          labelIdentifierValue={labelIdentifierValue}
          event={event}
          mainObjectMetadataItem={mainObjectMetadataItem}
          linkedObjectMetadataItem={linkedObjectMetadataItem}
          authorFullName={authorFullName}
          objectNameSingular={CoreObjectNameSingular.Note}
          createdAt={createdAt}
        />
      );
    default:
      return (
        <EventRowMainObject
          labelIdentifierValue={labelIdentifierValue}
          event={event}
          mainObjectMetadataItem={mainObjectMetadataItem}
          linkedObjectMetadataItem={linkedObjectMetadataItem}
          authorFullName={authorFullName}
          createdAt={createdAt}
        />
      );
  }
};
