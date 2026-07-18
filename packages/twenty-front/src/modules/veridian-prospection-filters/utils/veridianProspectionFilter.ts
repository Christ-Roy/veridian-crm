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
export const VERIDIAN_DEPARTEMENT_FIELD = 'departement'; // TEXT (code 2 chars)
export const VERIDIAN_SCORE_FIELD = 'prospectScore'; // NUMBER
export const VERIDIAN_ICP_FIELD = 'idealCustomerProfile'; // BOOLEAN

// -- Champ MOBILE : N'EXISTE PAS ENCORE sur company (à créer via IaC) ---------
// ⚠️ État vérifié live prod (`twenty gql metadata`, 40 champs company) :
// AUCUN champ téléphone/PHONES sur company. Le legacy "Mobile 06/07" est donc
// IMPOSSIBLE tel quel — et resterait impossible même avec un champ PHONES :
//   • l'enum d'opérandes PHONES n'a PAS de STARTS_WITH (que CONTAINS = substring
//     `%val%`, donc "06" matcherait aussi "01 45 06 12 34") ;
//   • le moteur stocke le numéro SANS le 0 initial (callingCode séparé), donc
//     le préfixe "06" n'existe même plus dans la donnée.
// VOIE PROPRE (à câbler côté scraper/enrichissement, PAS dans ce module) :
// ajouter sur company un champ BOOLEAN dérivé `hasMobile`, calculé À L'IMPORT
// (regex ^0?[67] sur le numéro brut). Le cockpit l'expose alors
// AUTOMATIQUEMENT en toggle (même pattern que hasWebsite / idealCustomerProfile)
// dès que le champ existe — cf useVeridianProspectionFilters, qui gate
// l'affichage sur la présence du champ. Tant que le champ n'existe pas, AUCUN
// bouton mort n'est rendu.
export const VERIDIAN_HAS_MOBILE_FIELD = 'hasMobile'; // BOOLEAN (à créer via IaC)

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

export const buildScoreMinFilterId = (fieldMetadataId: string): string =>
  `veridian-score-min:${fieldMetadataId}`;

export const buildIcpFilterId = (fieldMetadataId: string): string =>
  `veridian-icp:${fieldMetadataId}`;

export const buildMobileFilterId = (fieldMetadataId: string): string =>
  `veridian-mobile:${fieldMetadataId}`;

// -- Géo MULTI-DÉPARTEMENT : un RecordFilterGroup OR + N filtres CONTAINS ------
// Le champ `departement` ne stocke qu'UN code par ligne → filtrer plusieurs
// départements = un OR (impossible en flat-AND : "dept CONTAINS 31 AND dept
// CONTAINS 32" ne matche rien). On matérialise donc un RecordFilterGroup avec
// logicalOperator OR, et un RecordFilter `departement CONTAINS <code>` par
// département sélectionné, chacun rattaché au groupe.
export const buildGeoGroupId = (fieldMetadataId: string): string =>
  `veridian-geo-group:${fieldMetadataId}`;

// Id STABLE par (champ, code) → re-cliquer un département TOGGLE (n'empile pas).
export const buildGeoDeptFilterId = (
  fieldMetadataId: string,
  deptCode: string,
): string => `veridian-geo-dept:${fieldMetadataId}:${deptCode}`;

const geoDeptFilterIdPrefix = (fieldMetadataId: string): string =>
  `veridian-geo-dept:${fieldMetadataId}:`;

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

// -- Résolution des départements actifs (codes sélectionnés, TEXT CONTAINS) ----
// On lit les filtres dont l'id porte le préfixe geo-dept du champ et on en
// extrait le code (partie après le dernier segment stable). Le fieldMetadataId
// est un UUID sans ':' → le découpage par préfixe est sûr.
export const resolveActiveGeoCodes = (
  currentFilters: { id: string; value: string }[],
  fieldMetadataId: string,
): string[] => {
  const prefix = geoDeptFilterIdPrefix(fieldMetadataId);
  return currentFilters
    .filter((filter) => filter.id.startsWith(prefix))
    .map((filter) => filter.id.slice(prefix.length))
    .filter((code) => code !== '');
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

// -- Résolution de l'état "Mobile" actif (BOOLEAN, IS true) -------------------
// Ne renvoie true que si le champ hasMobile existe ET que le toggle est posé.
export const resolveActiveMobileValue = (
  currentFilters: { id: string; value: string }[],
  fieldMetadataId: string,
): boolean => {
  const mobileFilter = currentFilters.find(
    (filter) => filter.id === buildMobileFilterId(fieldMetadataId),
  );
  return mobileFilter?.value === 'true';
};

// -- Opérandes de filtre (réexport typé, évite d'importer twenty-shared partout)
export const VERIDIAN_FILTER_OPERANDS = {
  greaterThanOrEqual: ViewFilterOperand.GREATER_THAN_OR_EQUAL,
  lessThanOrEqual: ViewFilterOperand.LESS_THAN_OR_EQUAL,
  is: ViewFilterOperand.IS,
  contains: ViewFilterOperand.CONTAINS,
} as const;
