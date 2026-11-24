import { isNonEmptyString } from '@sniptt/guards';

import { type HubMcpClaims } from 'src/engine/core-modules/veridian-hub-mcp/utils/verify-hub-mcp-token.util';

export type HubDelegation = { app: string; jti: string; scopes: string[] };

export type DelegationCheck =
  | { kind: 'none' }
  | { kind: 'ok'; delegation: HubDelegation }
  | { kind: 'refused'; status: 401 | 403; error: string; message: string };

const MAX_LIFETIME_S = 120;

// The pairs and scopes this app accepts (INTEGRATIONS-NATIVES D2, D4): the target keeps the last word.
// Create and complete only: no destructive tool ever enters this list.
const DELEGATED_TOOLS: Record<string, { app: string; scopes: string[] }> = {
  app_envoyer_au_crm: {
    app: 'app:prospection',
    scopes: ['crm:societe.ecrire', 'crm:tache.ecrire'],
  },
};

const refused = (
  status: 401 | 403,
  error: string,
  message: string,
): DelegationCheck => ({ kind: 'refused', status, error, message });

// A token carrying `act` is never a full token: anything unreadable is refused, not ignored.
export const readDelegation = (claims: HubMcpClaims): DelegationCheck => {
  if (!('act' in claims)) {
    return { kind: 'none' };
  }

  const act = claims.act as Record<string, unknown> | null;

  if (
    typeof act !== 'object' ||
    act === null ||
    Object.keys(act).join() !== 'sub' ||
    typeof act.sub !== 'string' ||
    !/^app:[a-z0-9-]{1,40}$/.test(act.sub)
  ) {
    return refused(401, 'invalid_act', 'Unreadable act claim.');
  }

  if (!isNonEmptyString(claims.jti) || typeof claims.iat !== 'number') {
    return refused(401, 'invalid_act', 'An action token needs jti and iat.');
  }

  if (claims.exp - claims.iat > MAX_LIFETIME_S) {
    return refused(401, 'invalid_act', 'An action token lives 120 s at most.');
  }

  if (!isNonEmptyString(claims.tenant_id)) {
    return refused(
      403,
      'tenant_required',
      'An action token must name its Hub space.',
    );
  }

  return {
    kind: 'ok',
    delegation: {
      app: act.sub,
      jti: claims.jti,
      scopes: (claims.scope ?? '').split(' ').filter(isNonEmptyString),
    },
  };
};

type JsonRpcBody = {
  method?: unknown;
  params?: { name?: unknown; arguments?: unknown };
};

export const isDelegatedCallAllowed = (
  delegation: HubDelegation,
  body: JsonRpcBody | undefined,
): boolean => {
  const name = body?.params?.name;

  if (
    body?.method !== 'tools/call' ||
    typeof name !== 'string' ||
    !Object.prototype.hasOwnProperty.call(DELEGATED_TOOLS, name)
  ) {
    return false;
  }

  const rule = DELEGATED_TOOLS[name];

  return (
    rule.app === delegation.app &&
    rule.scopes.every((scope) => delegation.scopes.includes(scope))
  );
};

export const ATTESTATION_KEY = '_veridian';

// The origin shown on a record is ours to write: whatever a caller sends under this key is dropped first.
export const stripAttestation = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(stripAttestation);

    return;
  }

  if (typeof value !== 'object' || value === null) {
    return;
  }

  const record = value as Record<string, unknown>;

  delete record[ATTESTATION_KEY];
  Object.values(record).forEach(stripAttestation);
};
