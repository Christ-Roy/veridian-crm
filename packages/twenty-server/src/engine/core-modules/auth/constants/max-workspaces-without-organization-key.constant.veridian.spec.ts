import { MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY } from 'src/engine/core-modules/auth/constants/max-workspaces-without-organization-key.constant';

// Patch-survival Veridian : un sync amont qui remet la limite à 5 doit casser ici.
describe('MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY', () => {
  it('stays unlimited', () => {
    expect(MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY).toBe(Number.MAX_SAFE_INTEGER);
  });
});
