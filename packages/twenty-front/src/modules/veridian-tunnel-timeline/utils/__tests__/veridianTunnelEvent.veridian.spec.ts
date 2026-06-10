import {
  getVeridianTunnelDetails,
  getVeridianTunnelHappensAt,
  getVeridianTunnelPresentation,
  isVeridianTunnelEvent,
} from '@/veridian-tunnel-timeline/utils/veridianTunnelEvent';

// Veridian tunnel — la présentation des events de timeline custom. Si un sync
// upstream casse le rendu ou si quelqu'un renomme un event sans aligner la
// table, ce test casse avant la prod.

describe('isVeridianTunnelEvent', () => {
  it.each([
    'email.sent',
    'email.opened',
    'email.clicked',
    'email.bounced',
    'email.unsubscribed',
    'audit.page_view',
    'audit.scroll',
    'audit.cta_click',
    'audit.rdv',
    'score.threshold',
  ])('reconnaît %s comme event tunnel', (name) => {
    expect(isVeridianTunnelEvent(name)).toBe(true);
  });

  it.each(['person.updated', 'company.created', 'note.created', '', undefined])(
    'rejette %s (event natif Twenty)',
    (name) => {
      expect(isVeridianTunnelEvent(name)).toBe(false);
    },
  );
});

describe('getVeridianTunnelPresentation', () => {
  it('rend un libellé FR commercial et une icône non générique pour chaque event connu', () => {
    const known = [
      'email.sent',
      'email.opened',
      'email.clicked',
      'email.bounced',
      'email.unsubscribed',
      'audit.page_view',
      'audit.scroll',
      'audit.cta_click',
      'audit.rdv',
      'score.threshold',
    ];
    for (const name of known) {
      const { label, icon } = getVeridianTunnelPresentation(name);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(name); // jamais le nom technique brut
      expect(icon).not.toBe('generic');
    }
  });

  it('replie un event tunnel inconnu sur le libellé de son namespace (jamais vide)', () => {
    const { label, icon } = getVeridianTunnelPresentation('email.queued');
    expect(label).toBe('Événement email');
    expect(icon).toBe('send');
  });
});

describe('getVeridianTunnelDetails', () => {
  it('extrait les clés métier discrètes, ignore le payload non-scalaire', () => {
    const details = getVeridianTunnelDetails({
      batchId: 'requalif-2026-06-10',
      messageId: 'msg-123',
      url: 'https://veridian.site/audit/foo-ab12cd34',
      diff: { score: { before: 1, after: 2 } }, // objet → ignoré
      nested: { a: 1 }, // objet → ignoré
    });
    const keys = details.map((d) => d.key);
    expect(keys).toContain('batchId');
    expect(keys).toContain('messageId');
    expect(keys).toContain('url');
    expect(keys).not.toContain('diff');
    expect(keys).not.toContain('nested');
  });

  it('retourne [] pour des properties absentes ou non-objet', () => {
    expect(getVeridianTunnelDetails(null)).toEqual([]);
    expect(getVeridianTunnelDetails(undefined)).toEqual([]);
    expect(getVeridianTunnelDetails('foo')).toEqual([]);
  });
});

describe('getVeridianTunnelHappensAt', () => {
  it('préfère happensAt (heure réelle de l event) à createdAt (heure d écriture)', () => {
    expect(
      getVeridianTunnelHappensAt({
        happensAt: '2026-06-09T10:00:00.000Z',
        createdAt: '2026-06-10T15:00:00.000Z',
      }),
    ).toBe('2026-06-09T10:00:00.000Z');
  });

  it('retombe sur createdAt si happensAt absent ou invalide', () => {
    expect(
      getVeridianTunnelHappensAt({
        happensAt: null,
        createdAt: '2026-06-10T15:00:00.000Z',
      }),
    ).toBe('2026-06-10T15:00:00.000Z');
    expect(
      getVeridianTunnelHappensAt({
        happensAt: 'not-a-date',
        createdAt: '2026-06-10T15:00:00.000Z',
      }),
    ).toBe('2026-06-10T15:00:00.000Z');
  });
});
