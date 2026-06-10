import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';
import {
  filterOutVeridianBridgeNoise,
  isVeridianBridgeScoreNoise,
} from '@/veridian-tunnel-timeline/utils/filterVeridianBridgeNoise';

// Veridian tunnel — le bridge PATCH le score → person.updated{score} en boucle.
// On masque CE bruit (API key, diff score seul) sans jamais masquer une update
// humaine ni une update API multi-champs.

const activity = (over: Partial<TimelineActivity>): TimelineActivity =>
  ({
    id: 'a',
    name: 'person.updated',
    workspaceMemberId: null,
    properties: { diff: { score: { before: 1, after: 2 } } },
    ...over,
  }) as TimelineActivity;

describe('isVeridianBridgeScoreNoise', () => {
  it('masque person.updated{score} écrit par le bridge (workspaceMemberId null)', () => {
    expect(isVeridianBridgeScoreNoise(activity({}))).toBe(true);
  });

  it('garde une update humaine du score (workspaceMemberId présent)', () => {
    expect(
      isVeridianBridgeScoreNoise(activity({ workspaceMemberId: 'wm-1' })),
    ).toBe(false);
  });

  it('garde une update API multi-champs (diff plus large que score)', () => {
    expect(
      isVeridianBridgeScoreNoise(
        activity({
          properties: {
            diff: {
              score: { before: 1, after: 2 },
              city: { before: 'Lyon', after: 'Paris' },
            },
          },
        }),
      ),
    ).toBe(false);
  });

  it('ne touche jamais les jalons tunnel (score.threshold n est pas un .updated)', () => {
    expect(
      isVeridianBridgeScoreNoise(
        activity({ name: 'score.threshold', properties: {} }),
      ),
    ).toBe(false);
  });

  it('ne touche pas les created/deleted', () => {
    expect(
      isVeridianBridgeScoreNoise(
        activity({ name: 'person.created', properties: {} }),
      ),
    ).toBe(false);
  });
});

describe('filterOutVeridianBridgeNoise', () => {
  it('retire le bruit du bridge et conserve le reste', () => {
    const events = [
      activity({ id: 'noise' }), // bridge score-only → out
      activity({ id: 'human', workspaceMemberId: 'wm-1' }), // human → in
      activity({ id: 'tunnel', name: 'email.sent', properties: {} }), // tunnel → in
    ];
    const kept = filterOutVeridianBridgeNoise(events).map((e) => e.id);
    expect(kept).toEqual(['human', 'tunnel']);
  });
});
