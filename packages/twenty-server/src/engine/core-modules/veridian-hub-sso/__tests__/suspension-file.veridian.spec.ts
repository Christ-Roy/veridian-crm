jest.mock('node:timers/promises', () => ({ setTimeout: jest.fn() }));

import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import {
  postponeSuspendedWorkspaceJob,
  SUSPENDED_JOB_DELAY_MS,
} from 'src/engine/core-modules/veridian-hub-sso/utils/postpone-suspended-workspace-job.util';

// CONTRAT-HUB §5.4 : aucune tâche de fond pour un espace suspendu (webhooks, workflows, fonctions, imports), aucune perdue.
const ESPACES: Record<string, object | null> = {
  suspendu: {
    activationStatus: WorkspaceActivationStatus.SUSPENDED,
    deletedAt: null,
  },
  actif: { activationStatus: WorkspaceActivationStatus.ACTIVE, deletedAt: null },
  supprime: {
    activationStatus: WorkspaceActivationStatus.SUSPENDED,
    deletedAt: new Date(),
  },
  inconnu: null,
};

const passer = async (data: unknown, name = 'RunWorkflowJob') => {
  const add = jest.fn();
  const get = jest.fn(
    async (_cle: string, id: string) => ESPACES[id] as never,
  );
  const reportee = await postponeSuspendedWorkspaceJob(
    { name, data, retryLimit: 3 },
    { add } as never,
    { get } as never,
  );

  return { reportee, add, get };
};

describe('suspension Veridian : file de tâches', () => {
  it.each([
    ['tâche', { workspaceId: 'suspendu', charge: 1 }],
    ['lot de webhooks', [{ workspaceId: 'suspendu' }, { workspaceId: 'suspendu' }]],
  ])('espace suspendu, %s : reportée telle quelle, jamais exécutée', async (_, data) => {
    const { reportee, add, get } = await passer(data);

    expect(reportee).toBe(true);
    expect(get).toHaveBeenCalledWith('workspaceEntity', 'suspendu');
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('RunWorkflowJob', data, {
      delay: SUSPENDED_JOB_DELAY_MS,
      retryLimit: 3,
      workspaceId: 'suspendu',
      isWorkspaceJob: true,
    });
  });

  it.each([
    ['espace actif', { workspaceId: 'actif' }],
    ['espace supprimé (sa destruction doit tourner)', { workspaceId: 'supprime' }],
    ['espace inconnu', { workspaceId: 'inconnu' }],
    ['cron sans espace', undefined],
    ['lot vide', []],
  ])('%s : exécutée', async (_, data) => {
    const { reportee, add } = await passer(data);

    expect(reportee).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it.each([
    ['cache pas encore prêt au démarrage : relu, puis reportée', 2, true],
    ['cache en panne durable : exécutée, jamais perdue', 99, false],
  ])('%s', async (_, pannes, attendu) => {
    const add = jest.fn();
    let restantes = pannes;
    const get = jest.fn(async () => {
      if (restantes-- > 0) {
        throw new Error('provider not found');
      }

      return ESPACES.suspendu as never;
    });

    expect(
      await postponeSuspendedWorkspaceJob(
        { name: 'RunWorkflowJob', data: { workspaceId: 'suspendu' } },
        { add } as never,
        { get } as never,
      ),
    ).toBe(attendu);
    expect(add).toHaveBeenCalledTimes(attendu ? 1 : 0);
  });

  // Reportée, la révocation tomberait après la reprise et couperait ce que la reprise vient de recréer.
  it.each([
    'SyncWorkspaceWebhookSubscriptionsJob',
    'RevokeWebhookSubscriptionJob',
  ])('%s tourne pendant la suspension', async (nom) => {
    const { reportee, add } = await passer({ workspaceId: 'suspendu' }, nom);

    expect(reportee).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });
});
