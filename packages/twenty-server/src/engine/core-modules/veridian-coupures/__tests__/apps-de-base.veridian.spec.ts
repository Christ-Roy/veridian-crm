import { ApplicationRegistrationSourceType } from 'src/engine/core-modules/application/application-registration/enums/application-registration-source-type.enum';
import {
  isApplicationInstallAllowedByVeridian,
  isVeridianBaseApplication,
  veridianBaseApplicationIdentifiers,
} from 'src/engine/core-modules/veridian-coupures/is-application-install-allowed-by-veridian.util';
import { isCatalogApplicationAllowedByVeridian } from 'src/engine/core-modules/veridian-coupures/is-logic-function-allowed-by-veridian.util';

// Veridian (26/11/2026, parente) : Liaisons s'ouvre à chaque espace et se pose à sa création, sauf dans les espaces clients
// existants qui attendent Robert. L'enregistrement doit appartenir à l'espace éditeur : un manifeste ne suffit pas.
const EDITEUR = '38627be0-428f-4924-aa67-4a35884ba7b4';
const LIAISONS = '1a1ab23e-60e5-4eca-be1f-718c96055c79';
const NEUF = '76f6ff84-d0b4-448a-94c7-e03f0256cf61';
const CLIENT = '53fcfb68-6107-48b6-b692-4196c077a9aa';
const AUTRE_EDITEUR = '11111111-2222-4333-8444-555555555555';

const enregistrement = (surcharge: Record<string, unknown> = {}) => ({
  id: 'reg-1',
  sourceType: ApplicationRegistrationSourceType.TARBALL,
  isListed: false,
  isPreInstalled: false,
  ownerWorkspaceId: EDITEUR,
  universalIdentifier: LIAISONS,
  ...surcharge,
});

const gestionnaire = (ligne: unknown) =>
  ({ getRepository: () => ({ findOne: async () => ligne }) }) as never;

describe('Veridian : apps de base ouvertes à chaque espace', () => {
  const avant = {
    base: process.env.VERIDIAN_BASE_APPS,
    exclus: process.env.VERIDIAN_BASE_APPS_EXCLUDE,
    couples: process.env.VERIDIAN_APP_INSTALL_ALLOW,
  };

  beforeEach(() => {
    process.env.VERIDIAN_BASE_APPS = `${EDITEUR}:${LIAISONS}`;
    process.env.VERIDIAN_BASE_APPS_EXCLUDE = CLIENT;
    delete process.env.VERIDIAN_APP_INSTALL_ALLOW;
  });

  afterAll(() => {
    process.env.VERIDIAN_BASE_APPS = avant.base;
    process.env.VERIDIAN_BASE_APPS_EXCLUDE = avant.exclus;
    process.env.VERIDIAN_APP_INSTALL_ALLOW = avant.couples;
  });

  it("s'installe dans un espace neuf, sans couple listé", () => {
    expect(
      isApplicationInstallAllowedByVeridian({
        workspaceId: NEUF,
        applicationUniversalIdentifier: LIAISONS,
        applicationRegistration: enregistrement(),
      }),
    ).toBe(true);
  });

  it("ne s'installe pas dans un espace client exclu (attend Robert)", () => {
    expect(
      isApplicationInstallAllowedByVeridian({
        workspaceId: CLIENT,
        applicationUniversalIdentifier: LIAISONS,
        applicationRegistration: enregistrement(),
      }),
    ).toBe(false);
  });

  it("refuse le même identifiant publié par un autre espace", () => {
    expect(
      isVeridianBaseApplication({
        workspaceId: NEUF,
        applicationRegistration: enregistrement({ ownerWorkspaceId: AUTRE_EDITEUR }),
      }),
    ).toBe(false);
  });

  it('refuse une app locale ou sans enregistrement', () => {
    expect(
      isVeridianBaseApplication({
        workspaceId: NEUF,
        applicationRegistration: enregistrement({ sourceType: ApplicationRegistrationSourceType.LOCAL }),
      }),
    ).toBe(false);
    expect(isVeridianBaseApplication({ workspaceId: NEUF })).toBe(false);
  });

  it("n'ouvre rien quand la variable est absente (comme avant)", () => {
    delete process.env.VERIDIAN_BASE_APPS;

    expect(
      isApplicationInstallAllowedByVeridian({
        workspaceId: NEUF,
        applicationUniversalIdentifier: LIAISONS,
        applicationRegistration: enregistrement(),
      }),
    ).toBe(false);
    expect(veridianBaseApplicationIdentifiers()).toEqual([]);
  });

  it("donne les identifiants à poser à la création, une fois chacun", () => {
    process.env.VERIDIAN_BASE_APPS = `${EDITEUR}:${LIAISONS}, ${EDITEUR}:${LIAISONS},nimporte-quoi`;

    expect(veridianBaseApplicationIdentifiers()).toEqual([LIAISONS]);
  });

  it("laisse s'exécuter ses fonctions dans un espace neuf, pas dans un espace exclu", async () => {
    const application = {
      applicationRegistrationId: 'reg-1',
      universalIdentifier: LIAISONS,
      sourceType: ApplicationRegistrationSourceType.TARBALL,
    } as never;

    await expect(
      isCatalogApplicationAllowedByVeridian(gestionnaire(enregistrement()), {
        ...(application as object),
        workspaceId: NEUF,
      } as never),
    ).resolves.toBe(true);
    await expect(
      isCatalogApplicationAllowedByVeridian(gestionnaire(enregistrement()), {
        ...(application as object),
        workspaceId: CLIENT,
      } as never),
    ).resolves.toBe(false);
    await expect(
      isCatalogApplicationAllowedByVeridian(gestionnaire(enregistrement()), application),
    ).resolves.toBe(false);
  });
});
