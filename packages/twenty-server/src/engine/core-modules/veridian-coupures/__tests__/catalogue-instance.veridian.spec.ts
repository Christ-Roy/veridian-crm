// twenty-client-sdk n'est pas construit en CI ; les services ne s'en servent pas avant les gardes.
jest.mock(
  'src/engine/core-modules/sdk-client/sdk-client-archive.service',
  () => ({ SdkClientArchiveService: class {} }),
);
jest.mock(
  'src/engine/core-modules/sdk-client/sdk-client-generation.service',
  () => ({ SdkClientGenerationService: class {} }),
);

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { GqlExecutionContext } from '@nestjs/graphql';

import { AdminPanelResolver } from 'src/engine/core-modules/admin-panel/admin-panel.resolver';
import { ApplicationInstallService } from 'src/engine/core-modules/application/application-install/application-install.service';
import { ApplicationRegistrationService } from 'src/engine/core-modules/application/application-registration/application-registration.service';
import { ApplicationRegistrationSourceType } from 'src/engine/core-modules/application/application-registration/enums/application-registration-source-type.enum';
import { ApplicationTarballService } from 'src/engine/core-modules/application/application-registration/application-tarball.service';
import { ApplicationExceptionCode } from 'src/engine/core-modules/application/application.exception';
import { LogicFunctionExecutorService } from 'src/engine/core-modules/logic-function/logic-function-executor/logic-function-executor.service';
import { AdminPanelGuard } from 'src/engine/guards/admin-panel-guard';
import { LogicFunctionExceptionCode } from 'src/engine/metadata-modules/logic-function/logic-function.exception';

const CLIENT = 'c6005824-6d1a-4c72-b5e6-b94ee950477a';
const APP = 'b6f0d2e4-8a51-4c3e-9f27-1d6a4b8c0e52';
const { TARBALL, NPM, LOCAL, OAUTH_ONLY } = ApplicationRegistrationSourceType;

const enregistrement = (ecarts: Record<string, unknown> = {}) => ({
  id: 'enregistrement',
  universalIdentifier: APP,
  sourceType: TARBALL,
  isListed: false,
  isPreInstalled: false,
  ...ecarts,
});

const env = { ...process.env };

beforeEach(() => {
  process.env = { ...env };
  delete process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW;
  delete process.env.VERIDIAN_APP_INSTALL_ALLOW;
});

afterEach(() => {
  process.env = { ...env };
});

describe('installation : le catalogue d’instance passe en tout espace', () => {
  const installer = async (ecarts: Record<string, unknown>) => {
    const withLock = jest.fn().mockResolvedValue(true);
    const service = Object.assign(
      Object.create(ApplicationInstallService.prototype),
      {
        logger: { log: jest.fn() },
        appRegistrationRepository: {
          findOne: jest.fn().mockResolvedValue(enregistrement(ecarts)),
        },
        cacheLockService: { withLock },
      },
    ) as ApplicationInstallService;

    try {
      await service.installApplication({
        appRegistrationId: 'enregistrement',
        workspaceId: CLIENT,
      });
    } catch (error) {
      expect(error.code).toBe(ApplicationExceptionCode.FORBIDDEN);
    }

    return withLock.mock.calls.length === 1;
  };

  it.each([{ isListed: true }, { isPreInstalled: true }])(
    'installe %j sans couple',
    async (drapeaux) => {
      await expect(installer(drapeaux)).resolves.toBe(true);
    },
  );

  it.each([
    {},
    { isListed: null, isPreInstalled: null },
    { sourceType: NPM, isListed: true, isPreInstalled: true },
  ])('refuse %j', async (ecarts) => {
    await expect(installer(ecarts)).resolves.toBe(false);
  });

  it('laisse les couples, sans drapeau', async () => {
    process.env.VERIDIAN_APP_INSTALL_ALLOW = `${CLIENT}:${APP}`;

    await expect(installer({})).resolves.toBe(true);
  });
});

describe('exécution : le catalogue d’instance passe en tout espace', () => {
  const ligne = (ecarts: Record<string, unknown> = {}) => ({
    universalIdentifier: APP,
    sourceType: TARBALL,
    applicationRegistrationId: 'enregistrement',
    ...ecarts,
  });

  // La base répond par clé, jamais par identifiant. Passée la garde, l'arrêt d'urgence de l'app est consulté.
  const executer = async (
    application: Record<string, unknown>,
    enBase = enregistrement({ isListed: true }),
  ) => {
    const isApplicationStopped = jest.fn().mockResolvedValue(true);
    const findOne = jest.fn(async ({ where }) => {
      expect(Object.keys(where)).toEqual(['id']);

      return where.id === enBase.id ? enBase : null;
    });
    const service = Object.assign(
      Object.create(LogicFunctionExecutorService.prototype),
      {
        workspaceRepository: {
          manager: { getRepository: () => ({ findOne }) },
        },
        applicationStopService: { isApplicationStopped },
      },
    ) as LogicFunctionExecutorService;

    await expect(
      service.executeBuiltCode({
        workspaceId: CLIENT,
        flatApplication: application as never,
        getBuiltHandlerPath: jest.fn(),
        payload: {},
      }),
    ).rejects.toMatchObject({
      code: LogicFunctionExceptionCode.LOGIC_FUNCTION_DISABLED,
    });

    return isApplicationStopped.mock.calls.length > 0;
  };

  it.each([{ isListed: true }, { isPreInstalled: true }])(
    'exécute %j sans couple',
    async (drapeaux) => {
      await expect(executer(ligne(), enregistrement(drapeaux))).resolves.toBe(
        true,
      );
    },
  );

  it.each([
    {},
    { sourceType: NPM, isListed: true },
    { sourceType: LOCAL, isListed: true },
    { sourceType: OAUTH_ONLY, isListed: true },
    { universalIdentifier: 'autre', isListed: true },
  ])('refuse un enregistrement %j', async (ecarts) => {
    await expect(executer(ligne(), enregistrement(ecarts))).resolves.toBe(
      false,
    );
  });

  it.each([
    [
      "l'identifiant copié dans un manifeste, sans enregistrement",
      { applicationRegistrationId: null },
    ],
    [
      "l'identifiant copié, lié à l'enregistrement de l'espace",
      { applicationRegistrationId: 'autre' },
    ],
    [
      'du code poussé en local, lié au bon enregistrement',
      { sourceType: LOCAL },
    ],
  ])('refuse %s', async (_, ecarts) => {
    await expect(executer(ligne(ecarts))).resolves.toBe(false);
  });

  it('coupe dès que le drapeau tombe : rien en cache', async () => {
    const enBase = enregistrement({ isListed: true });

    await expect(executer(ligne(), enBase)).resolves.toBe(true);
    enBase.isListed = false;
    await expect(executer(ligne(), enBase)).resolves.toBe(false);
  });

  it('laisse les couples, sans lire la base', async () => {
    process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW = `${CLIENT}:${APP}`;

    await expect(
      executer(ligne({ applicationRegistrationId: null })),
    ).resolves.toBe(true);
  });
});

describe('le catalogue visible', () => {
  it("ne lit que les apps publiées et listées, jamais npm ni l'app privée d'un espace", async () => {
    const find = jest.fn().mockResolvedValue([]);
    const service = Object.assign(
      Object.create(ApplicationRegistrationService.prototype),
      { applicationRegistrationRepository: { find } },
    ) as ApplicationRegistrationService;

    await service.findManyCatalogCards();
    expect(find.mock.calls[0][0].where).toEqual({
      sourceType: TARBALL,
      isListed: true,
    });
  });

  const publier = async (existant: Record<string, unknown> | null) => {
    const updateFromManifest = jest.fn();
    const service = Object.assign(
      Object.create(ApplicationTarballService.prototype),
      {
        logger: { log: jest.fn() },
        appRegistrationRepository: {
          findOne: async () => existant,
          findOneOrFail: async () => enregistrement(),
        },
        applicationVersionValidationService: {
          validateVersionProgression: () => ({ allowed: true }),
        },
        applicationRegistrationVersionService: {
          findOneByApplicationRegistrationIdAndVersion: async () => null,
          isTarballFileReferenced: async () => true,
        },
        applicationRegistrationService: {
          create: async () => enregistrement(),
          updateFromManifest,
          emitRegistrationPublishMetric: jest.fn(),
          enqueueAutoUpgradeApplications: jest.fn(),
        },
        applicationRegistrationAssetService: {
          storeRegistrationAssets: jest.fn(),
        },
      },
    );

    await service.registerExtractedTarballExclusively({
      extractedTarball: {
        contentDir: '/nulle-part',
        manifest: { application: { universalIdentifier: APP } },
        packageJson: { version: '0.2.0' },
      },
      ownerWorkspaceId: CLIENT,
      storeTarballFile: async () => ({ id: 'fichier' }),
    });

    return updateFromManifest.mock.calls[0][0].additionalFields.isListed;
  };

  it.each([
    ['garde listée', enregistrement({ isListed: true }), true],
    ['garde non listée', enregistrement(), false],
    ['ne liste jamais une app neuve :', null, false],
  ])('republier %s', async (_, existant, attendu) => {
    await expect(publier(existant)).resolves.toBe(attendu);
  });
});

// Ce qui rend ces drapeaux sûrs est à l'amont : un sync qui l'ouvrirait doit casser ici.
describe('seul l’administrateur d’instance pose isListed et isPreInstalled', () => {
  const monter = () => {
    const update = jest.fn();
    const service = Object.assign(
      Object.create(ApplicationRegistrationService.prototype),
      {
        applicationRegistrationRepository: {
          update,
          findOne: async () => enregistrement(),
        },
        applicationRegistrationLookupService: {
          findOneByIdOrThrow: async () => enregistrement(),
        },
        invalidateMarketplaceAppsCache: jest.fn(),
        broadcastApplicationRegistrationUpdatedById: jest.fn(),
      },
    ) as ApplicationRegistrationService;

    return { service, update };
  };
  const demande = {
    id: 'enregistrement',
    update: { name: 'Forgée', isListed: true, isPreInstalled: true },
  };

  it("le propriétaire qui glisse les drapeaux n'écrit que le nom", async () => {
    const { service, update } = monter();

    await service.update(demande, CLIENT);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('enregistrement', { name: 'Forgée' });
  });

  it("l'administrateur d'instance les écrit (témoin)", async () => {
    const { service, update } = monter();

    await service.updateGlobal(demande);
    expect(update).toHaveBeenCalledWith('enregistrement', {
      name: 'Forgée',
      isListed: true,
      isPreInstalled: true,
    });
  });

  it('la seule mutation qui les porte est derrière AdminPanelGuard', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        AdminPanelResolver.prototype.updateAdminApplicationRegistration,
      ),
    ).toContain(AdminPanelGuard);
  });

  it.each([
    ["l'administrateur d'instance", { canAccessFullAdminPanel: true }, true],
    ["l'administrateur d'un espace", { canAccessFullAdminPanel: false }, false],
  ])('AdminPanelGuard : %s', (_, user, attendu) => {
    jest
      .spyOn(GqlExecutionContext, 'create')
      .mockReturnValue({ getContext: () => ({ req: { user } }) } as never);

    expect(Boolean(new AdminPanelGuard().canActivate({} as never))).toBe(
      attendu,
    );
  });
});
