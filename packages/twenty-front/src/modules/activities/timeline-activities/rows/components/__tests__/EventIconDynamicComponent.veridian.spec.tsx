import { render } from '@testing-library/react';

import { EventIconDynamicComponent } from '@/activities/timeline-activities/rows/components/EventIconDynamicComponent';
import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';

// Veridian PATCH-SURVIVAL (cf VERIDIAN-PATCHES.md) : EventIconDynamicComponent
// doit rendre une icône parlante pour les events tunnel. Sans le patch, ces
// events (linkedObjectMetadataItem=null, action inconnue) tombent sur
// ObjectMetadataIcon → getIcon(undefined) → Icon123 (« 123 »). Si un sync
// upstream écrase le early-check, ce test casse.

// On isole le routing (le rendu réel des icônes natives passe par un provider
// useIcons → contexte). Le composant tunnel est remplacé par un marqueur.
jest.mock(
  '@/veridian-tunnel-timeline/components/EventIconVeridianTunnel',
  () => ({
    EventIconVeridianTunnel: ({ eventName }: { eventName: string }) => (
      <div data-testid="veridian-tunnel-icon">{eventName}</div>
    ),
  }),
);

const event = (name: string): TimelineActivity =>
  ({ id: 'e1', name, properties: {} }) as TimelineActivity;

describe('EventIconDynamicComponent (Veridian tunnel routing)', () => {
  it.each([
    'email.sent',
    'email.opened',
    'audit.scroll',
    'audit.rdv',
    'score.threshold',
  ])('rend une icône tunnel pour %s (jamais Icon123)', (name) => {
    const { getByTestId } = render(
      <EventIconDynamicComponent
        event={event(name)}
        linkedObjectMetadataItem={null}
      />,
    );
    expect(getByTestId('veridian-tunnel-icon')).toHaveTextContent(name);
  });

  it('laisse les actions natives created/updated/deleted/restored au rendu Twenty', () => {
    for (const name of [
      'person.created',
      'person.updated',
      'person.deleted',
      'person.restored',
    ]) {
      const { queryByTestId } = render(
        <EventIconDynamicComponent
          event={event(name)}
          linkedObjectMetadataItem={null}
        />,
      );
      expect(queryByTestId('veridian-tunnel-icon')).not.toBeInTheDocument();
    }
  });
});
