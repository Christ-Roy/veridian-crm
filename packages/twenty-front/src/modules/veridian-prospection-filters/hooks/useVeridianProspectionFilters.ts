// Veridian — module AGPL. Colle entre les presets "cockpit prospection" et le
// vrai système de filtres de vue de Twenty (currentRecordFiltersComponentState).
//
// Aucune persistance maison, aucun store parallèle : on écrit dans l'atom de
// filtres de la vue courante via les hooks natifs (useUpsertRecordFilter /
// useRemoveRecordFilter). La table refetch toute seule (même mécanique que la
// ViewBar). Un reset de vue efface les filtres → comportement voulu pour des
// boutons d'action rapide.

import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { currentRecordFiltersComponentState } from '@/object-record/record-filter/states/currentRecordFiltersComponentState';
import { type RecordFilter } from '@/object-record/record-filter/types/RecordFilter';
import { useRemoveRecordFilter } from '@/object-record/record-filter/hooks/useRemoveRecordFilter';
import { useUpsertRecordFilter } from '@/object-record/record-filter/hooks/useUpsertRecordFilter';
import { useRecordIndexContextOrThrow } from '@/object-record/record-index/contexts/RecordIndexContext';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { getFilterTypeFromFieldType } from 'twenty-shared/utils';

import {
  VERIDIAN_DEPARTEMENT_FIELD,
  VERIDIAN_EFFECTIFS_FIELD,
  VERIDIAN_FILTER_OPERANDS,
  VERIDIAN_HAS_WEBSITE_FIELD,
  VERIDIAN_ICP_FIELD,
  VERIDIAN_SCORE_FIELD,
  VERIDIAN_SCORE_PRESETS,
  VERIDIAN_SIZE_PRESETS,
  type VeridianScorePresetKey,
  type VeridianSizePresetKey,
  buildGeoFilterId,
  buildIcpFilterId,
  buildScoreMinFilterId,
  buildSiteFilterId,
  buildSizeMaxFilterId,
  buildSizeMinFilterId,
  resolveActiveGeoValue,
  resolveActiveIcpValue,
  resolveActiveScorePresetKey,
  resolveActiveSizePresetKey,
  resolveActiveSiteValue,
} from '@/veridian-prospection-filters/utils/veridianProspectionFilter';

const findFieldByName = (
  fields: FieldMetadataItem[],
  name: string,
): FieldMetadataItem | undefined => fields.find((field) => field.name === name);

export const useVeridianProspectionFilters = () => {
  const { objectMetadataItem, recordIndexId } = useRecordIndexContextOrThrow();

  // instanceId = recordIndexId (== viewBarInstanceId) : c'est la clé sous
  // laquelle vit l'atom de filtres de CETTE vue.
  const { upsertRecordFilter } = useUpsertRecordFilter(recordIndexId);
  const { removeRecordFilter } = useRemoveRecordFilter(recordIndexId);

  const currentRecordFilters = useAtomComponentStateValue(
    currentRecordFiltersComponentState,
    recordIndexId,
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

  // -- État actif (surlignage + toggle) --------------------------------------
  const activeSizePresetKey = effectifsField
    ? resolveActiveSizePresetKey(currentRecordFilters, effectifsField.id)
    : undefined;

  const activeSiteValue = hasWebsiteField
    ? resolveActiveSiteValue(currentRecordFilters, hasWebsiteField.id)
    : undefined;

  const activeGeoValue = departementField
    ? resolveActiveGeoValue(currentRecordFilters, departementField.id)
    : undefined;

  const activeScorePresetKey = scoreField
    ? resolveActiveScorePresetKey(currentRecordFilters, scoreField.id)
    : undefined;

  const activeIcpValue = icpField
    ? resolveActiveIcpValue(currentRecordFilters, icpField.id)
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

  // -- Département (departement, TEXT → CONTAINS) ----------------------------
  const clearGeoFilter = () => {
    if (!departementField) return;
    removeRecordFilter({
      recordFilterId: buildGeoFilterId(departementField.id),
    });
  };

  const applyGeoFilter = (rawValue: string) => {
    if (!departementField) return;

    const value = rawValue.trim();

    // Champ vidé → on efface (toggle off).
    if (value === '') {
      clearGeoFilter();
      return;
    }

    upsertRecordFilter({
      id: buildGeoFilterId(departementField.id),
      fieldMetadataId: departementField.id,
      type: getFilterTypeFromFieldType(departementField.type),
      operand: VERIDIAN_FILTER_OPERANDS.contains,
      value,
      displayValue: value,
      label: departementField.label,
      subFieldName: null,
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

  return {
    // dispo des champs (le cockpit masque un contrôle si son champ manque)
    hasEffectifsField: effectifsField !== undefined,
    hasWebsiteField: hasWebsiteField !== undefined,
    hasDepartementField: departementField !== undefined,
    hasScoreField: scoreField !== undefined,
    hasIcpField: icpField !== undefined,
    // état actif
    activeSizePresetKey,
    activeSiteValue,
    activeGeoValue,
    activeScorePresetKey,
    activeIcpValue,
    // actions
    applySizePreset,
    clearSizeFilter,
    toggleSiteFilter,
    applyGeoFilter,
    clearGeoFilter,
    applyScoreMin,
    clearScoreFilter,
    toggleIcpFilter,
  };
};
