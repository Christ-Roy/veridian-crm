// Veridian — module AGPL (fork twentyhq/twenty). Cockpit prospection : boutons
// de filtre rapides dans la barre de vue.
//
// ACCROCHE CORE : monté par ViewBar.tsx (partagé par tous les objets). Le gating
// sur l'objet `company` est fait ICI (jamais dans le core). Rien ne s'affiche
// pour les autres objets.
//
// Toute la logique de filtre vit dans useVeridianProspectionFilters (qui écrit
// dans le vrai système de filtres de Twenty). Ce composant n'est que l'UI.

import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { IconLink, IconLinkOff } from 'twenty-ui-deprecated/display';
import { themeCssVariables } from 'twenty-ui-deprecated/theme-constants';

import { useRecordIndexContextOrThrow } from '@/object-record/record-index/contexts/RecordIndexContext';
import { StyledHeaderDropdownButton } from '@/ui/layout/dropdown/components/StyledHeaderDropdownButton';

import { VeridianGeoFilterDropdown } from '@/veridian-prospection-filters/components/VeridianGeoFilterDropdown';
import { VeridianQualityFilterDropdown } from '@/veridian-prospection-filters/components/VeridianQualityFilterDropdown';
import { VeridianSizeFilterDropdown } from '@/veridian-prospection-filters/components/VeridianSizeFilterDropdown';
import { useVeridianProspectionFilters } from '@/veridian-prospection-filters/hooks/useVeridianProspectionFilters';
import { isVeridianProspectionFilterObject } from '@/veridian-prospection-filters/utils/veridianProspectionFilter';

const StyledContainer = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledIconButton = styled(StyledHeaderDropdownButton)`
  gap: ${themeCssVariables.spacing[1]};
`;

const VeridianProspectionFilterButtonsContent = () => {
  const { t } = useLingui();
  const {
    hasEffectifsField,
    hasWebsiteField,
    hasDepartementField,
    hasScoreField,
    hasIcpField,
    activeSiteValue,
    toggleSiteFilter,
  } = useVeridianProspectionFilters();

  return (
    <StyledContainer>
      {hasEffectifsField && <VeridianSizeFilterDropdown />}
      {hasDepartementField && <VeridianGeoFilterDropdown />}
      {(hasScoreField || hasIcpField) && <VeridianQualityFilterDropdown />}
      {hasWebsiteField && (
        <>
          <StyledIconButton
            isActive={activeSiteValue === 'true'}
            onClick={() => toggleSiteFilter('true')}
          >
            <IconLink size={14} />
            {t`Avec site`}
          </StyledIconButton>
          <StyledIconButton
            isActive={activeSiteValue === 'false'}
            onClick={() => toggleSiteFilter('false')}
          >
            <IconLinkOff size={14} />
            {t`Sans site`}
          </StyledIconButton>
        </>
      )}
    </StyledContainer>
  );
};

export const VeridianProspectionFilterButtons = () => {
  // Gating : le cockpit ne s'affiche QUE sur company. On lit le contexte du
  // record-index (dispo car monté dans ViewBar, sous RecordIndexContextProvider).
  const { objectNameSingular } = useRecordIndexContextOrThrow();

  if (!isVeridianProspectionFilterObject(objectNameSingular)) {
    return null;
  }

  return <VeridianProspectionFilterButtonsContent />;
};
