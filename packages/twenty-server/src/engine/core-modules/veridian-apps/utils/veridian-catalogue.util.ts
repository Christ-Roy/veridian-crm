import { ApplicationRegistrationSourceType } from 'src/engine/core-modules/application/application-registration/enums/application-registration-source-type.enum';

// Veridian (26/11/2026, Robert) : les apps Veridian sont dans la marketplace, publiées par l'éditeur vérifié ; rien n'est
// imposé, chaque espace installe ce qu'il veut. Le catalogue se déclare dans le job (aucun clic au panneau admin) :
// VERIDIAN_CATALOGUE = "<app>:liste,<app>:installe,…" (installe = listée et posée partout, non utilisé à ce jour).
// L'éditeur est l'espace qui publie : VERIDIAN_EDITOR_WORKSPACE_IDS, sinon les éditeurs de VERIDIAN_BASE_APPS.
export const VERIDIAN_VERIFIED_AUTHOR = 'Veridian, éditeur vérifié';

export type VeridianCatalogueEntry = { isListed: boolean; isPreInstalled: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const parseVeridianCatalogue = (
  raw: string | undefined,
): Map<string, VeridianCatalogueEntry> => {
  const catalogue = new Map<string, VeridianCatalogueEntry>();

  for (const entry of (raw ?? '').split(',')) {
    const [uid, mode] = entry.trim().toLowerCase().split(':');

    if (UUID.test(uid ?? '') && (mode === 'liste' || mode === 'installe')) {
      catalogue.set(uid, { isListed: true, isPreInstalled: mode === 'installe' });
    }
  }

  return catalogue;
};

export const veridianEditorWorkspaceIds = (
  env: NodeJS.ProcessEnv = process.env,
): Set<string> => {
  const explicit = (env.VERIDIAN_EDITOR_WORKSPACE_IDS ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter((id) => UUID.test(id));

  if (explicit.length > 0) {
    return new Set(explicit);
  }

  return new Set(
    (env.VERIDIAN_BASE_APPS ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase().split(':')[0])
      .filter((id) => UUID.test(id ?? '')),
  );
};

export const excludedFromVeridianDefaults = (
  env: NodeJS.ProcessEnv = process.env,
): Set<string> =>
  new Set(
    (env.VERIDIAN_BASE_APPS_EXCLUDE ?? '')
      .split(',')
      .map((id) => id.trim().toLowerCase())
      .filter((id) => UUID.test(id)),
  );

type Registration = {
  universalIdentifier: string;
  ownerWorkspaceId: string | null;
  sourceType: string;
  isListed: boolean;
  isPreInstalled: boolean;
  author: string | null;
};

// Ce que chaque enregistrement de l'éditeur doit porter. Hors éditeur ou hors TARBALL : rien (jamais une app tierce).
export const desiredCatalogueState = (
  registration: Registration,
  catalogue: Map<string, VeridianCatalogueEntry>,
  editors: Set<string>,
): Pick<Registration, 'isListed' | 'isPreInstalled' | 'author'> | null => {
  if (
    registration.sourceType !== ApplicationRegistrationSourceType.TARBALL ||
    !editors.has((registration.ownerWorkspaceId ?? '').toLowerCase())
  ) {
    return null;
  }

  const entry = catalogue.get(registration.universalIdentifier.toLowerCase());

  return {
    isListed: entry?.isListed ?? false,
    isPreInstalled: entry?.isPreInstalled ?? false,
    author: entry ? VERIDIAN_VERIFIED_AUTHOR : registration.author,
  };
};
