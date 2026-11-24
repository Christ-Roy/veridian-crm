export const HUB_ROLE_KEY = 'veridian.hub_role';

export const HUB_ROLES = ['owner', 'admin', 'member'] as const;

export type HubRole = (typeof HUB_ROLES)[number];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORGANISATIONS_MAX = 50;

export const isHubRole = (role: unknown): role is HubRole =>
  HUB_ROLES.includes(role as HubRole);

export const isHubRoleVersion = (version: unknown): version is number =>
  Number.isSafeInteger(version) && (version as number) > 0;

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

// Absent, malformed or unknown: nothing changes, never a removal.
export const parseHubOrganisations = (
  organisations: unknown,
): { hubTenantId: string; role: HubRole; version: number }[] =>
  Array.isArray(organisations)
    ? organisations
        .slice(0, ORGANISATIONS_MAX)
        .filter(
          (organisation) =>
            isUuid(organisation?.hub_tenant_id) &&
            isHubRole(organisation?.role) &&
            isHubRoleVersion(organisation?.version),
        )
        .map(({ hub_tenant_id: hubTenantId, role, version }) => ({
          hubTenantId,
          role,
          version,
        }))
    : [];
