import { ApplicationInstallService } from 'src/engine/core-modules/application/application-install/application-install.service';
import { ApplicationRegistrationSourceType } from 'src/engine/core-modules/application/application-registration/enums/application-registration-source-type.enum';
import { ApplicationExceptionCode } from 'src/engine/core-modules/application/application.exception';
import { isApplicationInstallAllowedByVeridian } from 'src/engine/core-modules/veridian-coupures/is-application-install-allowed-by-veridian.util';

// Patch-survival Veridian (VER-173, ex-ROB-238) : seuls les couples (espace, app) listés installent une app du registre.
describe('installation d’app autorisée par couple (espace, app)', () => {
  const env = { ...process.env };
  const veridian4 = '38627be0-428f-4924-aa67-4a35884ba7b4';
  const chantier = '26679b6d-2464-436e-81f8-ae68059bb8d3';
  const jetable = 'c6005824-6d1a-4c72-b5e6-b94ee950477a';
  const autreApp = 'b6f0d2e4-8a51-4c3e-9f27-1d6a4b8c0e52';

  afterEach(() => {
    process.env = { ...env };
  });

  it('installe le couple listé', () => {
    process.env.VERIDIAN_APP_INSTALL_ALLOW = `${veridian4}:${chantier}`;
    expect(isApplicationInstallAllowedByVeridian({ workspaceId: veridian4, applicationUniversalIdentifier: chantier })).toBe(true);
  });

  it("refuse un autre espace qui connaît l'identifiant exact", () => {
    process.env.VERIDIAN_APP_INSTALL_ALLOW = `${veridian4}:${chantier}`;
    expect(isApplicationInstallAllowedByVeridian({ workspaceId: jetable, applicationUniversalIdentifier: chantier })).toBe(false);
  });

  it('refuse une autre app du même espace', () => {
    process.env.VERIDIAN_APP_INSTALL_ALLOW = `${veridian4}:${chantier}`;
    expect(isApplicationInstallAllowedByVeridian({ workspaceId: veridian4, applicationUniversalIdentifier: autreApp })).toBe(false);
  });

  it('refuse tout quand la variable est absente, vide ou malformée (fermé par défaut)', () => {
    delete process.env.VERIDIAN_APP_INSTALL_ALLOW;
    expect(isApplicationInstallAllowedByVeridian({ workspaceId: veridian4, applicationUniversalIdentifier: chantier })).toBe(false);
    process.env.VERIDIAN_APP_INSTALL_ALLOW = '';
    expect(isApplicationInstallAllowedByVeridian({ workspaceId: veridian4, applicationUniversalIdentifier: chantier })).toBe(false);
    process.env.VERIDIAN_APP_INSTALL_ALLOW = chantier;
    expect(isApplicationInstallAllowedByVeridian({ workspaceId: veridian4, applicationUniversalIdentifier: chantier })).toBe(false);
  });

  it('accepte plusieurs couples, espaces et casse indifférents', () => {
    process.env.VERIDIAN_APP_INSTALL_ALLOW = ` ${jetable}:${autreApp} , ${veridian4.toUpperCase()}:${chantier} `;
    expect(isApplicationInstallAllowedByVeridian({ workspaceId: veridian4, applicationUniversalIdentifier: chantier })).toBe(true);
    expect(isApplicationInstallAllowedByVeridian({ workspaceId: jetable, applicationUniversalIdentifier: autreApp })).toBe(true);
  });

  it("n'ouvre pas l'installation avec la liste des fonctions", () => {
    delete process.env.VERIDIAN_APP_INSTALL_ALLOW;
    process.env.VERIDIAN_LOGIC_FUNCTION_ALLOW = `${veridian4}:${chantier}`;
    expect(isApplicationInstallAllowedByVeridian({ workspaceId: veridian4, applicationUniversalIdentifier: chantier })).toBe(false);
  });
});

describe('ApplicationInstallService.installApplication passe par la garde (VER-173)', () => {
  const env = { ...process.env };
  const veridian4 = '38627be0-428f-4924-aa67-4a35884ba7b4';
  const jetable = 'c6005824-6d1a-4c72-b5e6-b94ee950477a';
  const chantier = '26679b6d-2464-436e-81f8-ae68059bb8d3';

  const buildService = (sourceType: ApplicationRegistrationSourceType) => {
    const withLock = jest.fn().mockResolvedValue(true);
    const service = Object.assign(
      Object.create(ApplicationInstallService.prototype),
      {
        logger: { log: jest.fn() },
        appRegistrationRepository: {
          findOne: jest.fn().mockResolvedValue({
            id: 'registration',
            universalIdentifier: chantier,
            sourceType,
          }),
        },
        cacheLockService: { withLock },
      },
    ) as ApplicationInstallService;

    return { service, withLock };
  };

  afterEach(() => {
    process.env = { ...env };
  });

  it.each([
    ApplicationRegistrationSourceType.TARBALL,
    ApplicationRegistrationSourceType.NPM,
  ])("refuse un espace non listé avant toute écriture (%s)", async (sourceType) => {
    process.env.VERIDIAN_APP_INSTALL_ALLOW = `${veridian4}:${chantier}`;
    const { service, withLock } = buildService(sourceType);

    await expect(
      service.installApplication({ appRegistrationId: 'registration', workspaceId: jetable }),
    ).rejects.toMatchObject({ code: ApplicationExceptionCode.FORBIDDEN });
    expect(withLock).not.toHaveBeenCalled();
  });

  it('refuse tout quand la liste est vide', async () => {
    process.env.VERIDIAN_APP_INSTALL_ALLOW = '';
    const { service, withLock } = buildService(ApplicationRegistrationSourceType.TARBALL);

    await expect(
      service.installApplication({ appRegistrationId: 'registration', workspaceId: veridian4 }),
    ).rejects.toMatchObject({ code: ApplicationExceptionCode.FORBIDDEN });
    expect(withLock).not.toHaveBeenCalled();
  });

  it('installe le couple listé', async () => {
    process.env.VERIDIAN_APP_INSTALL_ALLOW = `${veridian4}:${chantier}`;
    const { service, withLock } = buildService(ApplicationRegistrationSourceType.TARBALL);

    await expect(
      service.installApplication({ appRegistrationId: 'registration', workspaceId: veridian4 }),
    ).resolves.toBe(true);
    expect(withLock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ApplicationRegistrationSourceType.LOCAL,
    ApplicationRegistrationSourceType.OAUTH_ONLY,
  ])("laisse passer %s, qui n'installe aucun code", async (sourceType) => {
    delete process.env.VERIDIAN_APP_INSTALL_ALLOW;
    const { service, withLock } = buildService(sourceType);

    await expect(
      service.installApplication({ appRegistrationId: 'registration', workspaceId: jetable }),
    ).resolves.toBe(true);
    expect(withLock).not.toHaveBeenCalled();
  });
});
