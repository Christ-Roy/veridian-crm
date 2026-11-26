import { getSubdomainSlugFromDisplayName } from 'twenty-shared/utils';

import { isSubdomainValid } from 'src/engine/core-modules/domain/subdomain-manager/utils/is-subdomain-valid.util';

const MAX_LENGTH = 30;
const TEST_PREFIX = 'e2e-';
const MAX_NUMBERED = 50;

const trim = (slug: string) => slug.slice(0, MAX_LENGTH).replace(/-+$/g, '');

// Veridian (26/11/2026): the subdomain follows the workspace name the Hub sends, never the owner's email domain (which
// made every @veridian.site space "veridian-N", next to real ones). A test organisation (name or owner address
// starting with "e2e") always gets the "e2e-" prefix.
export const hubWorkspaceSubdomainBase = (
  workspaceName: string,
  ownerEmail: string,
): string | undefined => {
  const slug = getSubdomainSlugFromDisplayName(workspaceName);
  const isTest =
    /^e2e/i.test(slug ?? '') ||
    /^e2e[-_.]/i.test(ownerEmail.split('@')[0] ?? '');

  if (!isTest) {
    return slug && isSubdomainValid(slug) ? slug : undefined;
  }

  const rest = (slug ?? '').replace(/^e2e-?/i, '');
  const base = trim(`${TEST_PREFIX}${rest || 'espace'}`);

  return isSubdomainValid(base) ? base : undefined;
};

export const hubWorkspaceSubdomainCandidates = (base: string): string[] =>
  [
    base,
    ...Array.from({ length: MAX_NUMBERED - 1 }, (_, i) => {
      const suffix = `-${i + 2}`;

      return `${trim(base.slice(0, MAX_LENGTH - suffix.length))}${suffix}`;
    }),
  ].filter(isSubdomainValid);

export const firstFreeHubWorkspaceSubdomain = (
  candidates: string[],
  taken: Set<string>,
  defaultSubdomain: string,
): string | undefined =>
  candidates.find((candidate) => !taken.has(candidate) && candidate !== defaultSubdomain);
