import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { CleanerWorkspaceService } from 'src/engine/workspace-manager/workspace-cleaner/services/cleaner.workspace-service';

// Suspension Veridian (CONTRAT-HUB §5.4) : le cron natif CleanSuspendedWorkspacesJob, mesuré vivant en prod chaque heure
// (25/11/2026), avertit à 7 j, efface à 14 j, détruit à 21 j. Deux coupures : suspendedAt à NULL, et le code du nettoyeur.

// Le vrai CleanerWorkspaceService est testé ; ses dépendances lourdes (chaîne d'apps, SDK, e-mails) sont
// remplacées par des coquilles, puisque la spec ne lit que la décision de date.
jest.mock('twenty-emails', () => ({
  CleanSuspendedWorkspaceEmail: () => ({}),
  WarnSuspendedWorkspaceEmail: () => ({}),
  renderEmail: async () => '',
}), { virtual: true });
jest.mock('src/engine/core-modules/user/services/user.service', () => ({ UserService: class {} }));
jest.mock('src/engine/core-modules/workspace/services/workspace.service', () => ({ WorkspaceService: class {} }));
jest.mock('src/engine/core-modules/email/email.service', () => ({ EmailService: class {} }));
jest.mock('src/engine/core-modules/i18n/i18n.service', () => ({ I18nService: class {} }));
jest.mock('src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service', () => ({
  WorkspaceDomainsService: class {},
}));
jest.mock('src/engine/core-modules/user/user-vars/services/user-vars.service', () => ({ UserVarsService: class {} }));
jest.mock('src/engine/core-modules/message-queue/services/message-queue.service', () => ({
  MessageQueueService: class {},
}));
jest.mock('src/engine/core-modules/message-queue/decorators/message-queue.decorator', () => ({
  InjectMessageQueue: () => () => undefined,
}));
jest.mock('src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator', () => ({
  InjectWorkspaceScopedRepository: () => () => undefined,
}));
jest.mock('src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository', () => ({
  WorkspaceScopedRepository: class {},
}));
jest.mock('src/engine/workspace-manager/workspace-cleaner/jobs/destroy-soft-deleted-workspace.job', () => ({
  DestroySoftDeletedWorkspaceJob: class {},
}));
jest.mock('src/modules/workspace-member/standard-objects/workspace-member.workspace-entity', () => ({
  WorkspaceMemberWorkspaceEntity: class {},
}));
jest.mock('src/engine/core-modules/billing/entities/billing-subscription.entity', () => ({
  BillingSubscriptionEntity: class {},
}));
jest.mock('src/engine/core-modules/billing/enums/billing-subscription-status.enum', () => ({
  SubscriptionStatus: {},
}));

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-24T12:00:00.000Z');

const CONFIG: Record<string, number> = {
  WORKSPACE_INACTIVE_DAYS_BEFORE_NOTIFICATION: 7,
  WORKSPACE_INACTIVE_DAYS_BEFORE_SOFT_DELETION: 14,
  WORKSPACE_INACTIVE_DAYS_BEFORE_DELETION: 21,
  MAX_NUMBER_OF_WORKSPACES_DELETED_PER_EXECUTION: 10,
};

const buildCleaner = (
  suspendedAt: Date | null,
  deletedAt: Date | null = null,
) => {
  const workspace = {
    id: 'ws-suspendu',
    displayName: 'Espace suspendu',
    activationStatus: WorkspaceActivationStatus.SUSPENDED,
    suspendedAt,
    deletedAt,
  };
  const workspaceRepository = {
    find: jest.fn().mockResolvedValue([workspace]),
  };
  const keyValuePairRepository = { find: jest.fn().mockResolvedValue([]) };
  const workspaceService = { deleteWorkspace: jest.fn() };
  const emailService = { send: jest.fn() };
  const destroyQueue = { add: jest.fn() };
  const config = { get: jest.fn((key: string) => CONFIG[key]) };

  const cleaner = new CleanerWorkspaceService(
    workspaceService as never,
    config as never,
    {} as never,
    {} as never,
    emailService as never,
    workspaceRepository as never,
    keyValuePairRepository as never,
    {} as never,
    {} as never,
    {} as never,
    destroyQueue as never,
  );

  const warn = jest
    .spyOn(cleaner, 'warnWorkspaceMembers')
    .mockResolvedValue(undefined);
  const inform = jest
    .spyOn(cleaner, 'informWorkspaceMembersAndSoftDeleteWorkspace')
    .mockResolvedValue(undefined);

  const run = () =>
    cleaner.batchWarnOrCleanSuspendedWorkspaces({
      workspaceIds: [workspace.id],
    });

  return { run, warn, inform, emailService, workspaceService, destroyQueue };
};

const expectNothingTouched = (fixture: ReturnType<typeof buildCleaner>) => {
  expect(fixture.warn).not.toHaveBeenCalled();
  expect(fixture.inform).not.toHaveBeenCalled();
  expect(fixture.emailService.send).not.toHaveBeenCalled();
  expect(fixture.workspaceService.deleteWorkspace).not.toHaveBeenCalled();
  expect(fixture.destroyQueue.add).not.toHaveBeenCalled();
};

describe('suspension Veridian : données intactes face au cron natif', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([14, 21, 400])(
    'suspendedAt NULL : à %i jours, aucun email, aucune suppression',
    async (days) => {
      jest.setSystemTime(new Date(NOW.getTime() + days * DAY_MS));
      const fixture = buildCleaner(null);

      await fixture.run();

      expectNothingTouched(fixture);
    },
  );

  // Deuxième coupure : même une date posée (facturation native, migration, main) n'efface ni n'écrit à personne.
  it.each([8, 14, 21, 400])(
    'suspendedAt posé il y a %i jours : toujours aucun email, aucune suppression',
    async (days) => {
      const fixture = buildCleaner(new Date(NOW.getTime() - days * DAY_MS));

      await fixture.run();

      expectNothingTouched(fixture);
    },
  );

  // Contrôle positif : la boucle tourne et agit encore sur un espace déjà supprimé par le Hub.
  it('espace supprimé depuis longtemps : sa destruction reste demandée', async () => {
    const fixture = buildCleaner(null, new Date(NOW.getTime() - 400 * DAY_MS));

    await fixture.run();

    expect(fixture.destroyQueue.add).toHaveBeenCalledTimes(1);
  });
});
