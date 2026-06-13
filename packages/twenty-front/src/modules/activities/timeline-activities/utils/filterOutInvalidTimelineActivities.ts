import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';
import { findFieldMetadataItemByDiffKey } from '@/activities/timeline-activities/utils/findFieldMetadataItemByDiffKey';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { isVeridianBridgeScoreNoise } from '@/veridian-tunnel-timeline/utils/filterVeridianBridgeNoise';
import { isDefined } from 'twenty-shared/utils';

const keepActivityWithReadableDiff = (
  timelineActivity: TimelineActivity,
  readableFields: FieldMetadataItem[],
): TimelineActivity | undefined => {
  const validDiffEntries = Object.entries(
    timelineActivity.properties?.diff ?? {},
  ).filter(([diffKey]) =>
    isDefined(findFieldMetadataItemByDiffKey(readableFields, diffKey)),
  );

  if (validDiffEntries.length === 0) {
    return undefined;
  }

  return {
    ...timelineActivity,
    properties: {
      ...timelineActivity.properties,
      diff: Object.fromEntries(validDiffEntries),
    },
  };
};

export const filterOutInvalidTimelineActivities = (
  timelineActivities: TimelineActivity[],
  mainObjectSingularName: string,
  objectMetadataItems: EnrichedObjectMetadataItem[],
): TimelineActivity[] => {
  const mainObjectMetadataItem = objectMetadataItems.find(
    (objectMetadataItem) =>
      objectMetadataItem.nameSingular === mainObjectSingularName,
  );

  if (!isDefined(mainObjectMetadataItem)) {
    throw new Error('Object metadata item not found');
  }

  return timelineActivities
    .map((timelineActivity) => {
      // Veridian patch (AGPL inline, cf VERIDIAN-PATCHES.md) : masque le bruit
      // des person.updated{score} écrits par le bridge (API key) — voir
      // filterVeridianBridgeNoise.ts. Les updates humaines restent visibles.
      // Dans cette structure .map().filter(isDefined), exclure = return undefined.
      if (isVeridianBridgeScoreNoise(timelineActivity)) {
        return undefined;
      }

      const [objectName, action] = timelineActivity.name.split('.');

      if (objectName.startsWith('linked-')) {
        if (!isDefined(timelineActivity.properties?.diff)) {
          return timelineActivity;
        }

        const linkedObjectMetadataItem = objectMetadataItems.find(
          (objectMetadataItem) =>
            objectMetadataItem.nameSingular ===
            objectName.replace('linked-', ''),
        );

        return keepActivityWithReadableDiff(
          timelineActivity,
          linkedObjectMetadataItem?.readableFields ?? [],
        );
      }

      if (action === 'updated') {
        return keepActivityWithReadableDiff(
          timelineActivity,
          mainObjectMetadataItem.readableFields,
        );
      }

      return timelineActivity;
    })
    .filter(isDefined);
};
