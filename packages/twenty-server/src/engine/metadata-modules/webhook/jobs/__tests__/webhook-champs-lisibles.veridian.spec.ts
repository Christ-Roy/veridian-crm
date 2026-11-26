import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import {
  FieldMetadataType,
  type ObjectRecordsPermissions,
} from 'twenty-shared/types';

import { createEmptyFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/constant/create-empty-flat-entity-maps.constant';
import { addFlatEntityToFlatEntityMapsOrThrow } from 'src/engine/metadata-modules/flat-entity/utils/add-flat-entity-to-flat-entity-maps-or-throw.util';
import { getFlatFieldMetadataMock } from 'src/engine/metadata-modules/flat-field-metadata/__mocks__/get-flat-field-metadata.mock';
import { getFlatObjectMetadataMock } from 'src/engine/metadata-modules/flat-object-metadata/__mocks__/get-flat-object-metadata.mock';
import { CallWebhookJobsJob } from 'src/engine/metadata-modules/webhook/jobs/call-webhook-jobs.job';
import { type CallWebhookJobData } from 'src/engine/metadata-modules/webhook/types/webhook-job-data.type';
import { filterReadableEvents } from 'src/engine/permissions/combine/utils/filter-readable-events.util';
import { type RoleRecordsPermissions } from 'src/engine/permissions/types/role-records-permissions.type';

const WORKSPACE_ID = 'workspace-id';
const OBJECT_ID = 'invoice-object-id';
const RESTRICTED_WEBHOOK_ID = 'webhook-restricted';
const OPEN_WEBHOOK_ID = 'webhook-open';

const invoice = getFlatObjectMetadataMock({
  id: OBJECT_ID,
  universalIdentifier: OBJECT_ID,
});

const flatObjectMetadataMaps = addFlatEntityToFlatEntityMapsOrThrow({
  flatEntity: invoice,
  flatEntityMaps: createEmptyFlatEntityMaps(),
});

const flatFieldMetadataMaps = [
  ['name-field-id', 'name'],
  ['secret-field-id', 'secret'],
]
  .map(([id, name]) =>
    getFlatFieldMetadataMock({
      id,
      universalIdentifier: id,
      objectMetadataId: OBJECT_ID,
      type: FieldMetadataType.TEXT,
      name,
    }),
  )
  .reduce(
    (maps, flatEntity) =>
      addFlatEntityToFlatEntityMapsOrThrow({
        flatEntity,
        flatEntityMaps: maps,
      }),
    createEmptyFlatEntityMaps(),
  );

const READ_ACCESS: ObjectRecordsPermissions = {
  canReadAllRecords: true,
  canUpdateAllRecords: false,
  canSoftDeleteAllRecords: false,
  canDestroyAllRecords: false,
  restrictedFields: {},
};

const permissionsByWebhookId: Record<
  string,
  Pick<RoleRecordsPermissions, 'objects'>
> = {
  [RESTRICTED_WEBHOOK_ID]: {
    objects: {
      [OBJECT_ID]: {
        ...READ_ACCESS,
        restrictedFields: {
          'secret-field-id': { canRead: false, canUpdate: false },
        },
      },
    },
  },
  [OPEN_WEBHOOK_ID]: { objects: { [OBJECT_ID]: READ_ACCESS } },
};

const buildUpdateEvent = (
  recordId: string,
  updatedFields: ('name' | 'secret')[],
): ObjectRecordUpdateEvent => ({
  recordId,
  properties: {
    updatedFields,
    before: { id: recordId, name: 'Old', secret: 'old' },
    after: { id: recordId, name: 'New', secret: 'new' },
    diff: Object.fromEntries(
      updatedFields.map((fieldName) => [
        fieldName,
        { before: 'old', after: 'new' },
      ]),
    ),
  },
});

const buildFlatWebhook = (id: string) => ({
  id,
  universalIdentifier: id,
  targetUrl: `https://example.com/${id}`,
  operations: ['invoice.updated'],
  secret: 'secret',
});

const run = async (
  events: ObjectRecordUpdateEvent[],
  webhookIds: string[] = [RESTRICTED_WEBHOOK_ID],
) => {
  const added: CallWebhookJobData[] = [];
  const findReadableEvents = jest.fn(
    async ({
      authContext,
      eventBatch,
    }: {
      authContext: { webhook: { id: string } };
      eventBatch: { events: ObjectRecordUpdateEvent[] };
    }) =>
      filterReadableEvents({
        events: eventBatch.events,
        readableRecordIds: new Set(['record-1', 'record-2']),
        objectMetadata: invoice,
        recordsPermissions: permissionsByWebhookId[authContext.webhook.id],
        metadataMaps: { flatObjectMetadataMaps, flatFieldMetadataMaps },
      }),
  );
  const job = new CallWebhookJobsJob(
    {
      add: jest.fn(async (_name: string, data: CallWebhookJobData[]) => {
        added.push(...data);
      }),
    } as never,
    {
      getOrRecompute: jest.fn(async () => ({
        flatWebhookMaps: {
          byUniversalIdentifier: Object.fromEntries(
            webhookIds.map((id) => [id, buildFlatWebhook(id)]),
          ),
        },
        flatObjectMetadataMaps,
        flatRoleTargetMaps: {
          byUniversalIdentifier: Object.fromEntries(
            webhookIds.map((id) => [
              id,
              { webhookId: id, roleId: `role-${id}` },
            ]),
          ),
        },
      })),
    } as never,
    { findReadableEvents } as never,
    {
      admitWebhookEventsWithinRateLimit: jest.fn(
        async ({ webhookEvents }) => webhookEvents,
      ),
    } as never,
  );

  await job.handle({
    workspaceId: WORKSPACE_ID,
    name: 'invoice.updated',
    objectMetadata: { id: OBJECT_ID, nameSingular: 'invoice' },
    events: events as never,
  });

  return { added, findReadableEvents };
};

describe('webhook payloads follow the role of the webhook', () => {
  it('should leave out a field the role cannot read', async () => {
    const { added } = await run([
      buildUpdateEvent('record-1', ['name', 'secret']),
    ]);

    expect(added).toHaveLength(1);
    expect(added[0].record).toEqual({ id: 'record-1', name: 'New' });
    expect(added[0].updatedFields).toEqual(['name']);
    expect(added[0].record).not.toHaveProperty('secret');
    expect(JSON.stringify(added[0])).not.toContain('"new"');
  });

  it('should not send an update that only touched unreadable fields', async () => {
    const { added } = await run([buildUpdateEvent('record-1', ['secret'])]);

    expect(added).toEqual([]);
  });

  it('should keep every field for a webhook without restriction', async () => {
    const { added } = await run(
      [buildUpdateEvent('record-1', ['secret'])],
      [OPEN_WEBHOOK_ID],
    );

    expect(added).toHaveLength(1);
    expect(added[0].record).toEqual({
      id: 'record-1',
      name: 'New',
      secret: 'new',
    });
    expect(added[0].updatedFields).toEqual(['secret']);
  });

  it('should still drop events on records the role cannot read', async () => {
    const { added } = await run([
      buildUpdateEvent('record-1', ['name']),
      buildUpdateEvent('record-9', ['name']),
    ]);

    expect(added.map(({ record }) => record.id)).toEqual(['record-1']);
  });

  it('should filter each webhook with its own role', async () => {
    const { added } = await run(
      [buildUpdateEvent('record-1', ['name', 'secret'])],
      [RESTRICTED_WEBHOOK_ID, OPEN_WEBHOOK_ID],
    );

    const byWebhook = Object.fromEntries(
      added.map((event) => [event.webhookId, event.record]),
    );

    expect(byWebhook[RESTRICTED_WEBHOOK_ID]).not.toHaveProperty('secret');
    expect(byWebhook[OPEN_WEBHOOK_ID]).toHaveProperty('secret', 'new');
  });

  it('should ask the permissions service once per role and pass the webhook as principal', async () => {
    const { findReadableEvents } = await run([
      buildUpdateEvent('record-1', ['name']),
    ]);

    expect(findReadableEvents).toHaveBeenCalledTimes(1);
    expect(findReadableEvents.mock.calls[0][0].authContext).toMatchObject({
      type: 'webhook',
      webhook: { id: RESTRICTED_WEBHOOK_ID },
    });
  });
});
