import { createHash, createHmac, timingSafeEqual } from 'crypto';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type HubSignatureRoute = {
  method: string;
  // As received on the wire: encoded path, then the raw query after "?", if any.
  originalUrl: string;
};

// CONTRAT-HUB §6.1. v1 (no X-Veridian-Sig-Version): hex(hmac_sha256(secret, "{ts}.{raw_body}")), which binds neither the
// method nor the route (Veridian, 26/11/2026). v2 (X-Veridian-Sig-Version: 2), same as the Hub's `lib/hmac/signature-hub.ts`
// and Notifuse's `veridianHubMACv2`: hex(hmac_sha256(secret, "{ts}\n{METHOD}\n{path}\n{raw query}\n{hex(sha256(body))}")).
// Timestamp in unix milliseconds, 5 minute window either way.
const signedString = (
  version: 'v1' | 'v2',
  timestamp: string,
  rawBody: Buffer,
  route?: HubSignatureRoute,
): Buffer => {
  if (version === 'v1') {
    return Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]);
  }

  const [path, ...query] = (route?.originalUrl ?? '').split('?');

  return Buffer.from(
    [
      timestamp,
      (route?.method ?? '').toUpperCase(),
      path,
      query.join('?'),
      createHash('sha256').update(rawBody).digest('hex'),
    ].join('\n'),
  );
};

export const isHubSignatureValid = ({
  rawBody,
  timestamp,
  signature,
  secrets,
  version = 'v1',
  route,
  now = Date.now(),
}: {
  rawBody: Buffer | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  secrets: string[];
  version?: 'v1' | 'v2';
  route?: HubSignatureRoute;
  now?: number;
}): boolean => {
  if (!rawBody || !timestamp || !signature || !/^\d+$/.test(timestamp)) {
    return false;
  }

  if (version === 'v2' && (!route?.method || !route.originalUrl)) {
    return false;
  }

  if (Math.abs(now - Number(timestamp)) > MAX_CLOCK_SKEW_MS) {
    return false;
  }

  const received = Buffer.from(signature, 'utf8');
  const payload = signedString(version, timestamp, rawBody, route);

  return secrets.some((secret) => {
    const expected = Buffer.from(
      createHmac('sha256', secret).update(payload).digest('hex'),
      'utf8',
    );

    return (
      expected.length === received.length &&
      timingSafeEqual(expected, received)
    );
  });
};
