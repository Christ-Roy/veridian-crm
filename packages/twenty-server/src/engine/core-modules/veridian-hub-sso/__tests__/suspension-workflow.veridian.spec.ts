import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { CronTriggerCronJob } from 'src/engine/core-modules/logic-function/logic-function-trigger/triggers/cron/cron-trigger.cron.job';
import { WorkflowCronTriggerCronJob } from 'src/modules/workflow/workflow-trigger/automated-trigger/crons/jobs/workflow-cron-trigger-cron.job';

jest.mock(
  'src/engine/core-modules/logic-function/logic-function-trigger/jobs/logic-function-trigger.job',
  () => ({ LogicFunctionTriggerJob: class LogicFunctionTriggerJob {} }),
);

jest.mock(
  'src/modules/workflow/workflow-runner/services/core-workflow-runner.service',
  () => ({ CoreWorkflowRunnerService: class CoreWorkflowRunnerService {} }),
);

// CONTRAT-HUB §5.4 : les crons natifs ne parcourent pas un espace suspendu. Le travail déjà en file : suspension-file.

describe('suspension Veridian : workflows et crons', () => {
  describe('crons natifs : seuls les espaces ACTIVE sont parcourus', () => {
    const espaces = [
      { id: 'ws-actif', activationStatus: WorkspaceActivationStatus.ACTIVE },
      {
        id: 'ws-suspendu',
        activationStatus: WorkspaceActivationStatus.SUSPENDED,
      },
    ];
    const depot = () => ({
      find: jest.fn(
        async ({
          where,
        }: {
          where: { activationStatus: WorkspaceActivationStatus | WorkspaceActivationStatus[] };
        }) =>
          espaces.filter((espace) =>
            [where.activationStatus]
              .flat()
              .includes(espace.activationStatus),
          ),
      ),
    });

    it('cron des workflows (reconstruction du cache) : aucun accès à l espace suspendu', async () => {
      const getOrRecompute = jest.fn().mockResolvedValue({
        workflowAutomatedTriggerMaps: { byWorkflowId: {} },
      });
      const job = new WorkflowCronTriggerCronJob(
        depot() as never,
        { add: jest.fn() } as never,
        { captureExceptions: jest.fn() } as never,
        { hashGetValues: jest.fn(async () => []), hashSetWithExpire: jest.fn() } as never,
        { shouldDispatch: jest.fn() } as never,
        {} as never,
        {} as never,
        { getOrRecompute } as never,
      );

      await job.handle();

      const visites = getOrRecompute.mock.calls.map(([id]) => id);

      expect(visites).toContain('ws-actif');
      expect(visites).not.toContain('ws-suspendu');
    });

    it('cron des fonctions logiques : aucun accès à l espace suspendu', async () => {
      const getOrRecompute = jest.fn().mockResolvedValue({
        flatLogicFunctionMaps: { byUniversalIdentifier: {} },
        flatApplicationMaps: { byId: {}, idByUniversalIdentifier: {} },
      });
      const job = new CronTriggerCronJob(
        { add: jest.fn() } as never,
        depot() as never,
        { getOrRecompute } as never,
        { captureExceptions: jest.fn() } as never,
        { shouldDispatch: jest.fn() } as never,
        {} as never,
        {} as never,
      );

      await job.handle();

      const visites = getOrRecompute.mock.calls.map(([id]) => id);

      expect(visites).toContain('ws-actif');
      expect(visites).not.toContain('ws-suspendu');
    });
  });
});
