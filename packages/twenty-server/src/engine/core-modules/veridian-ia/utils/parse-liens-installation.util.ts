// « Brancher mon IA » (Robert, 09/11/2026): the Hub publishes the install links of its single MCP gate
// (GET /api/mcp/liens-installation?app=twenty), every app shows them as buttons. A link is only kept if
// its scheme is one a browser can safely open, so a Hub mistake can never become a javascript: link.
export type AssistantInstallation = {
  cle: string;
  libelle: string;
  installation: string;
  etape: string | null;
};

export type LiensInstallation = {
  url: string;
  assistants: AssistantInstallation[];
  claudeCode: string;
  phrase: string;
};

// The Hub owns the links (parente, 10/11/2026): only the scheme is checked, so that a link it moves
// never makes a button disappear here. https, plus the schemes of the clients' own install links;
// javascript:, data: or http: never become clickable.
const ALLOWED_SCHEMES = ['https:', 'cursor:', 'vscode:'];
const CLE_PATTERN = /^[a-z0-9-]{1,40}$/;

export type AssistantRejete = { cle: string; origine: string };

const originOf = (link: string): string => {
  try {
    const url = new URL(link);

    return url.protocol === 'https:' ? url.origin : url.protocol;
  } catch {
    return 'invalide';
  }
};

const MAX_LENGTH = 4000;

const isString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_LENGTH;

const parseAssistant = (
  raw: unknown,
): { assistant: AssistantInstallation } | { rejete: AssistantRejete } => {
  const { cle, libelle, installation, etape } = (
    typeof raw === 'object' && raw !== null ? raw : {}
  ) as Record<string, unknown>;
  const cleLue = typeof cle === 'string' ? cle.slice(0, 40) : 'absente';
  const origine = isString(installation) ? originOf(installation) : 'absente';
  const scheme = origine.startsWith('https://') ? 'https:' : origine;

  if (
    !CLE_PATTERN.test(cleLue) ||
    !isString(libelle) ||
    !ALLOWED_SCHEMES.includes(scheme)
  ) {
    return { rejete: { cle: cleLue, origine } };
  }

  return {
    assistant: {
      cle: cleLue,
      libelle,
      installation: installation as string,
      etape: isString(etape) ? etape : null,
    },
  };
};

export const parseLiensInstallation = (
  raw: unknown,
  onRejete: (rejete: AssistantRejete) => void = () => undefined,
): LiensInstallation | null => {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const body = raw as Record<string, unknown>;

  if (
    !isString(body.url) ||
    originOf(body.url) === 'invalide' ||
    !body.url.startsWith('https://')
  ) {
    return null;
  }

  const assistants: AssistantInstallation[] = [];

  for (const item of Array.isArray(body.assistants) ? body.assistants : []) {
    const parsed = parseAssistant(item);

    if ('assistant' in parsed) {
      assistants.push(parsed.assistant);
    } else {
      onRejete(parsed.rejete);
    }
  }

  if (assistants.length === 0) {
    return null;
  }

  const app = body.app as Record<string, unknown> | undefined;

  return {
    url: body.url,
    assistants,
    claudeCode: isString(body.claudeCode) ? body.claudeCode : '',
    phrase: isString(app?.phrase) ? app.phrase : '',
  };
};
