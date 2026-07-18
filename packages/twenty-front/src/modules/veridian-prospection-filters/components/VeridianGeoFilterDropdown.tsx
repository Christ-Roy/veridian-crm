// Veridian — module AGPL (fork twentyhq/twenty). Dropdown "Géographie" du
// cockpit prospection, à 2 niveaux :
//   1. RÉGION — on déplie une région pour voir ses départements
//   2. DÉPARTEMENT — sélection MULTIPLE (checkbox), chaque département coché
//      pose un filtre `departement CONTAINS <code>` dans un RecordFilterGroup OR
//      (cf useVeridianProspectionFilters.toggleGeoDept)
// + saisie LIBRE d'un n° de département en haut (ex "2A", "75") qui l'ajoute à
//   la sélection — utile pour un code hors liste ou une frappe rapide.
//
// La donnée company.departement ne stocke qu'un code 2 chars (ex "31"), donc
// CONTAINS y équivaut à un equals (aucun faux positif). Le champ region
// n'existe pas → la table région→départements est statique (utils/frenchDepartments).

import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { type KeyboardEvent, useMemo, useState } from 'react';
import {
  IconChevronDown,
  IconChevronRight,
  IconMap,
  IconPlus,
  IconRotate2,
} from 'twenty-ui-deprecated/display';
import { MenuItem, MenuItemMultiSelect } from 'twenty-ui-deprecated/navigation';
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
import {
  FRENCH_REGIONS,
  formatDeptLabel,
  normalizeDeptCode,
} from '@/veridian-prospection-filters/utils/frenchDepartments';

const VERIDIAN_GEO_DROPDOWN_ID = 'veridian-geo-filter-dropdown';

const StyledButtonContent = styled.span`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledInputRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
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

const StyledRegionHeaderText = styled.span`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledRegionCount = styled.span`
  color: ${themeCssVariables.font.color.light};
  font-weight: ${themeCssVariables.font.weight.regular};
`;

export const VeridianGeoFilterDropdown = () => {
  const { t } = useLingui();
  const { closeDropdown } = useCloseDropdown();
  const { toggleGeoDept, clearGeoFilter, activeGeoCodes } =
    useVeridianProspectionFilters();

  const isDropdownOpen = useAtomComponentStateValue(
    isDropdownOpenComponentState,
    VERIDIAN_GEO_DROPDOWN_ID,
  );

  const [draft, setDraft] = useState('');
  const [expandedRegionKey, setExpandedRegionKey] = useState<string | null>(
    null,
  );

  const activeCodesSet = useMemo(
    () => new Set(activeGeoCodes),
    [activeGeoCodes],
  );

  const activeCount = activeGeoCodes.length;

  // Nombre de départements actifs par région (badge sur l'entête de région).
  const activeCountByRegion = useMemo(() => {
    const counts: Record<string, number> = {};
    FRENCH_REGIONS.forEach((region) => {
      counts[region.key] = region.departments.filter((dept) =>
        activeCodesSet.has(dept.code),
      ).length;
    });
    return counts;
  }, [activeCodesSet]);

  const submitDraft = () => {
    const code = normalizeDeptCode(draft);
    if (code === '' || activeCodesSet.has(code)) {
      setDraft('');
      return;
    }
    toggleGeoDept(code);
    setDraft('');
  };

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitDraft();
    }
  };

  const handleClear = () => {
    clearGeoFilter();
    setDraft('');
    closeDropdown(VERIDIAN_GEO_DROPDOWN_ID);
  };

  const buttonLabel =
    activeCount === 0
      ? t`Géographie`
      : activeCount === 1
        ? t`Dépt ${activeGeoCodes[0]}`
        : t`${activeCount} dépts`;

  return (
    <Dropdown
      dropdownId={VERIDIAN_GEO_DROPDOWN_ID}
      dropdownOffset={{ y: 8 }}
      clickableComponent={
        <StyledHeaderDropdownButton
          isUnfolded={isDropdownOpen}
          isActive={activeCount > 0}
        >
          <StyledButtonContent>
            <IconMap size={14} />
            {buttonLabel}
          </StyledButtonContent>
        </StyledHeaderDropdownButton>
      }
      dropdownComponents={
        <DropdownContent widthInPixels={GenericDropdownContentWidth.Medium}>
          <StyledInputRow>
            <IconPlus
              size={14}
              color={themeCssVariables.font.color.tertiary}
            />
            <StyledInput
              autoComplete="off"
              autoFocus
              value={draft}
              placeholder={t`N° de département (ex : 75, 2A)`}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleDraftKeyDown}
            />
          </StyledInputRow>
          <DropdownMenuSeparator />
          <DropdownMenuItemsContainer hasMaxHeight>
            {FRENCH_REGIONS.map((region) => {
              const isExpanded = expandedRegionKey === region.key;
              const regionActiveCount = activeCountByRegion[region.key] ?? 0;

              return (
                <div key={region.key}>
                  <MenuItem
                    text={region.label}
                    LeftIcon={isExpanded ? IconChevronDown : IconChevronRight}
                    onClick={() =>
                      setExpandedRegionKey(isExpanded ? null : region.key)
                    }
                    RightComponent={
                      regionActiveCount > 0 ? (
                        <StyledRegionCount>
                          {regionActiveCount}
                        </StyledRegionCount>
                      ) : undefined
                    }
                  />
                  {isExpanded &&
                    region.departments.map((dept) => (
                      <MenuItemMultiSelect
                        key={dept.code}
                        className=""
                        text={`${dept.code} · ${dept.name}`}
                        selected={activeCodesSet.has(dept.code)}
                        onSelectChange={() => toggleGeoDept(dept.code)}
                      />
                    ))}
                </div>
              );
            })}
          </DropdownMenuItemsContainer>
          {activeCount > 0 && (
            <>
              <DropdownMenuSeparator />
              <StyledInputRow>
                <StyledRegionHeaderText>
                  {activeGeoCodes.map(formatDeptLabel).join(', ')}
                </StyledRegionHeaderText>
              </StyledInputRow>
              <DropdownMenuItemsContainer>
                <MenuItem
                  text={t`Tout réinitialiser`}
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
