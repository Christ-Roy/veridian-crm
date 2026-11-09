import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { type ReactNode } from 'react';

import ClaudeLogo from '@/settings/mcp/assets/mcp-clients/claude-color.png';
import CursorLogo from '@/settings/mcp/assets/mcp-clients/cursor.svg';
import OpenAiLogo from '@/settings/mcp/assets/mcp-clients/openai.svg';
import VsCodeLogo from '@/settings/mcp/assets/mcp-clients/vs-code.svg';
import { McpClientLogo } from '@/settings/mcp/components/McpClientLogo';
import { SettingsMcpSetupCard } from '@/settings/mcp/components/SettingsMcpSetupCard';
import { type McpSetupCard } from '@/settings/mcp/types/McpSetup';
import { LightCopyIconButton } from '@/ui/input/components/LightCopyIconButton';
import {
  type VeridianAssistant,
  useVeridianLiensInstallation,
} from '@/veridian-ia/hooks/useVeridianLiensInstallation';
import { Section } from 'twenty-ui/components/layout';
import { MOBILE_VIEWPORT, themeCssVariables } from 'twenty-ui/theme';

const StyledCardsGrid = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[3]};
  grid-template-columns: repeat(2, minmax(0, 1fr));

  @media (max-width: ${MOBILE_VIEWPORT}px) {
    grid-template-columns: 1fr;
  }
`;

const StyledAddress = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[2]};
  margin-top: ${themeCssVariables.spacing[3]};
  word-break: break-all;
`;

// One connection at the Veridian Hub gives the AI every Veridian app the user has, CRM included.
export const VeridianIaSetup = () => {
  const { t } = useLingui();
  const { liens } = useVeridianLiensInstallation();

  if (liens === null) {
    return null;
  }

  const presentation: Record<
    string,
    { title: string; badge: string; description: string; logo: ReactNode }
  > = {
    claude: {
      title: t`Claude`,
      badge: t`Connector`,
      description: t`Opens Claude with the Veridian connector prefilled: confirm, then sign in.`,
      logo: <McpClientLogo src={ClaudeLogo} />,
    },
    chatgpt: {
      title: t`ChatGPT`,
      badge: t`Connector`,
      description: t`Add an MCP server in ChatGPT settings with the Veridian address below.`,
      logo: <McpClientLogo src={OpenAiLogo} invertInDarkMode />,
    },
    cursor: {
      title: t`Cursor`,
      badge: t`Install link`,
      description: t`Adds the Veridian server to Cursor in one click.`,
      logo: <McpClientLogo src={CursorLogo} invertInDarkMode />,
    },
    vscode: {
      title: t`VS Code`,
      badge: t`Install link`,
      description: t`Adds the Veridian server to VS Code in one click.`,
      logo: <McpClientLogo src={VsCodeLogo} />,
    },
  };

  // Labels and steps come from the Hub, so every Veridian app says the same thing.
  // An assistant the Hub adds later still gets its button, with a plain presentation.
  const presentationOf = (assistant: VeridianAssistant) =>
    presentation[assistant.cle] ?? {
      title: assistant.libelle,
      badge: t`Connector`,
      description: t`Connects this assistant to Veridian.`,
      logo: null,
    };

  const cards: McpSetupCard[] = liens.assistants.map((assistant) => ({
    ...presentationOf(assistant),
    description: assistant.etape ?? presentationOf(assistant).description,
    ctaLabel: assistant.libelle,
    href: assistant.installation,
  }));

  return (
    <Section.Root>
      <Section.Header
        title={t`Connect your AI to Veridian`}
        description={
          liens.phrase ||
          t`One connection gives your assistant your CRM and every other Veridian app, with your own access rights.`
        }
      />
      <StyledCardsGrid>
        {cards.map((card) => (
          <SettingsMcpSetupCard key={card.title} card={card} />
        ))}
      </StyledCardsGrid>
      <StyledAddress>
        <span>{t`Veridian address`}</span>
        <code>{liens.url}</code>
        <LightCopyIconButton copyText={liens.url} />
      </StyledAddress>
      {liens.claudeCode !== '' && (
        <StyledAddress>
          <span>{t`Claude Code`}</span>
          <code>{liens.claudeCode}</code>
          <LightCopyIconButton copyText={liens.claudeCode} />
        </StyledAddress>
      )}
    </Section.Root>
  );
};
