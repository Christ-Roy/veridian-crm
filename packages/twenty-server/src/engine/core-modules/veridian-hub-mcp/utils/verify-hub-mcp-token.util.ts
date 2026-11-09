import { createPublicKey, type JsonWebKey } from 'crypto';

import * as jwt from 'jsonwebtoken';

// CONTRAT-MCP (Hub, 09/11/2026): the Hub calls our /mcp with an ES256 JWT, sub = hub_user_id.
export type HubMcpClaims = {
  sub: string;
  email?: string;
  scope?: string;
  client_id?: string;
  tenant_id?: string;
  jti?: string;
  exp: number;
};

export type HubJwk = JsonWebKey & { kid?: string };

export type HubMcpTokenCheck =
  | { ok: true; claims: HubMcpClaims }
  | { ok: false; reason: string; unknownKid?: boolean };

const CLOCK_TOLERANCE_S = 30;

// Twenty signs its own tokens with HS256: only an ES256 token issued by the Hub is ours to handle.
export const isHubMcpToken = (token: string, issuer: string): boolean => {
  const decoded = jwt.decode(token, { complete: true });

  return (
    decoded !== null &&
    typeof decoded.payload === 'object' &&
    decoded.header.alg === 'ES256' &&
    decoded.payload.iss === issuer
  );
};

export const verifyHubMcpToken = ({
  token,
  keys,
  issuer,
  audience,
}: {
  token: string;
  keys: HubJwk[];
  issuer: string;
  audience: string;
}): HubMcpTokenCheck => {
  const decoded = jwt.decode(token, { complete: true });

  if (decoded === null || decoded.header.alg !== 'ES256') {
    return { ok: false, reason: 'not_an_es256_token' };
  }

  const jwk = keys.find(
    (key) => key.kid === decoded.header.kid && key.kty === 'EC',
  );

  if (!jwk) {
    return { ok: false, reason: 'unknown_kid', unknownKid: true };
  }

  try {
    const payload = jwt.verify(
      token,
      createPublicKey({ key: jwk, format: 'jwk' }),
      {
        algorithms: ['ES256'],
        issuer,
        audience,
        clockTolerance: CLOCK_TOLERANCE_S,
      },
    );

    if (
      typeof payload !== 'object' ||
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      typeof payload.exp !== 'number'
    ) {
      return { ok: false, reason: 'missing_claims' };
    }

    return { ok: true, claims: payload as HubMcpClaims };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'invalid_token',
    };
  }
};
