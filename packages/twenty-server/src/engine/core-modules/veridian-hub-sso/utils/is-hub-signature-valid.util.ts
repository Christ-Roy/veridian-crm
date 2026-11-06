import { createHmac, timingSafeEqual } from 'crypto';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

// Pattern A of CONTRAT-HUB §6.1: hex(hmac_sha256(secret, "{timestamp}.{raw_body}")),
// with the timestamp in unix milliseconds and a 5 minute anti-replay window.
export const isHubSignatureValid = ({
  rawBody,
  timestamp,
  signature,
  secrets,
  now = Date.now(),
}: {
  rawBody: Buffer | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  secrets: string[];
  now?: number;
}): boolean => {
  if (!rawBody || !timestamp || !signature || !/^\d+$/.test(timestamp)) {
    return false;
  }

  if (Math.abs(now - Number(timestamp)) > MAX_CLOCK_SKEW_MS) {
    return false;
  }

  const received = Buffer.from(signature, 'utf8');

  return secrets.some((secret) => {
    const expected = Buffer.from(
      createHmac('sha256', secret)
        .update(`${timestamp}.`)
        .update(rawBody)
        .digest('hex'),
      'utf8',
    );

    return (
      expected.length === received.length &&
      timingSafeEqual(expected, received)
    );
  });
};
