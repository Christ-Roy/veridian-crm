import { createHmac } from 'crypto';

import { isHubSignatureValid } from 'src/engine/core-modules/veridian-hub-sso/utils/is-hub-signature-valid.util';

const SECRET = 'secret-de-test';
const NOW = 1_800_000_000_000;
const rawBody = Buffer.from('{"hub_user_id":"u1","email":"a@b.fr"}');

const sign = (timestamp: string, body: Buffer, secret = SECRET) =>
  createHmac('sha256', secret)
    .update(`${timestamp}.${body.toString()}`)
    .digest('hex');

const check = (overrides: Partial<Parameters<typeof isHubSignatureValid>[0]>) =>
  isHubSignatureValid({
    rawBody,
    timestamp: String(NOW),
    signature: sign(String(NOW), rawBody),
    secrets: [SECRET],
    now: NOW,
    ...overrides,
  });

describe('isHubSignatureValid (CONTRAT-HUB §6.1)', () => {
  it('accepts a correct signature', () => {
    expect(check({})).toBe(true);
  });

  it('accepts the rotation secret', () => {
    expect(check({ secrets: ['ancien', SECRET] })).toBe(true);
  });

  it('rejects a wrong secret', () => {
    expect(check({ secrets: ['autre'] })).toBe(false);
  });

  it('rejects a modified body', () => {
    expect(check({ rawBody: Buffer.from('{"email":"pirate@b.fr"}') })).toBe(
      false,
    );
  });

  it('rejects a timestamp older than 5 minutes, even correctly signed', () => {
    const old = String(NOW - 5 * 60 * 1000 - 1);

    expect(check({ timestamp: old, signature: sign(old, rawBody) })).toBe(false);
  });

  it('rejects a timestamp given in seconds', () => {
    const seconds = String(Math.floor(NOW / 1000));

    expect(
      check({ timestamp: seconds, signature: sign(seconds, rawBody) }),
    ).toBe(false);
  });

  it.each([
    ['rawBody', { rawBody: undefined }],
    ['timestamp', { timestamp: undefined }],
    ['signature', { signature: undefined }],
  ])('rejects a missing %s', (_name, overrides) => {
    expect(check(overrides)).toBe(false);
  });

  it('rejects a signature of another length without throwing', () => {
    expect(check({ signature: 'abc' })).toBe(false);
  });

  it('rejects everything when no secret is configured', () => {
    expect(check({ secrets: [] })).toBe(false);
  });
});
