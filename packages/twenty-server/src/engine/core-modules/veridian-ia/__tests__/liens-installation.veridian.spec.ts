import { LiensInstallationService } from 'src/engine/core-modules/veridian-ia/services/liens-installation.service';
import { parseLiensInstallation } from 'src/engine/core-modules/veridian-ia/utils/parse-liens-installation.util';

const CLAUDE =
  'https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Veridian&connectorUrl=https%3A%2F%2Fapp.veridian.site%2Fapi%2Fmcp';

// Shape served by the Hub in prod on 10/11/2026 (?app=twenty), trimmed.
const HUB_LIENS = {
  url: 'https://app.veridian.site/api/mcp',
  claudeCode:
    'claude mcp add --transport http veridian https://app.veridian.site/api/mcp',
  assistants: [
    {
      cle: 'claude',
      libelle: 'Ajouter à Claude',
      installation: CLAUDE,
      etape: null,
    },
    {
      cle: 'chatgpt',
      libelle: 'Ouvrir ChatGPT',
      installation: 'https://chatgpt.com/#settings/Connectors',
      etape: 'Ajoutez un serveur MCP et collez l’adresse Veridian.',
    },
    {
      cle: 'cursor',
      libelle: 'Ajouter à Cursor',
      installation:
        'cursor://anysphere.cursor-deeplink/mcp/install?name=veridian&config=e30%3D',
      etape: null,
    },
    {
      cle: 'vscode',
      libelle: 'Ajouter à VS Code',
      installation: 'https://vscode.dev/redirect?url=vscode%3Amcp%2Finstall',
      etape: null,
    },
  ],
  app: {
    cle: 'twenty',
    nom: 'CRM',
    phrase: 'Une seule connexion Veridian : votre IA accède à CRM.',
  },
};

const withAssistant = (index: number, patch: object) => ({
  ...HUB_LIENS,
  assistants: HUB_LIENS.assistants.map((assistant, i) =>
    i === index ? { ...assistant, ...patch } : assistant,
  ),
});

describe('parseLiensInstallation', () => {
  it('keeps the assistants, labels, steps and app sentence the Hub publishes', () => {
    const liens = parseLiensInstallation(HUB_LIENS);

    expect(liens?.assistants.map((assistant) => assistant.cle)).toEqual([
      'claude',
      'chatgpt',
      'cursor',
      'vscode',
    ]);
    expect(liens?.assistants[0]).toEqual({
      cle: 'claude',
      libelle: 'Ajouter à Claude',
      installation: CLAUDE,
      etape: null,
    });
    expect(liens?.assistants[1].etape).toContain('serveur MCP');
    expect(liens?.phrase).toContain('CRM');
  });

  it('trusts the Hub on hosts and paths: a moved link keeps its button', () => {
    const liens = parseLiensInstallation(
      withAssistant(1, { installation: 'https://chat.openai.com/plugins' }),
    );

    expect(liens?.assistants[1].installation).toBe(
      'https://chat.openai.com/plugins',
    );
  });

  it('shows an assistant the Hub adds tomorrow', () => {
    const liens = parseLiensInstallation({
      ...HUB_LIENS,
      assistants: [
        ...HUB_LIENS.assistants,
        {
          cle: 'codex',
          libelle: 'Ajouter à Codex',
          installation: 'https://codex.example/add',
          etape: null,
        },
      ],
    });

    expect(liens?.assistants.map((assistant) => assistant.cle)).toContain(
      'codex',
    );
  });

  it('drops only links a browser must not open, and reports key and origin', () => {
    const rejetes: object[] = [];
    const liens = parseLiensInstallation(
      {
        ...HUB_LIENS,
        assistants: [
          ...HUB_LIENS.assistants,
          { cle: 'a', libelle: 'x', installation: 'javascript:alert(1)' },
          { cle: 'b', libelle: 'x', installation: 'data:text/html,hi' },
          { cle: 'c', libelle: 'x', installation: 'http://claude.ai/x?u=1' },
        ],
      },
      (rejete) => rejetes.push(rejete),
    );

    expect(liens?.assistants).toHaveLength(4);
    expect(rejetes).toEqual([
      { cle: 'a', origine: 'javascript:' },
      { cle: 'b', origine: 'data:' },
      { cle: 'c', origine: 'http:' },
    ]);
  });

  it('refuses a body without a valid address or assistant', () => {
    expect(
      parseLiensInstallation({ ...HUB_LIENS, url: 'http://x' }),
    ).toBeNull();
    expect(parseLiensInstallation({ ...HUB_LIENS, assistants: [] })).toBeNull();
    expect(parseLiensInstallation({ url: HUB_LIENS.url })).toBeNull();
    expect(parseLiensInstallation('<html>')).toBeNull();
  });
});

describe('LiensInstallationService', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    process.env.HUB_URL = 'https://app.veridian.site';
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  afterEach(() => {
    delete process.env.HUB_URL;
  });

  it('serves the Hub links, read once for five minutes', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => HUB_LIENS });
    const service = new LiensInstallationService();

    expect(await service.get()).toMatchObject({
      disponible: true,
      url: HUB_LIENS.url,
    });
    await service.get();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.veridian.site/api/mcp/liens-installation?app=twenty',
      expect.anything(),
    );
  });

  it('answers unavailable, never a dead button, when the Hub does not answer', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    expect(await new LiensInstallationService().get()).toEqual({
      disponible: false,
    });
  });

  it('answers unavailable on a 404 or a page that is not the links', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    expect(await new LiensInstallationService().get()).toEqual({
      disponible: false,
    });

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    expect(await new LiensInstallationService().get()).toEqual({
      disponible: false,
    });
  });

  it('keeps links seen within the hour while the Hub is down', async () => {
    jest.useFakeTimers();
    const service = new LiensInstallationService();

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => HUB_LIENS });
    await service.get();

    jest.setSystemTime(Date.now() + 10 * 60 * 1000);
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await service.get()).toMatchObject({ disponible: true });

    jest.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await service.get()).toEqual({ disponible: false });
    jest.useRealTimers();
  });
});
