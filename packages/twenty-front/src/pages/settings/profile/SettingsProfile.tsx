import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { EmailField } from '@/settings/profile/components/EmailField';
import { NameFields } from '@/settings/profile/components/NameFields';
import { SetOrChangePassword } from '@/settings/profile/components/SetOrChangePassword';
import { SettingsProfileDevicesSection } from '@/settings/profile/devices/components/SettingsProfileDevicesSection';
import { useCanChangePassword } from '@/settings/profile/hooks/useCanChangePassword';
import { WorkspaceMemberPictureUploader } from '@/settings/workspace-member/components/WorkspaceMemberPictureUploader';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { Trans, useLingui } from '@lingui/react/macro';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { Section } from 'twenty-ui/components/layout';

export const SettingsProfile = () => {
  const { t } = useLingui();
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);

  const { canChangePassword } = useCanChangePassword();

  if (!currentWorkspaceMember?.id) {
    return null;
  }

  return (
    <SettingsPageLayout
      title={t`Profile`}
      links={[
        {
          children: <Trans>User</Trans>,
          href: getSettingsPath(SettingsPath.ProfilePage),
        },
        { children: <Trans>Profile</Trans> },
      ]}
    >
      <SettingsPageContainer>
        <Section.Root>
          <Section.Header title={t`Picture`} />
          <WorkspaceMemberPictureUploader
            workspaceMemberId={currentWorkspaceMember.id}
          />
        </Section.Root>
        <Section.Root>
          <Section.Header
            title={t`Name`}
            description={t`Your name as it will be displayed`}
          />
          <NameFields key={currentWorkspaceMember.id} />
        </Section.Root>
        <Section.Root>
          <Section.Header
            title={t`Email`}
            description={t`The email associated to your account`}
          />
          <EmailField />
        </Section.Root>
        {canChangePassword && (
          <Section.Root>
            <SetOrChangePassword />
          </Section.Root>
        )}
        <SettingsProfileDevicesSection />
      </SettingsPageContainer>
    </SettingsPageLayout>
  );
};
