/*
 * Veridian CRM — module SSO clean-room (AGPLv3).
 *
 * État stateless du flow OIDC (state CSRF + nonce anti-replay + providerId)
 * sérialisé et signé HMAC-SHA256 pour intégrité, déposé dans un cookie httpOnly.
 * Pas de session serveur : cohérent avec le modèle de Twenty.
 *
 * HMAC standard (crypto natif Node), clé dérivée d'APP_SECRET. Comparaison en
 * temps constant pour éviter les timing attacks.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const OIDC_FLOW_COOKIE = 'veridian_sso_oidc';
export const OIDC_FLOW_TTL_MS = 10 * 60 * 1000; // 10 minutes

export type OidcFlowState = {
  providerId: string;
  state: string;
  nonce: string;
  issuedAt: number;
};

export const generateRandomToken = (): string =>
  randomBytes(32).toString('hex');

const sign = (payloadBase64: string, secret: string): string =>
  createHmac('sha256', secret).update(payloadBase64).digest('hex');

export const serializeOidcFlowState = (
  state: OidcFlowState,
  secret: string,
): string => {
  const payloadBase64 = Buffer.from(JSON.stringify(state)).toString(
    'base64url',
  );

  return `${payloadBase64}.${sign(payloadBase64, secret)}`;
};

export const parseOidcFlowState = (
  cookieValue: string,
  secret: string,
): OidcFlowState | null => {
  const [payloadBase64, signature] = cookieValue.split('.');

  if (!payloadBase64 || !signature) {
    return null;
  }

  const expectedSignature = sign(payloadBase64, secret);

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  let parsed: OidcFlowState;

  try {
    parsed = JSON.parse(
      Buffer.from(payloadBase64, 'base64url').toString('utf8'),
    ) as OidcFlowState;
  } catch {
    return null;
  }

  if (Date.now() - parsed.issuedAt > OIDC_FLOW_TTL_MS) {
    return null;
  }

  return parsed;
};
