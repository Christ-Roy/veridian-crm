import { ConfigVariables } from 'src/engine/core-modules/twenty-config/config-variables';

// Veridian patch-survival: the outbound-privacy flags must default to OFF
// (fail-safe). An upstream sync that re-declares the class or a careless edit
// that flips a default would silently re-open a leak.
// See VERIDIAN-PATCHES.md and docs/spec/AUDIT-OUTBOUND-LEAKS.md.
describe('veridian-patch: outbound privacy flags default to false', () => {
  const config = new ConfigVariables();

  it.each([
    'COMPANIES_ENRICHMENT_ENABLED',
    'HELP_CENTER_SEARCH_ENABLED',
    'MARKETPLACE_REGISTRY_SYNC_ENABLED',
    'AI_MODELS_CATALOG_FETCH_ENABLED',
  ] as const)('%s is false by default', (flag) => {
    expect(config[flag]).toBe(false);
  });
});
