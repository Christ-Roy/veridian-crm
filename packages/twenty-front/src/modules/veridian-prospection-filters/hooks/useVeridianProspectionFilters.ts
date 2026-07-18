// Veridian — module AGPL. Colle entre les presets "cockpit prospection" et le
// vrai système de filtres de vue de Twenty (currentRecordFiltersComponentState).
//
// Aucune persistance maison, aucun store parallèle : on écrit dans l'atom de
// filtres de la vue courante via les hooks natifs (useUpsertRecordFilter /
// useRemoveRecordFilter). La table refetch toute seule (même mécanique que la
// ViewBar). Un reset de vue efface les filtres → comportement voulu pour des
// boutons d'action rapide.

import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { useRemoveRecordFilterGroup } from '@/object-record/record-filter-group/hooks/useRemoveRecordFilterGroup';
import { useUpsertRecordFilterGroup } from '@/object-record/record-filter-group/hooks/useUpsertRecordFilterGroup';
import { currentRecordFiltersComponentState } from '@/object-record/record-filter/states/currentRecordFiltersComponentState';
import { type RecordFilter } from '@/object-record/record-filter/types/RecordFilter';
import { useRemoveRecordFilter } from '@/object-record/record-filter/hooks/useRemoveRecordFilter';
import { useUpsertRecordFilter } from '@/object-record/record-filter/hooks/useUpsertRecordFilter';
import { useRecordIndexContextOrThrow } from '@/object-record/record-index/contexts/RecordIndexContext';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { RecordFilterGroupLogicalOperator } from 'twenty-shared/types';
import { getFilterTypeFromFieldType } from 'twenty-shared/utils';

import { normalizeDeptCode } from '@/veridian-prospection-filters/utils/frenchDepartments';
import {
  VERIDIAN_DEPARTEMENT_FIELD,
  VERIDIAN_EFFECTIFS_FIELD,
  VERIDIAN_FILTER_OPERANDS,
  VERIDIAN_HAS_MOBILE_FIELD,
  VERIDIAN_HAS_WEBSITE_FIELD,
  VERIDIAN_ICP_FIELD,
  VERIDIAN_SCORE_FIELD,
  VERIDIAN_SCORE_PRESETS,
  VERIDIAN_SIZE_PRESETS,
  type VeridianScorePresetKey,
  type VeridianSizePresetKey,
  buildGeoDeptFilterId,
  buildGeoGroupId,
  buildIcpFilterId,
  buildMobileFilterId,
  buildScoreMinFilterId,
  buildSiteFilterId,
  buildSizeMaxFilterId,
  buildSizeMinFilterId,
  resolveActiveGeoCodes,
  resolveActiveIcpValue,
  resolveActiveMobileValue,
  resolveActiveScorePresetKey,
  resolveActiveSizePresetKey,
  resolveActiveSiteValue,
} from '@/veridian-prospection-filters/utils/veridianProspectionFilter';

const findFieldByName = (
  fields: FieldMetadataItem[],
  name: string,
): FieldMetadataItem | undefined => fields.find((field) => field.name === name);

export const useVeridianProspectionFilters = () => {
  const { objectMetadataItem } = useRecordIndexContextOrThrow();

  // ⚠️ PAS d'instanceId explicite : on lit/écrit via le
  // RecordFiltersComponentInstanceContext AMBIANT (le même que le dropdown de
  // filtre natif de Twenty, qui appelle useUpsertRecordFilter() sans arg).
  // Forcer recordIndexId écrivait dans un scope que la query ne relit pas → le
  // filtre n'était jamais appliqué (bug vécu + fixé 2026-07-18).
  const { upsertRecordFilter } = useUpsertRecordFilter();
  const { removeRecordFilter } = useRemoveRecordFilter();
  const { upsertRecordFilterGroup } = useUpsertRecordFilterGroup();
  const { removeRecordFilterGroup } = useRemoveRecordFilterGroup();

  const currentRecordFilters = useAtomComponentStateValue(
    currentRecordFiltersComponentState,
  ) as RecordFilter[];

  const effectifsField = findFieldByName(
    objectMetadataItem.fields,
    VERIDIAN_EFFECTIFS_FIELD,
  );
  const hasWebsiteField = findFieldByName(
    objectMetadataItem.fields,
    VERIDIAN_HAS_WEBSITE_FIELD,
  );
  const departementField = findFieldByName(
    objectMetadataItem.fields,
    VERIDIAN_DEPARTEMENT_FIELD,
  );
  const scoreField = findFieldByName(
    objectMetadataItem.fields,
    VERIDIAN_SCORE_FIELD,
  );
  const icpField = findFieldByName(objectMetadataItem.fields, VERIDIAN_ICP_FIELD);
  // hasMobile : n'existe PAS aujourd'hui sur company → mobileField undefined →
  // le toggle Mobile ne se rend pas (pas de bouton mort). Se câble tout seul le
  // jour où le champ BOOLEAN hasMobile est ajouté via IaC (cf utils).
  const mobileField = findFieldByName(
    objectMetadataItem.fields,
    VERIDIAN_HAS_MOBILE_FIELD,
  );

  // -- État actif (surlignage + toggle) --------------------------------------
  const activeSizePresetKey = effectifsField
    ? resolveActiveSizePresetKey(currentRecordFilters, effectifsField.id)
    : undefined;

  const activeSiteValue = hasWebsiteField
    ? resolveActiveSiteValue(currentRecordFilters, hasWebsiteField.id)
    : undefined;

  const activeGeoCodes = departementField
    ? resolveActiveGeoCodes(currentRecordFilters, departementField.id)
    : [];

  const activeScorePresetKey = scoreField
    ? resolveActiveScorePresetKey(currentRecordFilters, scoreField.id)
    : undefined;

  const activeIcpValue = icpField
    ? resolveActiveIcpValue(currentRecordFilters, icpField.id)
    : false;

  const activeMobileValue = mobileField
    ? resolveActiveMobileValue(currentRecordFilters, mobileField.id)
    : false;

  // -- Taille (effectifs) ----------------------------------------------------
  const clearSizeFilter = () => {
    if (!effectifsField) return;
    removeRecordFilter({ recordFilterId: buildSizeMinFilterId(effectifsField.id) });
    removeRecordFilter({ recordFilterId: buildSizeMaxFilterId(effectifsField.id) });
  };

  const applySizePreset = (presetKey: VeridianSizePresetKey) => {
    if (!effectifsField) return;

    // Toggle off si déjà actif.
    if (activeSizePresetKey === presetKey) {
      clearSizeFilter();
      return;
    }

    const preset = VERIDIAN_SIZE_PRESETS.find((item) => item.key === presetKey);
    if (!preset) return;

    // On repart d'une base propre (une borne ouverte doit effacer l'autre).
    clearSizeFilter();

    const filterType = getFilterTypeFromFieldType(effectifsField.type);
    const base = {
      fieldMetadataId: effectifsField.id,
      type: filterType,
      label: effectifsField.label,
      subFieldName: null,
    };

    if (preset.min !== undefined) {
      upsertRecordFilter({
        ...base,
        id: buildSizeMinFilterId(effectifsField.id),
        operand: VERIDIAN_FILTER_OPERANDS.greaterThanOrEqual,
        value: String(preset.min),
        displayValue: String(preset.min),
      });
    }
    if (preset.max !== undefined) {
      upsertRecordFilter({
        ...base,
        id: buildSizeMaxFilterId(effectifsField.id),
        operand: VERIDIAN_FILTER_OPERANDS.lessThanOrEqual,
        value: String(preset.max),
        displayValue: String(preset.max),
      });
    }
  };

  // -- Site (hasWebsite) -----------------------------------------------------
  const toggleSiteFilter = (targetValue: 'true' | 'false') => {
    if (!hasWebsiteField) return;

    const filterId = buildSiteFilterId(hasWebsiteField.id);

    // Toggle off si on re-clique la valeur déjà active.
    if (activeSiteValue === targetValue) {
      removeRecordFilter({ recordFilterId: filterId });
      return;
    }

    upsertRecordFilter({
      id: filterId,
      fieldMetadataId: hasWebsiteField.id,
      type: getFilterTypeFromFieldType(hasWebsiteField.type),
      operand: VERIDIAN_FILTER_OPERANDS.is,
      value: targetValue,
      displayValue: targetValue === 'true' ? 'True' : 'False',
      label: hasWebsiteField.label,
      subFieldName: null,
    });
  };

  // -- Géo multi-département (departement, TEXT CONTAINS, en RecordFilterGroup OR)
  // Un groupe OR + un filtre CONTAINS par département sélectionné. Re-cliquer un
  // département le retire ; retirer le dernier retire aussi le groupe.
  //
  // ⚠️ Limite connue (acceptée) : si l'utilisateur a par ailleurs des filtres
  // AVANCÉS avec leur propre groupe racine, computeRecordGqlOperationFilter ne
  // reconnaît qu'UN groupe racine (le premier sans parent). Notre groupe géo,
  // ajouté après, serait alors ignoré. Le cockpit est un outil de filtre RAPIDE
  // sur vue simple : cette coexistence est un cas de bord, pas le workflow cible.
  const clearGeoFilter = () => {
    if (!departementField) return;
    activeGeoCodes.forEach((code) => {
      removeRecordFilter({
        recordFilterId: buildGeoDeptFilterId(departementField.id, code),
      });
    });
    removeRecordFilterGroup(buildGeoGroupId(departementField.id));
  };

  const toggleGeoDept = (rawCode: string) => {
    if (!departementField) return;

    const code = normalizeDeptCode(rawCode);
    if (code === '') return;

    const deptFilterId = buildGeoDeptFilterId(departementField.id, code);
    const isActive = activeGeoCodes.includes(code);

    if (isActive) {
      removeRecordFilter({ recordFilterId: deptFilterId });
      // Dernier département retiré → on retire aussi le groupe OR.
      if (activeGeoCodes.length === 1) {
        removeRecordFilterGroup(buildGeoGroupId(departementField.id));
      }
      return;
    }

    const groupId = buildGeoGroupId(departementField.id);

    // Le groupe OR doit exister avant d'y rattacher un filtre. Upsert
    // idempotent (même id → pas de doublon).
    upsertRecordFilterGroup({
      id: groupId,
      logicalOperator: RecordFilterGroupLogicalOperator.OR,
      parentRecordFilterGroupId: null,
    });

    upsertRecordFilter({
      id: deptFilterId,
      fieldMetadataId: departementField.id,
      type: getFilterTypeFromFieldType(departementField.type),
      operand: VERIDIAN_FILTER_OPERANDS.contains,
      value: code,
      displayValue: code,
      label: departementField.label,
      subFieldName: null,
      recordFilterGroupId: groupId,
      positionInRecordFilterGroup: activeGeoCodes.length,
    });
  };

  // -- Qualité : score mini (prospectScore, NUMBER >=) -----------------------
  const clearScoreFilter = () => {
    if (!scoreField) return;
    removeRecordFilter({
      recordFilterId: buildScoreMinFilterId(scoreField.id),
    });
  };

  const applyScoreMin = (presetKey: VeridianScorePresetKey) => {
    if (!scoreField) return;

    // Toggle off si déjà actif.
    if (activeScorePresetKey === presetKey) {
      clearScoreFilter();
      return;
    }

    const preset = VERIDIAN_SCORE_PRESETS.find((item) => item.key === presetKey);
    if (!preset) return;

    upsertRecordFilter({
      id: buildScoreMinFilterId(scoreField.id),
      fieldMetadataId: scoreField.id,
      type: getFilterTypeFromFieldType(scoreField.type),
      operand: VERIDIAN_FILTER_OPERANDS.greaterThanOrEqual,
      value: String(preset.min),
      displayValue: String(preset.min),
      label: scoreField.label,
      subFieldName: null,
    });
  };

  // -- Qualité : ICP uniquement (idealCustomerProfile, BOOLEAN IS true) ------
  const toggleIcpFilter = () => {
    if (!icpField) return;

    const filterId = buildIcpFilterId(icpField.id);

    // Toggle off.
    if (activeIcpValue) {
      removeRecordFilter({ recordFilterId: filterId });
      return;
    }

    upsertRecordFilter({
      id: filterId,
      fieldMetadataId: icpField.id,
      type: getFilterTypeFromFieldType(icpField.type),
      operand: VERIDIAN_FILTER_OPERANDS.is,
      value: 'true',
      displayValue: 'True',
      label: icpField.label,
      subFieldName: null,
    });
  };

  // -- Mobile (hasMobile, BOOLEAN IS true) -----------------------------------
  // No-op tant que le champ n'existe pas (mobileField undefined). Voir le comment
  // VERIDIAN_HAS_MOBILE_FIELD dans utils : il faut créer le champ dérivé côté
  // IaC/scraper. Le toggle est déjà branché pour s'activer sans autre code.
  const toggleMobileFilter = () => {
    if (!mobileField) return;

    const filterId = buildMobileFilterId(mobileField.id);

    // Toggle off.
    if (activeMobileValue) {
      removeRecordFilter({ recordFilterId: filterId });
      return;
    }

    upsertRecordFilter({
      id: filterId,
      fieldMetadataId: mobileField.id,
      type: getFilterTypeFromFieldType(mobileField.type),
      operand: VERIDIAN_FILTER_OPERANDS.is,
      value: 'true',
      displayValue: 'True',
      label: mobileField.label,
      subFieldName: null,
    });
  };

  return {
    // dispo des champs (le cockpit masque un contrôle si son champ manque)
    hasEffectifsField: effectifsField !== undefined,
    hasWebsiteField: hasWebsiteField !== undefined,
    hasDepartementField: departementField !== undefined,
    hasScoreField: scoreField !== undefined,
    hasIcpField: icpField !== undefined,
    hasMobileField: mobileField !== undefined,
    // état actif
    activeSizePresetKey,
    activeSiteValue,
    activeGeoCodes,
    activeScorePresetKey,
    activeIcpValue,
    activeMobileValue,
    // actions
    applySizePreset,
    clearSizeFilter,
    toggleSiteFilter,
    toggleGeoDept,
    clearGeoFilter,
    applyScoreMin,
    clearScoreFilter,
    toggleIcpFilter,
    toggleMobileFilter,
  };
};
