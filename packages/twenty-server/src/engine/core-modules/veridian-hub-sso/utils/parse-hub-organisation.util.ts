import { isNonEmptyString } from '@sniptt/guards';

import {
  type HubRole,
  isHubRole,
  isHubRoleVersion,
  isUuid,
} from 'src/engine/core-modules/veridian-hub-sso/utils/parse-hub-organisations.util';

const MEMBERS_MAX = 500;
const NAME_MAX = 120;

export type HubOrganisationMember = {
  hubUserId: string;
  email: string;
  role: HubRole;
  joinedAt: Date;
};

export type HubOrganisation = {
  hubTenantId: string;
  version: number;
  chosenName: string | null;
  logoUrl: string | null;
  members: HubOrganisationMember[];
  refused: number;
};

// The logo is served by our Hub for this organisation, or it is not loaded.
const isHubLogoUrl = (url: string, hubUrl: string, hubTenantId: string) => {
  const prefix = `${hubUrl.replace(/\/+$/, '')}/api/public/org/${hubTenantId}/logo?v=`;

  return (
    url.startsWith(prefix) && /^[\w-]{1,64}$/.test(url.slice(prefix.length))
  );
};

const parseMember = (member: any): HubOrganisationMember | null => {
  const joinedAt = new Date(member?.joined_at ?? NaN);

  return isUuid(member?.hub_user_id) &&
    isNonEmptyString(member.email) &&
    member.email.includes('@') &&
    member.email_proven === true &&
    isHubRole(member.role) &&
    !Number.isNaN(joinedAt.getTime())
    ? {
        hubUserId: member.hub_user_id,
        email: member.email.toLowerCase(),
        role: member.role,
        joinedAt,
      }
    : null;
};

export const parseHubOrganisation = (
  body: any,
  hubUrl: string | undefined,
): HubOrganisation | { error: 'invalid_body' | 'logo_not_from_hub' } => {
  const hubTenantId = body?.hub_tenant_id;
  const version = body?.version;
  const members = body?.membres;

  if (
    !isUuid(hubTenantId) ||
    !isHubRoleVersion(version) ||
    !Array.isArray(members) ||
    members.length > MEMBERS_MAX
  ) {
    return { error: 'invalid_body' };
  }

  const logoUrl = isNonEmptyString(body.marque?.logo_url)
    ? body.marque.logo_url
    : null;

  if (
    logoUrl !== null &&
    (!hubUrl || !isHubLogoUrl(logoUrl, hubUrl, hubTenantId))
  ) {
    return { error: 'logo_not_from_hub' };
  }

  // `nom` is the account name at the Hub: only a name someone chose renames a workspace.
  const name = body.marque?.nom_affiche;
  const chosenName =
    typeof name === 'string' ? name.trim().slice(0, NAME_MAX) : '';

  const parsed = members
    .map(parseMember)
    .filter((member): member is HubOrganisationMember => member !== null);

  return {
    hubTenantId,
    version,
    chosenName: chosenName || null,
    logoUrl,
    members: parsed,
    refused: members.length - parsed.length,
  };
};
