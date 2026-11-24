import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { CleanerWorkspaceService } from 'src/engine/workspace-manager/workspace-cleaner/services/cleaner.workspace-service';

// Suspension Veridian (CONTRAT-HUB §5.4) : le cron natif CleanSuspendedWorkspacesJob efface un espace
// dont suspendedAt est posé (avertissement à 7 j, effacement à 14 j, destruction à 21 j). La suspension
// Veridian laisse suspendedAt à NULL : le service natif reste donc muet, à toute date.

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-24T12:00:00.000Z');

const CONFIG: Record<string, number> = {
  WORKSPACE_INACTIVE_DAYS_BEFORE_NOTIFICATION: 7,
  WORKSPACE_INACTIVE_DAYS_BEFORE_SOFT_DELETION: 14,
  WORKSPACE_INACTIVE_DAYS_BEFORE_DELETION: 21,
  MAX_NUMBER_OF_WORKSPACES_DELETED_PER_EXECUTION: 10,
};

const buildCleaner = (suspendedAt: Date | null) => {
  const workspace = {
    id: 'ws-suspendu',
    displayName: 'Espace suspendu',
    activationStatus: WorkspaceActivationStatus.SUSPENDED,
    suspendedAt,
    deletedAt: null,
  };
  const workspaceRepository = { find: jest.fn().mockResolvedValue([workspace]) };
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

const expectNothingTouched = (
  fixture: ReturnType<typeof buildCleaner>,
) => {
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

  // Contrôle positif : la même mécanique, suspendedAt posé, doit agir. Sans lui, l'absence ne prouve rien.
  it.each([
    { days: 14, method: 'warn' as const },
    { days: 21, method: 'inform' as const },
    { days: 400, method: 'inform' as const },
  ])(
    'contrôle positif : suspendedAt posé il y a $days jours, le cron agit',
    async ({ days, method }) => {
      const fixture = buildCleaner(new Date(NOW.getTime() - days * DAY_MS));

      await fixture.run();

      expect(fixture[method]).toHaveBeenCalledTimes(1);
    },
  );
});
