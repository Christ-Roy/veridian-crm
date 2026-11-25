import { FieldMetadataType } from 'twenty-shared/types';
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
  hidden: ReadonlySet<string>;
  // When set, nothing else of the object is readable.
  only?: ReadonlySet<string>;
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

// Who is in charge, not how they set their screen.
const READABLE_FIELDS: Record<string, ReadonlySet<string>> = {
  workspaceMember: new Set(['id', 'name', 'userEmail']),
};

// A file is served by a signed link that outlives the session: the record is readable, the link stays on screen.
const FILE_LINK_FIELDS = new Set(['fullPath', 'avatarUrl']);

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
  const hiddenByObject = new Map<string, Set<string>>();

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

    if (
      field.type === FieldMetadataType.FILES ||
      FILE_LINK_FIELDS.has(field.name)
    ) {
      const hidden =
        hiddenByObject.get(field.objectMetadataUniversalIdentifier) ??
        new Set<string>();

      hidden.add(field.name);
      hiddenByObject.set(field.objectMetadataUniversalIdentifier, hidden);
    }
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
        hidden: hiddenByObject.get(flatObject.universalIdentifier) ?? new Set(),
        only: isStandard(flatObject)
          ? READABLE_FIELDS[flatObject.nameSingular]
          : undefined,
      },
    ]),
  );
};
