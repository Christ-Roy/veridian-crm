import { TWENTY_COMPANIES_BASE_URL, TWENTY_ICONS_BASE_URL } from 'twenty-shared/constants';
import { getLogoUrlFromDomainName } from 'twenty-shared/utils';

import { computeMyFirstDashboardWidgets } from 'src/engine/workspace-manager/twenty-standard-application/utils/page-layout-widget/compute-my-first-dashboard-widgets.util';

// Patch-survival Veridian : un sync amont qui rétablit l'un de ces canaux doit casser ici.
describe('canaux sortants coupés par patch', () => {
  it('twenty-icons.com ne reçoit aucun domaine', () => {
    expect(TWENTY_ICONS_BASE_URL).toBe('');
    expect(getLogoUrlFromDomainName('client.fr')).toBeUndefined();
  });

  it('twenty-companies.com ne reçoit aucun domaine', () => {
    expect(TWENTY_COMPANIES_BASE_URL).toBe('');
  });

  it('le tableau de bord initial ne contient aucun iframe tiers', () => {
    expect(computeMyFirstDashboardWidgets.toString()).not.toContain(
      'createStockMarketIframe',
    );
  });
});
