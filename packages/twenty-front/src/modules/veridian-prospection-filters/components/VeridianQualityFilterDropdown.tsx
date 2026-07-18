// Veridian — module AGPL. Dropdown "Qualité" du cockpit prospection.
// (a) Score mini via prospectScore (NUMBER, >=) : Top ≥90 / Bon ≥70 / Moyen ≥50.
// (b) "ICP uniquement" via idealCustomerProfile (BOOLEAN, IS true).
// Re-clic sur le preset actif = toggle off (géré dans le hook). Chaque contrôle
// se masque tout seul si son champ n'existe pas sur l'objet company.

import { useLingui } from '@lingui/react/macro';
import {
  type IconComponent,
  IconBolt,
  IconGauge,
  IconRotate2,
  IconStar,
  IconTarget,
} from 'twenty-ui/icon';
import { MenuItem } from 'twenty-ui/navigation';

import { Dropdown } from '@/ui/layout/dropdown/components/Dropdown';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { DropdownMenuSeparator } from '@/ui/layout/dropdown/components/DropdownMenuSeparator';
import { StyledHeaderDropdownButton } from '@/ui/layout/dropdown/components/StyledHeaderDropdownButton';
import { GenericDropdownContentWidth } from '@/ui/layout/dropdown/constants/GenericDropdownContentWidth';
import { useCloseDropdown } from '@/ui/layout/dropdown/hooks/useCloseDropdown';
import { isDropdownOpenComponentState } from '@/ui/layout/dropdown/states/isDropdownOpenComponentState';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';

import { useVeridianProspectionFilters } from '@/veridian-prospection-filters/hooks/useVeridianProspectionFilters';
import {
  VERIDIAN_SCORE_PRESETS,
  type VeridianScorePresetKey,
} from '@/veridian-prospection-filters/utils/veridianProspectionFilter';

const VERIDIAN_QUALITY_DROPDOWN_ID = 'veridian-quality-filter-dropdown';

const SCORE_ICON: Record<VeridianScorePresetKey, IconComponent> = {
  top: IconStar,
  bon: IconBolt,
  moyen: IconGauge,
};

export const VeridianQualityFilterDropdown = () => {
  const { t } = useLingui();
  const { closeDropdown } = useCloseDropdown();
  const {
    hasScoreField,
    hasIcpField,
    activeScorePresetKey,
    activeIcpValue,
    applyScoreMin,
    clearScoreFilter,
    toggleIcpFilter,
  } = useVeridianProspectionFilters();

  const isDropdownOpen = useAtomComponentStateValue(
    isDropdownOpenComponentState,
    VERIDIAN_QUALITY_DROPDOWN_ID,
  );

  const isActive = activeScorePresetKey !== undefined || activeIcpValue;

  const handleScore = (presetKey: VeridianScorePresetKey) => {
    applyScoreMin(presetKey);
    closeDropdown(VERIDIAN_QUALITY_DROPDOWN_ID);
  };

  const handleClear = () => {
    clearScoreFilter();
    if (activeIcpValue) {
      toggleIcpFilter();
    }
    closeDropdown(VERIDIAN_QUALITY_DROPDOWN_ID);
  };

  return (
    <Dropdown
      dropdownId={VERIDIAN_QUALITY_DROPDOWN_ID}
      dropdownOffset={{ y: 8 }}
      clickableComponent={
        <StyledHeaderDropdownButton
          isUnfolded={isDropdownOpen}
          isActive={isActive}
        >
          {t`Qualité`}
        </StyledHeaderDropdownButton>
      }
      dropdownComponents={
        <DropdownContent widthInPixels={GenericDropdownContentWidth.Medium}>
          {hasScoreField && (
            <DropdownMenuItemsContainer>
              {VERIDIAN_SCORE_PRESETS.map((preset) => (
                <MenuItem
                  key={preset.key}
                  text={preset.label}
                  LeftIcon={SCORE_ICON[preset.key]}
                  onClick={() => handleScore(preset.key)}
                  selected={activeScorePresetKey === preset.key}
                />
              ))}
            </DropdownMenuItemsContainer>
          )}
          {hasScoreField && hasIcpField && <DropdownMenuSeparator />}
          {hasIcpField && (
            <DropdownMenuItemsContainer>
              <MenuItem
                text={t`ICP uniquement`}
                LeftIcon={IconTarget}
                onClick={toggleIcpFilter}
                selected={activeIcpValue}
              />
            </DropdownMenuItemsContainer>
          )}
          {isActive && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItemsContainer>
                <MenuItem
                  text={t`Réinitialiser`}
                  LeftIcon={IconRotate2}
                  onClick={handleClear}
                />
              </DropdownMenuItemsContainer>
            </>
          )}
        </DropdownContent>
      }
    />
  );
};
