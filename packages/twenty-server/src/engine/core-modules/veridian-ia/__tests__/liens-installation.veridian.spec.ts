import { LiensInstallationService } from 'src/engine/core-modules/veridian-ia/services/liens-installation.service';
import { parseLiensInstallation } from 'src/engine/core-modules/veridian-ia/utils/parse-liens-installation.util';

const HUB_LIENS = {
  url: 'https://app.veridian.site/api/mcp',
  claude:
    'https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Veridian&connectorUrl=https%3A%2F%2Fapp.veridian.site%2Fapi%2Fmcp',
  chatgpt: 'https://chatgpt.com/#settings/Connectors',
  cursor:
    'cursor://anysphere.cursor-deeplink/mcp/install?name=veridian&config=e30%3D',
  vscode: 'https://vscode.dev/redirect?url=vscode%3Amcp%2Finstall',
  claudeCode:
    'claude mcp add --transport http veridian https://app.veridian.site/api/mcp',
  instructions: { chatgpt: 'Collez l’adresse Veridian.' },
};

describe('parseLiensInstallation', () => {
  it('keeps the links the Hub publishes', () => {
    expect(parseLiensInstallation(HUB_LIENS)).toMatchObject({
      claude: HUB_LIENS.claude,
      instructionsChatgpt: 'Collez l’adresse Veridian.',
    });
  });

  it('refuses a link that points anywhere else, javascript: included', () => {
    expect(
      parseLiensInstallation({ ...HUB_LIENS, claude: 'javascript:alert(1)' }),
    ).toBeNull();
    expect(
      parseLiensInstallation({
        ...HUB_LIENS,
        cursor: 'https://evil.example/cursor',
      }),
    ).toBeNull();
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
      claude: HUB_LIENS.claude,
    });
    await service.get();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.veridian.site/api/mcp/liens-installation',
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
