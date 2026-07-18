// Veridian — module AGPL (fork twentyhq/twenty). Cockpit prospection : boutons
// de filtre rapides montés dans la barre de vue de l'objet `company`.
//
// LOGIQUE 100% DANS CE MODULE. Le core (ViewBar.tsx) n'a qu'une accroche
// minimale (montage du composant). Le gating sur l'objet `company` se fait ICI
// (ViewBar est partagé par TOUS les objets — jamais de `if objet===company`
// dans le core).
//
// Ces helpers sont PURS (pas de React) → testables isolément.

import { ViewFilterOperand } from 'twenty-shared/types';

// -- Gating ------------------------------------------------------------------
// Le cockpit ne s'affiche QUE sur l'objet company (objectNameSingular).
export const isVeridianProspectionFilterObject = (
  objectNameSingular: string | undefined,
): boolean => objectNameSingular === 'company';

// -- Champs company réels (API names camelCase, cf Settings > Data model) -----
export const VERIDIAN_EFFECTIFS_FIELD = 'effectifs'; // NUMBER
export const VERIDIAN_HAS_WEBSITE_FIELD = 'hasWebsite'; // BOOLEAN

// -- Presets de taille (effectifs) -------------------------------------------
// Un range = deux RecordFilter (GREATER_THAN_OR_EQUAL + LESS_THAN_OR_EQUAL)
// combinés en AND. Une borne ouverte = un seul filtre.
export type VeridianSizePresetKey = 'individuel' | 'pme' | 'grande';

export type VeridianSizePreset = {
  key: VeridianSizePresetKey;
  label: string;
  /** borne basse incluse (>=), undefined = pas de borne basse */
  min?: number;
  /** borne haute incluse (<=), undefined = pas de borne haute */
  max?: number;
};

export const VERIDIAN_SIZE_PRESETS: VeridianSizePreset[] = [
  { key: 'individuel', label: 'Individuel (0-2)', max: 2 },
  { key: 'pme', label: 'PME (3-249)', min: 3, max: 249 },
  { key: 'grande', label: 'Grande (250+)', min: 250 },
];

// -- Ids STABLES des filtres (déterministes → un re-clic REMPLACE, n'empile pas)
// On préfixe par le fieldMetadataId pour rester unique si le champ change.
export const buildSizeMinFilterId = (fieldMetadataId: string): string =>
  `veridian-size-min:${fieldMetadataId}`;

export const buildSizeMaxFilterId = (fieldMetadataId: string): string =>
  `veridian-size-max:${fieldMetadataId}`;

export const buildSiteFilterId = (fieldMetadataId: string): string =>
  `veridian-site:${fieldMetadataId}`;

// -- Résolution du preset actif à partir des filtres courants -----------------
// On lit les bornes posées (via les ids stables) et on retrouve le preset qui
// matche exactement → pour surligner le bouton actif et permettre le toggle.
export const resolveActiveSizePresetKey = (
  currentFilters: { id: string; value: string }[],
  fieldMetadataId: string,
): VeridianSizePresetKey | undefined => {
  const minFilter = currentFilters.find(
    (filter) => filter.id === buildSizeMinFilterId(fieldMetadataId),
  );
  const maxFilter = currentFilters.find(
    (filter) => filter.id === buildSizeMaxFilterId(fieldMetadataId),
  );

  const min = minFilter ? Number(minFilter.value) : undefined;
  const max = maxFilter ? Number(maxFilter.value) : undefined;

  return VERIDIAN_SIZE_PRESETS.find(
    (preset) => preset.min === min && preset.max === max,
  )?.key;
};

// -- Résolution de l'état "site" actif ('true' | 'false' | undefined) ---------
export const resolveActiveSiteValue = (
  currentFilters: { id: string; value: string }[],
  fieldMetadataId: string,
): 'true' | 'false' | undefined => {
  const siteFilter = currentFilters.find(
    (filter) => filter.id === buildSiteFilterId(fieldMetadataId),
  );

  if (siteFilter?.value === 'true') return 'true';
  if (siteFilter?.value === 'false') return 'false';
  return undefined;
};

// -- Opérandes de filtre (réexport typé, évite d'importer twenty-shared partout)
export const VERIDIAN_FILTER_OPERANDS = {
  greaterThanOrEqual: ViewFilterOperand.GREATER_THAN_OR_EQUAL,
  lessThanOrEqual: ViewFilterOperand.LESS_THAN_OR_EQUAL,
  is: ViewFilterOperand.IS,
} as const;
