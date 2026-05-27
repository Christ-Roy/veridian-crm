# 03 — Intégration Hub Veridian (auth + billing + provisioning)

> Remplacer l'auth/billing natifs de Twenty par notre Hub HMAC.

## Auth — pattern Magic Link Hub → CRM

Pattern actuel Veridian (utilisé par Prospection + Notifuse) :
1. User va sur `crm.app.veridian.site/login`
2. Bouton "Se connecter avec Veridian" → redirect `hub.veridian.site/cross-app-login?app=crm&return=https://crm.app.veridian.site/auth/callback`
3. Hub vérifie sa session (cookie SSO) + signe un magic-link HMAC
4. Redirect `crm.app.veridian.site/auth/callback?token=<hmac>&user_id=<hub-user-id>`
5. CRM valide le HMAC contre `HUB_API_SECRET` partagé, crée/update `core.users` + session
6. User dans le CRM, cookie session local

### Fichiers Twenty à modifier

- `apps/twenty-server/src/engine/core-modules/auth/auth.module.ts` — désactiver Google/MS native, garder juste "Veridian login"
- `apps/twenty-server/src/engine/core-modules/auth/strategies/veridian-hub.strategy.ts` — nouveau (HMAC verify + upsert user)
- `apps/twenty-server/src/engine/core-modules/auth/controllers/auth.controller.ts` — route `GET /auth/callback`
- `apps/twenty-front/src/modules/auth/components/SignInOptions.tsx` — UI : remplacer boutons Google/MS/Microsoft/Email par "Se connecter avec Veridian"

### Routes Hub à ajouter (côté veridian-hub)

- `GET /api/cross-app-login?app=crm&return=<url>` — déjà existant pour Prospection/Notifuse, à étendre pour `app=crm`
- Ticket cross-app à déposer dans `veridian-hub/todo/`

## Billing — pattern HMAC checkout via Hub

Twenty Twenty a son propre Stripe natif. On le remplace par notre Hub orchestré.

### Fichiers Twenty à modifier

- `apps/twenty-server/src/engine/core-modules/billing/*` — TOUT le module remplacé
- Nouvelle route : `apps/twenty-server/src/modules/veridian-billing/veridian-billing.module.ts`
- Méthodes :
  - `getCurrentPlan(workspaceId)` → HMAC GET `hub/api/tenants/<id>/plan`
  - `startCheckout(workspaceId, plan)` → HMAC POST `hub/api/billing/checkout-from-app` (pattern existant W7b refill-icp + Prospection)
  - `cancelSubscription(workspaceId)` → HMAC POST `hub/api/billing/cancel`

### UI Billing

- `apps/twenty-front/src/pages/settings/billing/*` — page sims simple "Voir ma facturation sur veridian.site/billing" + lien externe

## Provisioning workspace

Quand un user Hub décide d'ajouter le CRM à ses apps :
1. Hub admin `/dashboard/apps` → bouton "Activer Veridian CRM"
2. Hub HMAC POST `crm.app.veridian.site/api/provisioning/create-workspace` body `{ hub_tenant_id, hub_user_id, plan }`
3. CRM crée :
   - 1 row `core.workspaces` avec `hub_tenant_id` mapped
   - 1 schéma Postgres `workspace_{uuid}`
   - Seeds Objects natifs (Company, Person, Opportunity, etc.)
4. CRM return `{ workspace_id, redirect_url }`
5. Hub redirect user vers `crm.app.veridian.site/workspaces/<id>/start`

### Tickets cross-app à créer

- `veridian-hub/todo/2026-05-25-cross-app-crm-magic-link.md` (auth)
- `veridian-hub/todo/2026-05-25-cross-app-crm-billing-checkout.md` (billing)
- `veridian-hub/todo/2026-05-25-cross-app-crm-provisioning.md` (provisioning)

## Estimation

- Auth : 4-5 jours
- Billing : 3-4 jours
- Provisioning : 2-3 jours
- **Total : ~2 semaines avec 1-2 agents**
