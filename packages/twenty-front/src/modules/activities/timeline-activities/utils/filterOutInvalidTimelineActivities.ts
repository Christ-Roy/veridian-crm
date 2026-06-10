import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { isVeridianBridgeScoreNoise } from '@/veridian-tunnel-timeline/utils/filterVeridianBridgeNoise';

export const filterOutInvalidTimelineActivities = (
  timelineActivities: TimelineActivity[],
  mainObjectSingularName: string,
  objectMetadataItems: EnrichedObjectMetadataItem[],
): TimelineActivity[] => {
  const mainObjectMetadataItem = objectMetadataItems.find(
    (objectMetadataItem) =>
      objectMetadataItem.nameSingular === mainObjectSingularName,
  );

  const noteObjectMetadataItem = objectMetadataItems.find(
    (objectMetadataItem) =>
      objectMetadataItem.nameSingular === CoreObjectNameSingular.Note,
  );

  if (!mainObjectMetadataItem || !noteObjectMetadataItem) {
    throw new Error('Object metadata items not found');
  }

  const fieldMetadataItemMap = new Map(
    mainObjectMetadataItem.readableFields.map((field) => [field.name, field]),
  );

  const noteFieldMetadataItemMap = new Map(
    noteObjectMetadataItem.readableFields.map((field) => [field.name, field]),
  );

  return timelineActivities.filter((timelineActivity) => {
    // Veridian patch (AGPL inline, cf VERIDIAN-PATCHES.md) : masque le bruit
    // des person.updated{score} écrits par le bridge (API key) — voir
    // filterVeridianBridgeNoise.ts. Les updates humaines restent visibles.
    if (isVeridianBridgeScoreNoise(timelineActivity)) {
      return false;
    }

    const diff = timelineActivity.properties?.diff;
    const canSkipValidation = !diff;

    if (canSkipValidation) {
      return true;
    }

    const isNoteOrTask =
      timelineActivity.name.startsWith('linked-note') ||
      timelineActivity.name.startsWith('linked-task');

    const validDiffEntries = Object.entries(diff).filter(([diffKey]) =>
      isNoteOrTask
        ? // Note and Task objects have the same field metadata
          noteFieldMetadataItemMap.has(diffKey)
        : fieldMetadataItemMap.has(diffKey),
    );

    if (validDiffEntries.length === 0) {
      return false;
    }

    timelineActivity.properties = {
      ...timelineActivity.properties,
      diff: Object.fromEntries(validDiffEntries),
    };

    return true;
  });
};
