import { styled } from '@linaria/react';

import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { VeridianIaSetup } from '@/veridian-ia/components/VeridianIaSetup';
import { useVeridianLiensInstallation } from '@/veridian-ia/hooks/useVeridianLiensInstallation';
import { Trans, useLingui } from '@lingui/react/macro';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme';

const StyledUnavailable = styled.p`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.md};
`;

// Open to every member (Robert, 09/11/2026): each user connects their own AI, with their own rights.
export const SettingsVeridianIa = () => {
  const { t } = useLingui();
  const { etat } = useVeridianLiensInstallation();

  return (
    <SettingsPageLayout
      title={t`Connect your AI`}
      links={[
        {
          children: <Trans>User</Trans>,
          href: getSettingsPath(SettingsPath.ProfilePage),
        },
        { children: <Trans>Connect your AI</Trans> },
      ]}
    >
      <SettingsPageContainer>
        {etat === 'indisponible' ? (
          <StyledUnavailable>
            {t`The Veridian connection service is not reachable right now. Please try again in a few minutes.`}
          </StyledUnavailable>
        ) : (
          <VeridianIaSetup />
        )}
      </SettingsPageContainer>
    </SettingsPageLayout>
  );
};
