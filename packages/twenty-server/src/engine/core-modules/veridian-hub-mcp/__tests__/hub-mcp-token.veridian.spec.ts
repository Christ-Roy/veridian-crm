import { generateKeyPairSync, type KeyObject } from 'crypto';

import * as jwt from 'jsonwebtoken';

import {
  type HubJwk,
  isHubMcpToken,
  verifyHubMcpToken,
} from 'src/engine/core-modules/veridian-hub-mcp/utils/verify-hub-mcp-token.util';

const ISSUER = 'https://app.veridian.site';
const AUDIENCE = 'https://crm.app.veridian.site/mcp';
const HUB_USER_ID = '0b9f3c1e-7d2a-4c55-9f1e-2a6b8c4d5e6f';

const newKeyPair = () => generateKeyPairSync('ec', { namedCurve: 'P-256' });
const hubKeys = newKeyPair();
const publicJwk = (publicKey: KeyObject, kid: string): HubJwk => ({
  ...publicKey.export({ format: 'jwk' }),
  kid,
});
const KEYS = [publicJwk(hubKeys.publicKey, 'hub-1')];

const sign = (
  overrides: {
    iss?: string;
    aud?: string;
    expiresIn?: number;
    sub?: string;
  } = {},
  privateKey: KeyObject = hubKeys.privateKey,
  kid = 'hub-1',
) =>
  jwt.sign(
    {
      email: 'agent@veridian.site',
      email_verified: true,
      scope: 'mcp',
      client_id: 'claude',
    },
    privateKey,
    {
      algorithm: 'ES256',
      keyid: kid,
      issuer: overrides.iss ?? ISSUER,
      audience: overrides.aud ?? AUDIENCE,
      subject: overrides.sub ?? HUB_USER_ID,
      expiresIn: overrides.expiresIn ?? 300,
      jwtid: 'jti-1',
    },
  );

const verify = (token: string, keys = KEYS) =>
  verifyHubMcpToken({ token, keys, issuer: ISSUER, audience: AUDIENCE });

describe('Hub MCP token (CONTRAT-MCP §côté app)', () => {
  it('accepts a token signed by the Hub key, sub = hub_user_id', () => {
    const check = verify(sign());

    expect(check).toMatchObject({ ok: true, claims: { sub: HUB_USER_ID } });
  });

  it('refuses another audience: a token for another app is not ours', () => {
    expect(
      verify(sign({ aud: 'https://analytics.app.veridian.site/mcp' })).ok,
    ).toBe(false);
  });

  it('refuses another issuer', () => {
    expect(verify(sign({ iss: 'https://evil.example' })).ok).toBe(false);
  });

  it('refuses an expired token', () => {
    expect(verify(sign({ expiresIn: -120 })).ok).toBe(false);
  });

  it('refuses a token signed by another key under the Hub kid', () => {
    expect(verify(sign({}, newKeyPair().privateKey)).ok).toBe(false);
  });

  it('reports an unknown kid so the JWKS can be re-read', () => {
    expect(verify(sign({}, hubKeys.privateKey, 'hub-2'))).toMatchObject({
      ok: false,
      unknownKid: true,
    });
  });

  it('refuses an HS256 token even with the Hub issuer', () => {
    const forged = jwt.sign({ sub: HUB_USER_ID }, 'secret', {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: AUDIENCE,
      keyid: 'hub-1',
    });

    expect(isHubMcpToken(forged, ISSUER)).toBe(false);
    expect(verify(forged).ok).toBe(false);
  });

  it('leaves Twenty tokens (no Hub issuer) to the native guard', () => {
    const twentyToken = jwt.sign(
      { sub: 'user', type: 'ACCESS' },
      newKeyPair().privateKey,
      { algorithm: 'ES256' },
    );

    expect(isHubMcpToken(twentyToken, ISSUER)).toBe(false);
    expect(isHubMcpToken(sign(), ISSUER)).toBe(true);
    expect(isHubMcpToken('not-a-jwt', ISSUER)).toBe(false);
  });
});
