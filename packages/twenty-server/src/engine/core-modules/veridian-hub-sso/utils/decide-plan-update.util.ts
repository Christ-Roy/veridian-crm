// CONTRAT-BILLING v2 §3: the Hub sets the plan, the app stores it and limits nothing (PRICING-VERIDIAN).
export const CANONICAL_PLANS = ['free', 'pro', 'business', 'enterprise'];
export const PLAN_SOURCES = [
  'stripe',
  'stripe_trial',
  'grant_manual',
  'downgrade_auto',
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Enough to answer a Hub retry; older keys cannot come back after a newer change.
const KEPT_IDEMPOTENCY_KEYS = 20;

export type StoredPlan = {
  plan: string;
  planSource?: string;
  planUpdatedAt?: string;
  idempotencyKeys?: string[];
  lastResponse?: object;
};

export type PlanUpdateRequest = {
  contract_version?: unknown;
  tenant_id?: unknown;
  plan?: unknown;
  plan_source?: unknown;
  effective_at?: unknown;
  idempotency_key?: unknown;
};

export type PlanUpdateDecision =
  | { kind: 'reject'; status: number; error: string; details?: object }
  | { kind: 'replay'; response: object }
  | { kind: 'apply'; next: StoredPlan; response: object };

const isString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

export const decidePlanUpdate = (
  body: PlanUpdateRequest,
  current: StoredPlan | null,
  now: Date,
): PlanUpdateDecision => {
  const {
    contract_version: version,
    tenant_id: tenantId,
    plan,
    plan_source: planSource,
    effective_at: effectiveAt,
    idempotency_key: idempotencyKey,
  } = body;

  if (
    !isString(version) ||
    version.split('.')[0] !== '2' ||
    !isString(tenantId) ||
    !isString(effectiveAt) ||
    Number.isNaN(Date.parse(effectiveAt)) ||
    !isString(idempotencyKey) ||
    !UUID_PATTERN.test(idempotencyKey)
  ) {
    return { kind: 'reject', status: 400, error: 'invalid_payload' };
  }

  if (!isString(plan) || !CANONICAL_PLANS.includes(plan)) {
    return {
      kind: 'reject',
      status: 400,
      error: 'invalid_plan',
      details: { allowed_plans: CANONICAL_PLANS },
    };
  }

  if (!isString(planSource) || !PLAN_SOURCES.includes(planSource)) {
    return {
      kind: 'reject',
      status: 400,
      error: 'invalid_payload',
      details: { allowed_plan_sources: PLAN_SOURCES },
    };
  }

  if (!current) {
    return { kind: 'reject', status: 404, error: 'tenant_not_found' };
  }

  const echo = {
    tenant_id: tenantId,
    plan,
    plan_source: planSource,
  };

  if (current.idempotencyKeys?.includes(idempotencyKey)) {
    const isLatest = current.idempotencyKeys[0] === idempotencyKey;

    return {
      kind: 'replay',
      response:
        isLatest && current.lastResponse
          ? current.lastResponse
          : { ...echo, previous_plan: null, applied_at: current.planUpdatedAt },
    };
  }

  // §3.4 invariant 4: an offered plan is never taken back by Stripe or an automatic downgrade.
  if (current.planSource === 'grant_manual' && planSource !== 'grant_manual') {
    return { kind: 'reject', status: 409, error: 'plan_source_immutable' };
  }

  const appliedAt = now.toISOString();
  const response = {
    ...echo,
    previous_plan: current.plan,
    applied_at: appliedAt,
  };

  return {
    kind: 'apply',
    next: {
      plan,
      planSource,
      planUpdatedAt: appliedAt,
      idempotencyKeys: [
        idempotencyKey,
        ...(current.idempotencyKeys ?? []),
      ].slice(0, KEPT_IDEMPOTENCY_KEYS),
      lastResponse: response,
    },
    response,
  };
};
