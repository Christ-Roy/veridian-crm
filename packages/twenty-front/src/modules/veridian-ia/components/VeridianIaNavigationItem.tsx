import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';
import { NavigationDrawerSection } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSection';
import { useVeridianLiensInstallation } from '@/veridian-ia/hooks/useVeridianLiensInstallation';
import { useLingui } from '@lingui/react/macro';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { IconPlug } from 'twenty-ui/icon';

// Shown only once the Hub links are known: never an entry that leads to an empty page.
export const VeridianIaNavigationItem = () => {
  const { t } = useLingui();
  const { etat } = useVeridianLiensInstallation();

  if (etat !== 'pret') {
    return null;
  }

  return (
    <NavigationDrawerSection>
      <NavigationDrawerItem
        label={t`Connect your AI`}
        to={getSettingsPath(SettingsPath.VeridianIa)}
        Icon={IconPlug}
      />
    </NavigationDrawerSection>
  );
};
