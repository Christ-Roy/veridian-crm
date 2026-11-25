import { isDefined } from 'twenty-shared/utils';
import { TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER } from 'twenty-shared/application';

import { getDatabaseCrudToolFlatObjects } from 'src/engine/metadata-modules/ai/ai-agent/utils/get-database-crud-tool-flat-objects.util';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';

export type ApiObject = {
  readable: boolean;
  writable: boolean;
  // Field name to the object it leads to, null when it leads nowhere.
  fields: ReadonlyMap<string, string | null>;
};

export type ApiObjects = ReadonlyMap<string, ApiObject>;

// Closed lists: a standard object upstream adds tomorrow is refused until someone decides. Members, mail, calendar,
// workflows, sharing and assistant threads are out (their own tools apply the visibility rules this one cannot).
const WRITABLE_STANDARD_OBJECTS = new Set([
  'company',
  'person',
  'opportunity',
  'task',
  'note',
  'taskTarget',
  'noteTarget',
]);

const READ_ONLY_STANDARD_OBJECTS = new Set([
  'workspaceMember',
  'attachment',
  'timelineActivity',
]);

const isStandard = ({ applicationUniversalIdentifier }: FlatObjectMetadata) =>
  applicationUniversalIdentifier ===
  TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER;

const isWritable = (flatObject: FlatObjectMetadata) =>
  isStandard(flatObject)
    ? WRITABLE_STANDARD_OBJECTS.has(flatObject.nameSingular)
    : flatObject.isSystem === false;

const isReadable = (flatObject: FlatObjectMetadata) =>
  isWritable(flatObject) ||
  (isStandard(flatObject) &&
    READ_ONLY_STANDARD_OBJECTS.has(flatObject.nameSingular));

export const buildApiObjects = ({
  flatObjectMetadataMaps,
  flatFieldMetadataMaps,
}: {
  flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata>;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
}): ApiObjects => {
  const fieldsByObject = new Map<string, Map<string, string | null>>();

  for (const field of Object.values(
    flatFieldMetadataMaps.byUniversalIdentifier,
  ).filter(isDefined)) {
    const fields =
      fieldsByObject.get(field.objectMetadataUniversalIdentifier) ?? new Map();

    fields.set(
      field.name,
      field.relationTargetObjectMetadataUniversalIdentifier ?? null,
    );
    fieldsByObject.set(field.objectMetadataUniversalIdentifier, fields);
  }

  return new Map(
    getDatabaseCrudToolFlatObjects(
      flatObjectMetadataMaps.byUniversalIdentifier,
    ).map((flatObject) => [
      flatObject.universalIdentifier,
      {
        readable: isReadable(flatObject),
        writable: isWritable(flatObject),
        fields: fieldsByObject.get(flatObject.universalIdentifier) ?? new Map(),
      },
    ]),
  );
};
