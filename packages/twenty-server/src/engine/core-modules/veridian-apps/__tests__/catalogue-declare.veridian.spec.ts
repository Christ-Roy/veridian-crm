import {
  desiredCatalogueState,
  excludedFromVeridianDefaults,
  parseVeridianCatalogue,
  VERIDIAN_VERIFIED_AUTHOR,
  veridianEditorWorkspaceIds,
} from 'src/engine/core-modules/veridian-apps/utils/veridian-catalogue.util';

// Veridian (26/11/2026, Robert) : les apps Veridian sont dans la marketplace, auteur vérifié, et les intégrations sont
// posées d'office. Le catalogue se déclare dans le job ; seules les apps TARBALL de l'éditeur sont touchées.
const EDITEUR = '38627be0-428f-4924-aa67-4a35884ba7b4';
const AUTRE = '11111111-1111-4111-8111-111111111111';
const LIAISONS = '1a1ab23e-60e5-4eca-be1f-718c96055c79';
const MEET = '65f44458-3dde-49de-9b19-c52b60b5d1e8';
const CHANTIER = '26679b6d-2464-436e-81f8-ae68059bb8d3';

const app = (uid: string, owner = EDITEUR, plus: Record<string, unknown> = {}) => ({
  universalIdentifier: uid,
  ownerWorkspaceId: owner,
  sourceType: 'TARBALL',
  isListed: false,
  isPreInstalled: false,
  author: 'Robert',
  ...plus,
});

describe('catalogue Veridian déclaré', () => {
  const catalogue = parseVeridianCatalogue(`${LIAISONS}:installe, ${MEET}:liste, pas-un-uuid:liste, ${CHANTIER}:autre`);
  const editeurs = new Set([EDITEUR]);

  it('lit installe (listée et posée partout) et liste ; ignore le reste', () => {
    expect([...catalogue.keys()]).toEqual([LIAISONS, MEET]);
    expect(catalogue.get(LIAISONS)).toEqual({ isListed: true, isPreInstalled: true });
    expect(catalogue.get(MEET)).toEqual({ isListed: true, isPreInstalled: false });
  });

  it('pose listée, préinstallée et auteur vérifié sur les apps de l’éditeur', () => {
    expect(desiredCatalogueState(app(LIAISONS), catalogue, editeurs)).toEqual({
      isListed: true,
      isPreInstalled: true,
      author: VERIDIAN_VERIFIED_AUTHOR,
    });
    expect(desiredCatalogueState(app(MEET), catalogue, editeurs)?.isPreInstalled).toBe(false);
  });

  it('retire de la marketplace une app de l’éditeur hors catalogue (interne), sans toucher son auteur', () => {
    expect(desiredCatalogueState(app(CHANTIER, EDITEUR, { isListed: true }), catalogue, editeurs)).toEqual({
      isListed: false,
      isPreInstalled: false,
      author: 'Robert',
    });
  });

  it('ne touche jamais une app d’un autre espace ni une app npm, même au catalogue', () => {
    expect(desiredCatalogueState(app(LIAISONS, AUTRE), catalogue, editeurs)).toBeNull();
    expect(desiredCatalogueState(app(LIAISONS, EDITEUR, { sourceType: 'NPM' }), catalogue, editeurs)).toBeNull();
    expect(desiredCatalogueState(app(LIAISONS, null as unknown as string), catalogue, editeurs)).toBeNull();
  });

  it('éditeur : variable explicite, sinon les éditeurs des apps de base ; exclusions lues', () => {
    expect([...veridianEditorWorkspaceIds({ VERIDIAN_BASE_APPS: `${EDITEUR}:${LIAISONS}` })]).toEqual([EDITEUR]);
    expect([...veridianEditorWorkspaceIds({ VERIDIAN_EDITOR_WORKSPACE_IDS: AUTRE, VERIDIAN_BASE_APPS: `${EDITEUR}:${LIAISONS}` })]).toEqual([AUTRE]);
    expect(veridianEditorWorkspaceIds({}).size).toBe(0);
    expect([...excludedFromVeridianDefaults({ VERIDIAN_BASE_APPS_EXCLUDE: `${AUTRE}, x` })]).toEqual([AUTRE]);
  });
});
