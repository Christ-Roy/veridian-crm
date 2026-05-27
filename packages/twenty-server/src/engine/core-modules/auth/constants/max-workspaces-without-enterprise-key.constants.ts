// Veridian CRM (AGPL fork): the upstream Twenty cap of 5 workspaces is a
// soft business gate that funnels users toward the Enterprise plan. We
// don't sell the upstream Enterprise plan, so we raise the cap to the
// safe JS integer ceiling, effectively unlimited. The surrounding check
// in sign-in-up.service.ts becomes a no-op but is kept intact so we don't
// touch any @license Enterprise file.
export const MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY = Number.MAX_SAFE_INTEGER;
