// Les services natifs sont remplacés dans chaque épreuve ; les charger tire twenty-client-sdk, non construit en CI.
jest.mock(
  'src/engine/core-modules/application/application-install/services/application-lifecycle-job.service',
  () => ({ ApplicationLifecycleJobService: class {} }),
);
jest.mock(
  'src/engine/core-modules/application/application-marketplace/marketplace-query.service',
  () => ({ MarketplaceQueryService: class {} }),
);
jest.mock('src/engine/core-modules/application/application.service', () => ({
  ApplicationService: class {},
}));

import { PermissionFlagType } from 'twenty-shared/constants';

import { DEFINE_TOOL_METADATA_KEY } from 'src/engine/core-modules/tool-provider/constants/define-tool-metadata-key.constant';
import { JobStateEnum } from 'src/engine/core-modules/message-queue/enums/job-state.enum';
import { InstallAppTool } from 'src/engine/core-modules/veridian-apps/tools/install-app.tool';
import { ListAvailableAppsTool } from 'src/engine/core-modules/veridian-apps/tools/list-available-apps.tool';

const APP = '1a1ab23e-60e5-4eca-be1f-718c96055c79';
const ESPACE = '0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b';
const context = { workspaceId: ESPACE };

class SansAttente extends InstallAppTool {
  protected wait(): Promise<void> {
    return Promise.resolve();
  }
}

const installer = (etats: ({ state: JobStateEnum } & object)[]) => {
  const triggerInstallApplication = jest
    .fn()
    .mockResolvedValue({ jobId: 'travail' });
  const findInstallApplicationJobStatus = jest.fn();

  for (const etat of etats) {
    findInstallApplicationJobStatus.mockResolvedValueOnce(etat);
  }

  const outil = new SansAttente({
    triggerInstallApplication,
    findInstallApplicationJobStatus,
  } as never);

  return {
    sortie: outil.execute({
      input: { universalIdentifier: APP },
      context,
    }),
    triggerInstallApplication,
    findInstallApplicationJobStatus,
  };
};

describe('install_app', () => {
  it('rend installée quand le travail est fini, dans l’espace de l’appelant', async () => {
    const e = installer([
      { state: JobStateEnum.ACTIVE },
      { state: JobStateEnum.COMPLETED },
    ]);

    await expect(e.sortie).resolves.toMatchObject({ success: true });
    expect(e.triggerInstallApplication).toHaveBeenCalledWith({
      universalIdentifier: APP,
      workspaceId: ESPACE,
    });
    expect(e.findInstallApplicationJobStatus).toHaveBeenCalledTimes(2);
    expect(e.findInstallApplicationJobStatus).toHaveBeenCalledWith({
      universalIdentifier: APP,
      workspaceId: ESPACE,
      jobId: 'travail',
    });
  });

  it('rend le refus de la garde, pas un succès', async () => {
    const raison = `Installation of application ${APP} is not allowed on workspace ${ESPACE}`;
    const { sortie } = installer([
      { state: JobStateEnum.FAILED, failedReason: raison } as never,
    ]);

    await expect(sortie).resolves.toMatchObject({
      success: false,
      error: raison,
    });
  });

  it('dit que le travail court encore, sans prétendre installer', async () => {
    const e = installer([]);

    e.findInstallApplicationJobStatus.mockResolvedValue({
      state: JobStateEnum.WAITING,
    });
    await expect(e.sortie).resolves.toMatchObject({
      result: { pending: true },
    });
  });

  it('rend l’erreur d’une app inconnue', async () => {
    const outil = new SansAttente({
      triggerInstallApplication: jest
        .fn()
        .mockRejectedValue(new Error('not found')),
    } as never);

    await expect(
      outil.execute({ input: { universalIdentifier: APP }, context }),
    ).resolves.toMatchObject({ success: false, error: 'not found' });
  });
});

describe('list_available_apps', () => {
  it('ne montre que les apps listées, avec la version installée', async () => {
    const findManyMarketplaceApps = jest.fn().mockResolvedValue([
      { id: APP, name: 'Liaisons', description: 'd', isListed: true },
      { id: 'autre', name: 'Autre', description: 'd', isListed: true },
    ]);
    const findManyApplications = jest
      .fn()
      .mockResolvedValue([{ universalIdentifier: APP, version: '0.3.3' }]);
    const outil = new ListAvailableAppsTool(
      { findManyMarketplaceApps } as never,
      { findManyApplications } as never,
    );

    const sortie = await outil.execute({ input: {}, context });

    expect(findManyMarketplaceApps).toHaveBeenCalledWith({ isListed: true });
    expect(findManyApplications).toHaveBeenCalledWith(ESPACE);
    expect(sortie.result).toEqual({
      apps: [
        expect.objectContaining({
          universalIdentifier: APP,
          installedVersion: '0.3.3',
        }),
        expect.objectContaining({
          universalIdentifier: 'autre',
          installedVersion: null,
        }),
      ],
    });
  });
});

describe('droits', () => {
  it.each([InstallAppTool, ListAvailableAppsTool])(
    'le rôle du membre décide (Applications), une app n’installe pas d’app : %p',
    (outil) => {
      const { accessPolicy } = Reflect.getMetadata(
        DEFINE_TOOL_METADATA_KEY,
        outil,
      );

      expect(accessPolicy.requiredPermissionFlags).toEqual([
        PermissionFlagType.APPLICATIONS,
      ]);
      expect(accessPolicy.authPrincipals.application).toBe(false);
      expect(accessPolicy.authPrincipals.userSession.standard).toBe(true);
    },
  );
});
