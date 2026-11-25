import { isUuid } from 'src/engine/core-modules/veridian-hub-sso/utils/parse-hub-organisations.util';

const GRANTS_MAX = 50;
const GRANT_LENGTH_MIN = 20;
const GRANT_LENGTH_MAX = 4096;

export type HubGrant = {
  hubTenantId: string;
  grant: string;
  expiresAt: string;
};

// Absent, malformed or expired: the sign-in goes on, without a grant.
export const parseHubGrants = (
  delegations: unknown,
  now = Date.now(),
): HubGrant[] =>
  Array.isArray(delegations)
    ? delegations
        .slice(0, GRANTS_MAX)
        .filter(
          (delegation) =>
            isUuid(delegation?.hub_tenant_id) &&
            typeof delegation?.grant === 'string' &&
            delegation.grant.length >= GRANT_LENGTH_MIN &&
            delegation.grant.length <= GRANT_LENGTH_MAX &&
            new Date(delegation?.expire_le).getTime() > now,
        )
        .map(({ hub_tenant_id: hubTenantId, grant, expire_le: expireLe }) => ({
          hubTenantId: hubTenantId.toLowerCase(),
          grant,
          expiresAt: new Date(expireLe).toISOString(),
        }))
    : [];
