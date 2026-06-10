import { render } from '@testing-library/react';

import { EventRowDynamicComponent } from '@/activities/timeline-activities/rows/components/EventRowDynamicComponent';
import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';

// Veridian PATCH-SURVIVAL (cf VERIDIAN-PATCHES.md) : EventRowDynamicComponent
// doit router les events tunnel (email.*/audit.*/score.*) vers le rendu
// custom AVANT le switch natif. Sans le patch, ces events tombent dans
// `default` → EventRowMainObject → return null (ligne vide). Si un sync
// upstream écrase le early-check, ce test casse.

// On isole le routing : le rendu tunnel réel dépend d'atoms jotai (locale).
// Ici on remplace le composant tunnel par un marqueur observable.
jest.mock(
  '@/veridian-tunnel-timeline/components/EventRowVeridianTunnel',
  () => ({
    EventRowVeridianTunnel: () => (
      <div data-testid="veridian-tunnel-row">tunnel</div>
    ),
  }),
);

const tunnelEvent = (name: string): TimelineActivity =>
  ({
    id: 'e1',
    name,
    properties: {},
    linkedObjectMetadataId: null,
    workspaceMemberId: null,
    createdAt: '2026-06-10T10:00:00.000Z',
  }) as TimelineActivity;

const baseProps = {
  labelIdentifierValue: 'Jean Dupont',
  mainObjectMetadataItem: {} as never,
  linkedObjectMetadataItem: null,
  authorFullName: 'System',
  createdAt: 'just now',
};

describe('EventRowDynamicComponent (Veridian tunnel routing)', () => {
  it.each(['email.sent', 'audit.page_view', 'score.threshold'])(
    'route %s vers le rendu tunnel (pas la ligne vide native)',
    (name) => {
      const { getByTestId } = render(
        <EventRowDynamicComponent {...baseProps} event={tunnelEvent(name)} />,
      );
      expect(getByTestId('veridian-tunnel-row')).toBeInTheDocument();
    },
  );

  it('ne capture PAS les events natifs (person.updated ne passe pas par le tunnel)', () => {
    const { queryByTestId } = render(
      <EventRowDynamicComponent
        {...baseProps}
        event={tunnelEvent('person.updated')}
      />,
    );
    expect(queryByTestId('veridian-tunnel-row')).not.toBeInTheDocument();
  });
});
