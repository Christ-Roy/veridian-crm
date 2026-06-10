import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Veridian patch-survival: the seed dashboard must not embed the third-party
// stock-market iframe (it leaked visitor IP/UA on every load).
// See VERIDIAN-PATCHES.md. Building real DashboardWidgetBuilderArgs is heavy,
// so we assert on the source: no IFRAME widget config and no embed-widget URL
// remain in the seed util. We match the *embed URL*, not a bare domain, so a
// future explanatory comment mentioning the host can't make the test lie.
describe('veridian-patch: no third-party embed iframe in seed dashboard', () => {
  const source = readFileSync(
    join(__dirname, '..', 'compute-my-first-dashboard-widgets.util.ts'),
    'utf-8',
  );

  it('does not embed a tradingview embed-widget URL', () => {
    expect(source).not.toMatch(/tradingview\.com\/embed-widget/);
  });

  it('does not declare an IFRAME widget configuration', () => {
    expect(source).not.toContain('WidgetConfigurationType.IFRAME');
  });
});
