// Veridian — module AGPL. Dropdown "Taille" du cockpit prospection.
// Individuel / PME / Grande → pose le range d'effectifs correspondant sur la
// vue courante. Re-clic sur le preset actif = toggle off (géré dans le hook).

import { Dropdown } from '@/ui/layout/dropdown/components/Dropdown';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { DropdownMenuSeparator } from '@/ui/layout/dropdown/components/DropdownMenuSeparator';
import { StyledHeaderDropdownButton } from '@/ui/layout/dropdown/components/StyledHeaderDropdownButton';
import { GenericDropdownContentWidth } from '@/ui/layout/dropdown/constants/GenericDropdownContentWidth';
import { isDropdownOpenComponentState } from '@/ui/layout/dropdown/states/isDropdownOpenComponentState';
import { useCloseDropdown } from '@/ui/layout/dropdown/hooks/useCloseDropdown';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { useLingui } from '@lingui/react/macro';
import {
  type IconComponent,
  IconBuildingSkyscraper,
  IconRotate2,
  IconUser,
  IconUsers,
} from 'twenty-ui-deprecated/display';
import { MenuItem } from 'twenty-ui-deprecated/navigation';

import { useVeridianProspectionFilters } from '@/veridian-prospection-filters/hooks/useVeridianProspectionFilters';
import {
  VERIDIAN_SIZE_PRESETS,
  type VeridianSizePresetKey,
} from '@/veridian-prospection-filters/utils/veridianProspectionFilter';

const VERIDIAN_SIZE_DROPDOWN_ID = 'veridian-size-filter-dropdown';

const PRESET_ICON: Record<VeridianSizePresetKey, IconComponent> = {
  individuel: IconUser,
  pme: IconUsers,
  grande: IconBuildingSkyscraper,
};

export const VeridianSizeFilterDropdown = () => {
  const { t } = useLingui();
  const { closeDropdown } = useCloseDropdown();
  const { applySizePreset, clearSizeFilter, activeSizePresetKey } =
    useVeridianProspectionFilters();

  const isDropdownOpen = useAtomComponentStateValue(
    isDropdownOpenComponentState,
    VERIDIAN_SIZE_DROPDOWN_ID,
  );

  const handleSelect = (presetKey: VeridianSizePresetKey) => {
    applySizePreset(presetKey);
    closeDropdown(VERIDIAN_SIZE_DROPDOWN_ID);
  };

  const handleClear = () => {
    clearSizeFilter();
    closeDropdown(VERIDIAN_SIZE_DROPDOWN_ID);
  };

  return (
    <Dropdown
      dropdownId={VERIDIAN_SIZE_DROPDOWN_ID}
      dropdownOffset={{ y: 8 }}
      clickableComponent={
        <StyledHeaderDropdownButton
          isUnfolded={isDropdownOpen}
          isActive={activeSizePresetKey !== undefined}
        >
          {t`Taille`}
        </StyledHeaderDropdownButton>
      }
      dropdownComponents={
        <DropdownContent widthInPixels={GenericDropdownContentWidth.Medium}>
          <DropdownMenuItemsContainer>
            {VERIDIAN_SIZE_PRESETS.map((preset) => (
              <MenuItem
                key={preset.key}
                text={preset.label}
                LeftIcon={PRESET_ICON[preset.key]}
                onClick={() => handleSelect(preset.key)}
                selected={activeSizePresetKey === preset.key}
              />
            ))}
          </DropdownMenuItemsContainer>
          {activeSizePresetKey !== undefined && (
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
