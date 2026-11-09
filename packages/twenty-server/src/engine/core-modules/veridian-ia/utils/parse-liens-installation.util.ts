// « Brancher mon IA » (Robert, 09/11/2026): the Hub publishes the install links of its single MCP gate,
// every app shows them as buttons. A link is only kept if it points where its client expects.
export type LiensInstallation = {
  url: string;
  claude: string;
  chatgpt: string;
  cursor: string;
  vscode: string;
  claudeCode: string;
  instructionsChatgpt: string;
};

const EXPECTED_PREFIXES = {
  url: 'https://',
  claude: 'https://claude.ai/',
  chatgpt: 'https://chatgpt.com/',
  cursor: 'cursor://anysphere.cursor-deeplink/',
  vscode: 'https://vscode.dev/redirect',
} as const;

const MAX_LENGTH = 4000;

const isString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_LENGTH;

export const parseLiensInstallation = (
  raw: unknown,
): LiensInstallation | null => {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const body = raw as Record<string, unknown>;

  for (const [key, prefix] of Object.entries(EXPECTED_PREFIXES)) {
    const value = body[key];

    if (!isString(value) || !value.startsWith(prefix)) {
      return null;
    }
  }

  const instructions = body.instructions as Record<string, unknown> | undefined;

  return {
    url: body.url as string,
    claude: body.claude as string,
    chatgpt: body.chatgpt as string,
    cursor: body.cursor as string,
    vscode: body.vscode as string,
    claudeCode: isString(body.claudeCode) ? body.claudeCode : '',
    instructionsChatgpt: isString(instructions?.chatgpt)
      ? instructions.chatgpt
      : '',
  };
};
