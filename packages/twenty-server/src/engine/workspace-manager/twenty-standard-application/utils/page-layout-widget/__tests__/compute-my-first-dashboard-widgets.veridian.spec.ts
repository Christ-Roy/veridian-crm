import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Veridian patch-survival: the seed dashboard must not embed the TradingView
// iframe (it leaked visitor IP/UA to tradingview.com on every load).
// See VERIDIAN-PATCHES.md. Building real DashboardWidgetBuilderArgs is heavy,
// so we assert on the source: no IFRAME widget config remains in the seed util.
describe('veridian-patch: no TradingView iframe in seed dashboard', () => {
  const source = readFileSync(
    join(__dirname, '..', 'compute-my-first-dashboard-widgets.util.ts'),
    'utf-8',
  );

  it('does not reference tradingview.com', () => {
    expect(source).not.toContain('tradingview.com');
  });

  it('does not declare an IFRAME widget configuration', () => {
    expect(source).not.toContain('WidgetConfigurationType.IFRAME');
  });
});
