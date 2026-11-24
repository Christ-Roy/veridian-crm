import { styled } from '@linaria/react';
import { type ReactNode } from 'react';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { Button } from 'twenty-ui/primitives/input';
import { themeCssVariables } from 'twenty-ui/theme';

import { useAuth } from '@/auth/hooks/useAuth';
import { useIsWorkspaceActivationStatusEqualsTo } from '@/workspace/hooks/useIsWorkspaceActivationStatusEqualsTo';

const StyledPage = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.primary};
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  height: 100dvh;
  justify-content: center;
  padding: ${themeCssVariables.spacing[6]};
  text-align: center;
  width: 100%;
`;

const StyledTitle = styled.h1`
  font-size: ${themeCssVariables.font.size.xl};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  margin: 0;
`;

const StyledText = styled.p`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.md};
  margin: 0;
  max-width: 420px;
`;

// Veridian (CONTRAT-HUB §5.4) : un espace suspendu n'affiche que ce message, jamais de facturation.
export const VeridianSuspendedGate = ({
  children,
}: {
  children: ReactNode;
}) => {
  const isSuspended = useIsWorkspaceActivationStatusEqualsTo(
    WorkspaceActivationStatus.SUSPENDED,
  );
  const { signOut } = useAuth();

  if (!isSuspended) {
    return <>{children}</>;
  }

  return (
    <StyledPage>
      <StyledTitle>Cet espace est suspendu.</StyledTitle>
      <StyledText>Vos données sont conservées. Contactez Veridian.</StyledText>
      <Button variant="outline" onClick={signOut}>
        Se déconnecter
      </Button>
    </StyledPage>
  );
};
