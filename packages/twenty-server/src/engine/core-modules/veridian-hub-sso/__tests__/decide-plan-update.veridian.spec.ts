import { decidePlanUpdate } from 'src/engine/core-modules/veridian-hub-sso/utils/decide-plan-update.util';

const now = new Date('2026-11-08T12:00:00.000Z');
const corps = (extra: object = {}) => ({
  contract_version: '2.0',
  tenant_id: '11111111-1111-4111-8111-111111111111',
  plan: 'pro',
  plan_source: 'stripe',
  effective_at: '2026-11-08T12:00:00.000Z',
  idempotency_key: '22222222-2222-4222-8222-222222222222',
  ...extra,
});
const lien = { plan: 'free' };

// CONTRAT-BILLING v2 §3 : un changement de cette logique doit casser ici.
describe('update-plan (CONTRAT-BILLING v2 §3)', () => {
  it('applique le plan et renvoie previous_plan', () => {
    const d = decidePlanUpdate(corps(), lien, now);

    expect(d.kind).toBe('apply');
    if (d.kind !== 'apply') return;
    expect(d.next).toMatchObject({ plan: 'pro', planSource: 'stripe' });
    expect(d.response).toEqual({
      tenant_id: corps().tenant_id,
      plan: 'pro',
      plan_source: 'stripe',
      previous_plan: 'free',
      applied_at: now.toISOString(),
    });
  });

  it.each([
    [{ contract_version: '3.0' }, 'invalid_payload'],
    [{ contract_version: undefined }, 'invalid_payload'],
    [{ idempotency_key: 'pas-un-uuid' }, 'invalid_payload'],
    [{ effective_at: 'demain' }, 'invalid_payload'],
    [{ plan: 'freemium' }, 'invalid_plan'],
    [{ plan_source: 'manual' }, 'invalid_payload'],
  ])('400 sur %o', (extra, error) => {
    expect(decidePlanUpdate(corps(extra), lien, now)).toMatchObject({
      kind: 'reject',
      status: 400,
      error,
    });
  });

  it('accepte un minor plus récent du contrat', () => {
    expect(
      decidePlanUpdate(corps({ contract_version: '2.1' }), lien, now).kind,
    ).toBe('apply');
  });

  it('404 pour un tenant inconnu', () => {
    expect(decidePlanUpdate(corps(), null, now)).toMatchObject({
      status: 404,
      error: 'tenant_not_found',
    });
  });

  it('rejeu de la même clé : aucune écriture, même réponse', () => {
    const premier = decidePlanUpdate(corps(), lien, now);

    if (premier.kind !== 'apply') throw new Error('attendu apply');
    const rejeu = decidePlanUpdate(
      corps(),
      premier.next,
      new Date('2026-11-08T13:00:00.000Z'),
    );

    expect(rejeu).toEqual({ kind: 'replay', response: premier.response });
  });

  it.each(['stripe', 'stripe_trial', 'downgrade_auto'])(
    'un plan offert (grant_manual) ne se fait pas retirer par %s : 409',
    (source) => {
      const offert = { plan: 'business', planSource: 'grant_manual' };

      expect(
        decidePlanUpdate(
          corps({ plan: 'free', plan_source: source }),
          offert,
          now,
        ),
      ).toMatchObject({ status: 409, error: 'plan_source_immutable' });
    },
  );

  it('grant_manual a toujours le dernier mot', () => {
    const offert = { plan: 'business', planSource: 'grant_manual' };

    expect(
      decidePlanUpdate(
        corps({ plan: 'enterprise', plan_source: 'grant_manual' }),
        offert,
        now,
      ).kind,
    ).toBe('apply');
  });

  it("garde un nombre borné de clés d'idempotence", () => {
    const vieux = {
      plan: 'free',
      idempotencyKeys: Array.from(
        { length: 25 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      ),
    };
    const d = decidePlanUpdate(corps(), vieux, now);

    if (d.kind !== 'apply') throw new Error('attendu apply');
    expect(d.next.idempotencyKeys).toHaveLength(20);
    expect(d.next.idempotencyKeys?.[0]).toBe(corps().idempotency_key);
  });
  it('stocke trial_status et trial_ends_at sans rien appliquer', () => {
    const d = decidePlanUpdate(
      corps({
        trial_status: 'trial_active',
        trial_ends_at: '2026-11-23T00:00:00.000Z',
      }),
      lien,
      now,
    );

    if (d.kind !== 'apply') throw new Error('attendu apply');
    expect(d.next).toMatchObject({
      trialStatus: 'trial_active',
      trialEndsAt: '2026-11-23T00:00:00.000Z',
    });
  });

  it("sans champs d'essai : ce qui était stocké reste", () => {
    const d = decidePlanUpdate(
      corps(),
      { plan: 'free', trialStatus: 'expired' },
      now,
    );

    if (d.kind !== 'apply') throw new Error('attendu apply');
    expect(d.next).not.toHaveProperty('trialStatus');
  });

  it.each([{ trial_status: 'essai' }, { trial_ends_at: 'bientot' }])(
    '400 sur %o',
    (extra) => {
      expect(decidePlanUpdate(corps(extra), lien, now)).toMatchObject({
        status: 400,
        error: 'invalid_payload',
      });
    },
  );
});
