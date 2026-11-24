import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { CallWebhookJob } from 'src/engine/metadata-modules/webhook/jobs/call-webhook.job';
import { CallWebhookJobsJob } from 'src/engine/metadata-modules/webhook/jobs/call-webhook-jobs.job';

// Sortant (CONTRAT-HUB §5.4) : un espace suspendu n'envoie aucun appel webhook, ni à l'entrée du lot,
// ni pour un appel déjà mis en file avant la suspension.

const SUSPENDU = {
  activationStatus: WorkspaceActivationStatus.SUSPENDED,
  deletedAt: null,
};
const ACTIF = {
  activationStatus: WorkspaceActivationStatus.ACTIVE,
  deletedAt: null,
};

const coreCache = (espaces: Record<string, unknown>) => ({
  get: jest.fn(async (_nom: string, id: string) => espaces[id]),
});

describe('webhook sortant et espace suspendu', () => {
  describe('CallWebhookJobsJob (entrée du lot)', () => {
    const lot = (workspaceId: string) =>
      ({
        workspaceId,
        name: 'company.created',
        objectMetadata: { id: 'obj-1' },
        events: [],
      }) as never;

    const construire = (espaces: Record<string, unknown>) => {
      const workspaceCacheService = {
        getOrRecompute: jest.fn().mockResolvedValue({
          flatWebhookMaps: {},
          flatObjectMetadataMaps: {},
          flatRoleTargetMaps: {},
        }),
      };
      const job = new CallWebhookJobsJob(
        { add: jest.fn() } as never,
        workspaceCacheService as never,
        {} as never,
        {} as never,
        coreCache(espaces) as never,
      );

      return { job, workspaceCacheService };
    };

    it('espace suspendu : aucune recherche de webhook, rien n est mis en file', async () => {
      const fixture = construire({ 'ws-s': SUSPENDU });

      await expect(fixture.job.handle(lot('ws-s'))).resolves.toBeUndefined();
      expect(
        fixture.workspaceCacheService.getOrRecompute,
      ).not.toHaveBeenCalled();
    });

    // Contrôle positif : l'espace actif franchit la porte et atteint la lecture des webhooks
    // (la lecture est refusée ici exprès, pour s'arrêter juste après le passage de la porte).
    it('espace actif : la recherche de webhook a lieu (contrôle positif)', async () => {
      const fixture = construire({ 'ws-a': ACTIF });
      fixture.workspaceCacheService.getOrRecompute.mockRejectedValue(
        new Error('apres-la-porte'),
      );

      await expect(fixture.job.handle(lot('ws-a'))).rejects.toThrow(
        'apres-la-porte',
      );
      expect(
        fixture.workspaceCacheService.getOrRecompute,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe('CallWebhookJob (appels déjà en file)', () => {
    const evenement = (workspaceId: string) =>
      ({ workspaceId, webhookUrl: 'https://client.example/hook' }) as never;

    const construire = (espaces: Record<string, unknown>) => {
      const job = new CallWebhookJob(
        {} as never,
        {} as never,
        {} as never,
        coreCache(espaces) as never,
      );
      const callWebhook = jest
        .spyOn(
          job as unknown as { callWebhook: () => Promise<unknown> },
          'callWebhook',
        )
        .mockResolvedValue({
          workspaceId: 'x',
          respondedAt: new Date(),
          properties: {},
        });
      jest
        .spyOn(
          job as unknown as { recordWebhookResponses: () => Promise<void> },
          'recordWebhookResponses',
        )
        .mockResolvedValue(undefined);

      return { job, callWebhook };
    };

    it('espace suspendu : l appel n est pas envoyé', async () => {
      const fixture = construire({ 'ws-s': SUSPENDU });

      await fixture.job.handle([evenement('ws-s')]);

      expect(fixture.callWebhook).not.toHaveBeenCalled();
    });

    it('espace actif : l appel part (contrôle positif)', async () => {
      const fixture = construire({ 'ws-a': ACTIF });

      await fixture.job.handle([evenement('ws-a')]);

      expect(fixture.callWebhook).toHaveBeenCalledTimes(1);
    });
  });
});
