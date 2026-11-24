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

import { JobStateEnum } from 'src/engine/core-modules/message-queue/enums/job-state.enum';
import { VeridianDelegatedAppService } from 'src/engine/core-modules/veridian-hub-mcp/services/veridian-delegated-app.service';

const APP = '1a1ab23e-60e5-4eca-be1f-718c96055c79';
const ESPACE = '0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b';
const CIBLE = { applicationUniversalIdentifier: APP, workspaceId: ESPACE };
const LISTEE = { sourceType: 'tarball', isListed: true, isPreInstalled: false };
const FERMEE = { ...LISTEE, isListed: false };

class SansAttente extends VeridianDelegatedAppService {
  protected wait(): Promise<void> {
    return Promise.resolve();
  }
}

// `apps` : ce que rend la base à chaque lecture, la dernière valeur restant.
const monter = ({
  apps = [null] as ({ version: string | null } | null)[],
  etats = [] as (object | null)[],
  registre = LISTEE as object | Error,
  marque = false,
  declencher = { jobId: 'travail' } as object | Error,
} = {}) => {
  const marques = new Set(
    marque ? [`veridian.delegated_app:${APP}|${ESPACE}`] : [],
  );
  let lecture = 0;
  const findOneApplication = jest.fn(
    async (_: object) => apps[Math.min(lecture++, apps.length - 1)],
  );
  const findInstallApplicationJobStatus = jest.fn();

  for (const etat of etats) {
    findInstallApplicationJobStatus.mockResolvedValueOnce(etat);
  }
  const triggerInstallApplication = jest.fn(async () => {
    if (declencher instanceof Error) throw declencher;

    return declencher;
  });
  const insertions: object[] = [];
  const service = new SansAttente(
    { findOneApplication } as never,
    {
      findRegistrationByUniversalIdentifier: async () => {
        if (registre instanceof Error) throw registre;

        return registre;
      },
    } as never,
    { triggerInstallApplication, findInstallApplicationJobStatus } as never,
    {
      exists: async ({
        where,
      }: {
        where: { key: string; workspaceId: string };
      }) => marques.has(`${where.key}|${where.workspaceId}`),
      createQueryBuilder: () => ({
        insert: () => ({
          values: (v: { key: string; workspaceId: string }) => ({
            orIgnore: () => ({
              execute: async () => {
                insertions.push(v);
                marques.add(`${v.key}|${v.workspaceId}`);
              },
            }),
          }),
        }),
      }),
    } as never,
  );

  return {
    service,
    triggerInstallApplication,
    findInstallApplicationJobStatus,
    findOneApplication,
    insertions,
  };
};

describe('l’app de l’outil se pose au premier appel d’action valide', () => {
  beforeEach(() => {
    delete process.env.VERIDIAN_APP_INSTALL_ALLOW;
  });

  it('déjà installée : rien à faire, l’espace est marqué une fois', async () => {
    const e = monter({ apps: [{ version: '0.4.1' }] });

    expect(await e.service.ensureInstalled(CIBLE)).toEqual({ kind: 'ok' });
    expect(await e.service.ensureInstalled(CIBLE)).toEqual({ kind: 'ok' });
    expect(e.triggerInstallApplication).not.toHaveBeenCalled();
    expect(e.insertions).toEqual([
      expect.objectContaining({
        key: `veridian.delegated_app:${APP}`,
        workspaceId: ESPACE,
        userId: null,
      }),
    ]);
    expect(e.findOneApplication).toHaveBeenCalledWith({
      universalIdentifier: APP,
      workspaceId: ESPACE,
    });
  });

  it('absente et ouverte : le travail natif l’installe, dans l’espace du jeton seulement', async () => {
    const e = monter({
      etats: [
        { state: JobStateEnum.ACTIVE },
        { state: JobStateEnum.COMPLETED },
      ],
    });

    expect(await e.service.ensureInstalled(CIBLE)).toEqual({ kind: 'ok' });
    expect(e.triggerInstallApplication).toHaveBeenCalledTimes(1);
    expect(e.triggerInstallApplication).toHaveBeenCalledWith({
      universalIdentifier: APP,
      workspaceId: ESPACE,
    });
    expect(e.findInstallApplicationJobStatus).toHaveBeenCalledTimes(2);
    expect(e.insertions).toHaveLength(1);
  });

  it('non ouverte à l’espace : refus nommé, aucun travail lancé', async () => {
    const e = monter({ registre: FERMEE });

    expect(await e.service.ensureInstalled(CIBLE)).toMatchObject({
      kind: 'refused',
      status: 403,
      error: 'app_not_available',
    });
    expect(e.triggerInstallApplication).not.toHaveBeenCalled();
  });

  it('le couple (espace, app) ouvre cet espace et lui seul', async () => {
    process.env.VERIDIAN_APP_INSTALL_ALLOW = `${ESPACE}:${APP}`;
    const e = monter({
      registre: FERMEE,
      etats: [{ state: JobStateEnum.COMPLETED }],
    });

    expect(await e.service.ensureInstalled(CIBLE)).toEqual({ kind: 'ok' });
    expect(
      await monter({ registre: FERMEE }).service.ensureInstalled({
        ...CIBLE,
        workspaceId: '11111111-ec8e-4a7e-bcdd-e75f5dc0ce6b',
      }),
    ).toMatchObject({ error: 'app_not_available' });
  });

  it('désinstallée par quelqu’un : ne revient pas toute seule', async () => {
    const e = monter({ marque: true });

    expect(await e.service.ensureInstalled(CIBLE)).toMatchObject({
      kind: 'refused',
      status: 403,
      error: 'app_uninstalled',
    });
    expect(e.triggerInstallApplication).not.toHaveBeenCalled();
  });

  it('en cours d’installation (ligne sans version) : attend le même travail', async () => {
    const e = monter({
      apps: [{ version: null }],
      marque: true,
      etats: [{ state: JobStateEnum.COMPLETED }],
    });

    expect(await e.service.ensureInstalled(CIBLE)).toEqual({ kind: 'ok' });
    expect(e.triggerInstallApplication).toHaveBeenCalledTimes(1);
  });

  it('un autre appel l’a installée d’abord : le travail en échec ne refuse pas', async () => {
    const e = monter({
      apps: [null, null, { version: '0.4.1' }],
      etats: [
        { state: JobStateEnum.FAILED, failedReason: 'already installed' },
      ],
    });

    expect(await e.service.ensureInstalled(CIBLE)).toEqual({ kind: 'ok' });
  });

  it('le travail a quitté la file : l’app installée fait foi', async () => {
    const e = monter({
      apps: [null, null, { version: '0.4.1' }],
      etats: [null],
    });

    expect(await e.service.ensureInstalled(CIBLE)).toEqual({ kind: 'ok' });
  });

  it.each([
    ['travail en échec', { etats: [{ state: JobStateEnum.FAILED }] }],
    ['app inconnue', { registre: new Error('no registration') }],
    ['travail refusé', { declencher: new Error('being uninstalled') }],
  ])('%s : 503, rien n’est marqué', async (_nom, options) => {
    const e = monter(options);

    expect(await e.service.ensureInstalled(CIBLE)).toMatchObject({
      kind: 'refused',
      status: 503,
      error: 'app_install_failed',
    });
    expect(e.insertions).toHaveLength(0);
  });

  it('trop long : 503 app_installing, l’appelant revient', async () => {
    const e = monter();

    e.findInstallApplicationJobStatus.mockResolvedValue({
      state: JobStateEnum.ACTIVE,
    });
    expect(await e.service.ensureInstalled(CIBLE)).toMatchObject({
      kind: 'refused',
      status: 503,
      error: 'app_installing',
    });
    expect(e.insertions).toHaveLength(0);
  });
});
