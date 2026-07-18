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
export const VERIDIAN_DEPARTEMENT_FIELD = 'departement'; // TEXT
export const VERIDIAN_SCORE_FIELD = 'prospectScore'; // NUMBER
export const VERIDIAN_ICP_FIELD = 'idealCustomerProfile'; // BOOLEAN

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

export const buildGeoFilterId = (fieldMetadataId: string): string =>
  `veridian-geo:${fieldMetadataId}`;

export const buildScoreMinFilterId = (fieldMetadataId: string): string =>
  `veridian-score-min:${fieldMetadataId}`;

export const buildIcpFilterId = (fieldMetadataId: string): string =>
  `veridian-icp:${fieldMetadataId}`;

// -- Presets de qualité (prospectScore, borne basse >=) -----------------------
// Un seul RecordFilter GREATER_THAN_OR_EQUAL par preset (ids stables → toggle).
export type VeridianScorePresetKey = 'top' | 'bon' | 'moyen';

export type VeridianScorePreset = {
  key: VeridianScorePresetKey;
  label: string;
  /** score minimum inclus (>=) */
  min: number;
};

export const VERIDIAN_SCORE_PRESETS: VeridianScorePreset[] = [
  { key: 'top', label: 'Top (≥90)', min: 90 },
  { key: 'bon', label: 'Bon (≥70)', min: 70 },
  { key: 'moyen', label: 'Moyen (≥50)', min: 50 },
];

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

// -- Résolution du preset de qualité actif (prospectScore) --------------------
export const resolveActiveScorePresetKey = (
  currentFilters: { id: string; value: string }[],
  fieldMetadataId: string,
): VeridianScorePresetKey | undefined => {
  const minFilter = currentFilters.find(
    (filter) => filter.id === buildScoreMinFilterId(fieldMetadataId),
  );
  if (!minFilter) return undefined;

  const min = Number(minFilter.value);
  return VERIDIAN_SCORE_PRESETS.find((preset) => preset.min === min)?.key;
};

// -- Résolution de la valeur "département" active (TEXT, CONTAINS) -------------
export const resolveActiveGeoValue = (
  currentFilters: { id: string; value: string }[],
  fieldMetadataId: string,
): string | undefined => {
  const geoFilter = currentFilters.find(
    (filter) => filter.id === buildGeoFilterId(fieldMetadataId),
  );
  const value = geoFilter?.value?.trim();
  return value ? value : undefined;
};

// -- Résolution de l'état "ICP uniquement" actif (BOOLEAN, IS true) -----------
export const resolveActiveIcpValue = (
  currentFilters: { id: string; value: string }[],
  fieldMetadataId: string,
): boolean => {
  const icpFilter = currentFilters.find(
    (filter) => filter.id === buildIcpFilterId(fieldMetadataId),
  );
  return icpFilter?.value === 'true';
};

// -- Opérandes de filtre (réexport typé, évite d'importer twenty-shared partout)
export const VERIDIAN_FILTER_OPERANDS = {
  greaterThanOrEqual: ViewFilterOperand.GREATER_THAN_OR_EQUAL,
  lessThanOrEqual: ViewFilterOperand.LESS_THAN_OR_EQUAL,
  is: ViewFilterOperand.IS,
  contains: ViewFilterOperand.CONTAINS,
} as const;
