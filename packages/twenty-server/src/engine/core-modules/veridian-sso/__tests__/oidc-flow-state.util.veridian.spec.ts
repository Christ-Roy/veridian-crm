/*
 * Veridian CRM — module SSO clean-room (AGPLv3).
 * Copyright (c) 2026-present Veridian.
 *
 * Tests de l'état OIDC signé HMAC : round-trip, détection de falsification,
 * expiration, mauvais secret.
 */
import {
  OIDC_FLOW_TTL_MS,
  parseOidcFlowState,
  serializeOidcFlowState,
  type OidcFlowState,
} from 'src/engine/core-modules/veridian-sso/utils/oidc-flow-state.util';

const SECRET = 'app-secret-test';

const buildState = (overrides: Partial<OidcFlowState> = {}): OidcFlowState => ({
  providerId: 'p1',
  state: 'state-123',
  nonce: 'nonce-456',
  issuedAt: Date.now(),
  ...overrides,
});

describe('oidc-flow-state util (clean-room)', () => {
  it('round-trips a valid signed state', () => {
    const state = buildState();
    const cookie = serializeOidcFlowState(state, SECRET);

    const parsed = parseOidcFlowState(cookie, SECRET);

    expect(parsed).toEqual(state);
  });

  it('rejects a tampered payload (HMAC mismatch)', () => {
    const cookie = serializeOidcFlowState(buildState(), SECRET);
    const [, signature] = cookie.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify(buildState({ providerId: 'attacker' })),
    ).toString('base64url');

    expect(
      parseOidcFlowState(`${forgedPayload}.${signature}`, SECRET),
    ).toBeNull();
  });

  it('rejects a state signed with a different secret', () => {
    const cookie = serializeOidcFlowState(buildState(), SECRET);

    expect(parseOidcFlowState(cookie, 'other-secret')).toBeNull();
  });

  it('rejects an expired state', () => {
    const cookie = serializeOidcFlowState(
      buildState({ issuedAt: Date.now() - OIDC_FLOW_TTL_MS - 1000 }),
      SECRET,
    );

    expect(parseOidcFlowState(cookie, SECRET)).toBeNull();
  });

  it('rejects a malformed cookie', () => {
    expect(parseOidcFlowState('garbage', SECRET)).toBeNull();
    expect(parseOidcFlowState('', SECRET)).toBeNull();
  });
});
