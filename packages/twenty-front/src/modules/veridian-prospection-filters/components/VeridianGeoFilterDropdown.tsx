// Veridian — module AGPL. Dropdown "Département" du cockpit prospection.
// L'utilisateur tape un n° de département (ex "75") → pose un filtre
// `departement CONTAINS "75"` sur la vue courante (TEXT ne supporte pas IS côté
// query builder Twenty). Entrée ou "Appliquer" pose le filtre ; champ vidé +
// Appliquer, ou "Réinitialiser" = clear.

import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { type KeyboardEvent, useEffect, useState } from 'react';
import {
  IconMap,
  IconRotate2,
  IconSearch,
} from 'twenty-ui-deprecated/display';
import { MenuItem } from 'twenty-ui-deprecated/navigation';
import { themeCssVariables } from 'twenty-ui-deprecated/theme-constants';

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

const VERIDIAN_GEO_DROPDOWN_ID = 'veridian-geo-filter-dropdown';

const StyledButtonContent = styled.span`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledInputContainer = styled.div`
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledInput = styled.input`
  background-color: transparent;
  border: none;
  color: ${themeCssVariables.font.color.primary};
  font-family: ${themeCssVariables.font.family};
  font-size: ${themeCssVariables.font.size.sm};
  outline: none;
  padding: ${themeCssVariables.spacing[0]} ${themeCssVariables.spacing[1]};
  width: 100%;

  &::placeholder {
    color: ${themeCssVariables.font.color.light};
    font-weight: ${themeCssVariables.font.weight.medium};
  }
`;

export const VeridianGeoFilterDropdown = () => {
  const { t } = useLingui();
  const { closeDropdown } = useCloseDropdown();
  const { applyGeoFilter, clearGeoFilter, activeGeoValue } =
    useVeridianProspectionFilters();

  const isDropdownOpen = useAtomComponentStateValue(
    isDropdownOpenComponentState,
    VERIDIAN_GEO_DROPDOWN_ID,
  );

  const [draft, setDraft] = useState(activeGeoValue ?? '');

  // Resynchronise le champ quand le filtre change ailleurs (reset de vue, etc.)
  // ou à la réouverture du dropdown.
  useEffect(() => {
    if (isDropdownOpen) {
      setDraft(activeGeoValue ?? '');
    }
  }, [isDropdownOpen, activeGeoValue]);

  const submit = () => {
    applyGeoFilter(draft);
    closeDropdown(VERIDIAN_GEO_DROPDOWN_ID);
  };

  const handleClear = () => {
    setDraft('');
    clearGeoFilter();
    closeDropdown(VERIDIAN_GEO_DROPDOWN_ID);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  return (
    <Dropdown
      dropdownId={VERIDIAN_GEO_DROPDOWN_ID}
      dropdownOffset={{ y: 8 }}
      clickableComponent={
        <StyledHeaderDropdownButton
          isUnfolded={isDropdownOpen}
          isActive={activeGeoValue !== undefined}
        >
          <StyledButtonContent>
            <IconMap size={14} />
            {activeGeoValue !== undefined
              ? t`Dépt ${activeGeoValue}`
              : t`Département`}
          </StyledButtonContent>
        </StyledHeaderDropdownButton>
      }
      dropdownComponents={
        <DropdownContent widthInPixels={GenericDropdownContentWidth.Medium}>
          <StyledInputContainer>
            <StyledInput
              autoComplete="off"
              autoFocus
              value={draft}
              placeholder={t`N° de département (ex : 75)`}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
            />
          </StyledInputContainer>
          <DropdownMenuSeparator />
          <DropdownMenuItemsContainer>
            <MenuItem
              text={t`Appliquer`}
              LeftIcon={IconSearch}
              onClick={submit}
            />
            {activeGeoValue !== undefined && (
              <MenuItem
                text={t`Réinitialiser`}
                LeftIcon={IconRotate2}
                onClick={handleClear}
              />
            )}
          </DropdownMenuItemsContainer>
        </DropdownContent>
      }
    />
  );
};
