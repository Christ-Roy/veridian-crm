import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { CronTriggerCronJob } from 'src/engine/core-modules/logic-function/logic-function-trigger/triggers/cron/cron-trigger.cron.job';
import { WorkflowCronTriggerCronJob } from 'src/modules/workflow/workflow-trigger/automated-trigger/crons/jobs/workflow-cron-trigger-cron.job';
import { WorkflowTriggerJob } from 'src/modules/workflow/workflow-trigger/jobs/workflow-trigger.job';

jest.mock(
  'src/engine/core-modules/logic-function/logic-function-trigger/jobs/logic-function-trigger.job',
  () => ({ LogicFunctionTriggerJob: class LogicFunctionTriggerJob {} }),
);

jest.mock(
  'src/modules/workflow/workflow-runner/services/core-workflow-runner.service',
  () => ({ CoreWorkflowRunnerService: class CoreWorkflowRunnerService {} }),
);

// CONTRAT-HUB §5.4 : un espace suspendu ne lance aucun workflow (déclencheur base, cron, envoi déjà en file)
// et les crons de logique ne le parcourent pas.

const SUSPENDU = {
  activationStatus: WorkspaceActivationStatus.SUSPENDED,
  deletedAt: null,
};
const ACTIF = {
  activationStatus: WorkspaceActivationStatus.ACTIVE,
  deletedAt: null,
};

describe('suspension Veridian : workflows et crons', () => {
  describe('WorkflowTriggerJob (déclencheurs base et cron, envois déjà en file)', () => {
    const construire = (espace: unknown) => {
      const findCoreVersionById = jest.fn().mockResolvedValue(null);
      const run = jest.fn();
      const captureExceptions = jest.fn();
      const job = new WorkflowTriggerJob(
        { run } as never,
        { findCoreWorkflowByIdOrWorkspaceWorkflowId: jest.fn() } as never,
        { findCoreVersionById } as never,
        { captureExceptions } as never,
        { get: jest.fn(async () => espace) } as never,
      );

      return { job, findCoreVersionById, run };
    };
    const donnees = {
      workspaceId: 'ws',
      workflowId: 'wf',
      coreWorkflowVersionId: 'v1',
      payload: {},
    };

    it('espace suspendu : aucune lecture de version, aucun run', async () => {
      const fixture = construire(SUSPENDU);

      await fixture.job.handle(donnees);

      expect(fixture.findCoreVersionById).not.toHaveBeenCalled();
      expect(fixture.run).not.toHaveBeenCalled();
    });

    it('espace actif : le job franchit la porte (contrôle positif)', async () => {
      const fixture = construire(ACTIF);

      await fixture.job.handle(donnees);

      expect(fixture.findCoreVersionById).toHaveBeenCalledTimes(1);
    });
  });

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
