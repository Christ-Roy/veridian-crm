import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { VeridianHubSuspensionService } from 'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-suspension.service';

jest.mock(
  'src/engine/core-modules/veridian-hub-sso/services/veridian-hub-sso.service',
  () => ({
    hubTenantKey: (tenantId: string) => `veridian.hub_tenant:${tenantId}`,
  }),
);
jest.mock(
  'src/engine/core-modules/workspace/services/workspace.service',
  () => ({
    WorkspaceService: class WorkspaceService {},
  }),
);
jest.mock(
  'src/engine/core-entity-cache/services/core-entity-cache.service',
  () => ({
    CoreEntityCacheService: class CoreEntityCacheService {},
  }),
);
jest.mock(
  'src/engine/core-modules/key-value-pair/key-value-pair.entity',
  () => ({
    KeyValuePairEntity: class KeyValuePairEntity {},
  }),
);
jest.mock('src/engine/core-modules/workspace/workspace.entity', () => ({
  WorkspaceEntity: class WorkspaceEntity {},
}));

const TENANT = 'tenant-1';
const WORKSPACE = 'ws-1';

const build = (activationStatus: WorkspaceActivationStatus) => {
  const link = {
    id: 'kv-1',
    workspaceId: WORKSPACE,
    value: { ownerEmail: 'a@b.c' },
  };
  const keyValuePairRepository = {
    findOne: jest.fn().mockResolvedValue(link),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const workspaceRepository = {
    findOne: jest
      .fn()
      .mockResolvedValue({ id: WORKSPACE, activationStatus, deletedAt: null }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const workspaceService = {
    reactivateWorkspace: jest.fn().mockResolvedValue(true),
  };
  const eventEmitter = { emit: jest.fn() };
  const coreEntityCacheService = { invalidate: jest.fn() };

  const service = new VeridianHubSuspensionService(
    keyValuePairRepository as never,
    workspaceRepository as never,
    workspaceService as never,
    eventEmitter as never,
    coreEntityCacheService as never,
  );

  return {
    service,
    keyValuePairRepository,
    workspaceRepository,
    workspaceService,
    eventEmitter,
  };
};

describe('suspension Veridian (service)', () => {
  it('suspend : passe SUSPENDED sans poser suspendedAt, émet l événement natif, garde la date sur le lien', async () => {
    const fixture = build(WorkspaceActivationStatus.ACTIVE);

    const outcome = await fixture.service.suspend(TENANT, 'admin_action');

    expect(outcome.status).toBe('ok');
    const [, patch] = fixture.workspaceRepository.update.mock.calls[0];
    expect(patch).toEqual({
      activationStatus: WorkspaceActivationStatus.SUSPENDED,
      suspendedAt: null,
    });
    expect(fixture.eventEmitter.emit).toHaveBeenCalledTimes(1);
    const [, linkPatch] = fixture.keyValuePairRepository.update.mock.calls[0];
    expect(linkPatch.value).toMatchObject({ suspendedReason: 'admin_action' });
    expect(linkPatch.value.suspendedAt).toEqual(expect.any(String));
  });

  it('suspend idempotent : déjà suspendu, aucune écriture sur l espace', async () => {
    const fixture = build(WorkspaceActivationStatus.SUSPENDED);

    const outcome = await fixture.service.suspend(TENANT, 'quota_exceeded');

    expect(outcome.status).toBe('ok');
    expect(fixture.workspaceRepository.update).not.toHaveBeenCalled();
    expect(fixture.eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('tenant inconnu : not_found', async () => {
    const fixture = build(WorkspaceActivationStatus.ACTIVE);
    fixture.keyValuePairRepository.findOne.mockResolvedValue(null);

    expect(await fixture.service.suspend(TENANT, 'admin_action')).toEqual({
      status: 'not_found',
    });
  });

  it('resume : repasse par reactivateWorkspace natif, puis note resumed_at', async () => {
    const fixture = build(WorkspaceActivationStatus.SUSPENDED);

    const outcome = await fixture.service.resume(TENANT);

    expect(outcome.status).toBe('ok');
    expect(fixture.workspaceService.reactivateWorkspace).toHaveBeenCalledWith(
      WORKSPACE,
    );
    const [, linkPatch] = fixture.keyValuePairRepository.update.mock.calls[0];
    expect(linkPatch.value.resumedAt).toEqual(expect.any(String));
  });

  it('resume sur espace actif : aucune réactivation', async () => {
    const fixture = build(WorkspaceActivationStatus.ACTIVE);

    await fixture.service.resume(TENANT);

    expect(fixture.workspaceService.reactivateWorkspace).not.toHaveBeenCalled();
  });
});
