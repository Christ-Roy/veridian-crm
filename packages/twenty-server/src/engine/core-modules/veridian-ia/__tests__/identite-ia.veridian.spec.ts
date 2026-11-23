import { createHmac } from 'crypto';

import { generateText } from 'ai';

import {
  EN_TETE_CONTEXTE_IA,
  EN_TETE_IDENTITE_IA,
  signerIdentiteIa,
  verifierIdentiteIa,
} from 'src/engine/core-modules/veridian-ia/utils/identite-ia.util';
import { enregistrerResolutionHubUserId } from 'src/engine/core-modules/veridian-ia/utils/identite-ia.middleware';
import { SdkProviderFactoryService } from 'src/engine/metadata-modules/ai/ai-models/services/sdk-provider-factory.service';
import { buildAiTelemetry } from 'src/engine/metadata-modules/ai/ai-models/utils/build-ai-telemetry.util';

// Patch-survival Veridian (VER-203) : chaque appel au modèle vers le fournisseur Veridian porte une identité signée.
const SECRET = 'secret-de-test-identite-ia-32-octets-au-moins';
const WS = '38627be0-428f-4924-aa67-4a35884ba7b4';
const AUTRE_WS = 'c6005824-6d1a-4c72-b5e6-b94ee950477a';

describe('assertion d’identité IA : vérificateur de référence', () => {
  const jeton = (maintenantMs = Date.now()) => signerIdentiteIa(SECRET, { workspaceId: WS, hubUserId: 'hub-robert', fil: 'fil-1' }, maintenantMs);

  it('accepte une assertion valide pour son espace', () => {
    const v = verifierIdentiteIa(jeton(), SECRET, { workspaceId: WS });

    expect(v.ok && v.claims).toMatchObject({ workspace_id: WS, hub_user_id: 'hub-robert', fil: 'fil-1' });
  });

  it('refuse sans en-tête', () => {
    expect(verifierIdentiteIa(undefined, SECRET)).toEqual({ ok: false, raison: 'en-tête absent' });
  });

  it('refuse une signature fausse', () => {
    expect(verifierIdentiteIa(jeton(), 'autre-secret-de-test-identite-ia-32-o')).toEqual({ ok: false, raison: 'signature fausse' });
  });

  it('refuse une assertion expirée (61 s)', () => {
    expect(verifierIdentiteIa(jeton(Date.now() - 61_000), SECRET)).toEqual({ ok: false, raison: 'expiré' });
  });

  it('refuse une audience étrangère et un fil hors contrat', () => {
    const forger = (claims: Record<string, unknown>) => {
      const signe = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;

      return `${signe}.${createHmac('sha256', SECRET).update(signe).digest('base64url')}`;
    };
    const iat = Math.floor(Date.now() / 1000);
    const base = { iss: 'veridian-crm', aud: 'https://app.veridian.site/api/ia/v1', workspace_id: WS, hub_user_id: 'h', fil: 'f', iat, exp: iat + 60, jti: 'j' };

    expect(verifierIdentiteIa(forger(base), SECRET).ok).toBe(true);
    expect(verifierIdentiteIa(forger({ ...base, aud: 'veridian-hub-ia' }), SECRET)).toEqual({ ok: false, raison: 'émetteur ou audience refusés' });
    expect(verifierIdentiteIa(forger({ ...base, fil: '../x' }), SECRET)).toEqual({ ok: false, raison: 'fil invalide' });
  });

  it('refuse un workspace qui ne correspond pas', () => {
    expect(verifierIdentiteIa(jeton(), SECRET, { workspaceId: AUTRE_WS })).toEqual({ ok: false, raison: 'workspace qui ne correspond pas' });
  });
});

describe('assertion d’identité IA : câblage réel (generateText, fabrique de fournisseurs, fetch)', () => {
  const env = { ...process.env };
  let requetes: Array<Record<string, string>>;

  beforeEach(() => {
    requetes = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      requetes.push(Object.fromEntries(new Headers(init?.headers as HeadersInit).entries()));

      return new Response(
        JSON.stringify({
          id: 'x',
          object: 'chat.completion',
          created: 0,
          model: 'auto',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    enregistrerResolutionHubUserId(async (userWorkspaceId) => (userWorkspaceId === 'uw-robert' ? 'hub-robert' : null));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    enregistrerResolutionHubUserId(null);
    process.env = { ...env };
  });

  const appeler = async (providerName: string) => {
    const usine = new SdkProviderFactoryService();
    const fournisseur = usine.createProvider(providerName, {
      npm: '@ai-sdk/openai-compatible',
      name: providerName,
      baseUrl: 'https://hub.example/api/ia/v1',
      apiKey: 'cle-instance',
    });

    await generateText({
      model: fournisseur.createModel!('auto'),
      prompt: 'Combien de sociétés ?',
      ...buildAiTelemetry({ functionId: 'test', workspaceId: WS, userWorkspaceId: 'uw-robert', threadId: 'fil-1' }),
    });

    return requetes[0];
  };

  it('fournisseur Veridian : identité signée, vérifiable, contexte interne retiré', async () => {
    process.env.VERIDIAN_IA_IDENTITE_SECRET = SECRET;
    const entetes = await appeler('veridian');
    const v = verifierIdentiteIa(entetes[EN_TETE_IDENTITE_IA], SECRET, { workspaceId: WS });

    expect(v.ok && v.claims).toMatchObject({ workspace_id: WS, hub_user_id: 'hub-robert', fil: 'fil-1' });
    expect(entetes[EN_TETE_CONTEXTE_IA]).toBeUndefined();
  });

  it('autre fournisseur : ni identité ni contexte ne sortent', async () => {
    process.env.VERIDIAN_IA_IDENTITE_SECRET = SECRET;
    const entetes = await appeler('openai-tiers');

    expect(entetes[EN_TETE_IDENTITE_IA]).toBeUndefined();
    expect(entetes[EN_TETE_CONTEXTE_IA]).toBeUndefined();
  });

  it('sans secret : aucune identité (le Hub refuse), le contexte ne sort pas', async () => {
    delete process.env.VERIDIAN_IA_IDENTITE_SECRET;
    const entetes = await appeler('veridian');

    expect(entetes[EN_TETE_IDENTITE_IA]).toBeUndefined();
    expect(entetes[EN_TETE_CONTEXTE_IA]).toBeUndefined();
  });
});
