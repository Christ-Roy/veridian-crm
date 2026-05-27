# Vague 3 — Self-service Hub + rebrand visuel + webhook tenant.created

> **Sévérité** : 🟡 P1
> **Owner** : à dispatcher entre agent veridian-crm + agent veridian-hub
> **Créé** : 2026-05-27
> **Dépend de** :
> - `2026-05-27-deploy-staging-twenty-fork.md` (staging up) — vague 2
> - `veridian-hub/todo/2026-05-27-route-admin-create-crm-tenant.md` — vague 2
> - 1-3 clients consulting onboardés manuellement par Robert (validation pattern)

## Contexte

Vague 1 = patch limite workspaces + CI ✅
Vague 2 = staging déployé + route admin Hub create-tenant ⏳
Vague 3 = passage en self-service + finition produit

À déclencher **uniquement après** que Robert ait validé le pattern API
sur 1-3 clients réels. Pas de feature rush avant validation terrain.

## Sous-tickets à créer

### 3.1 Carte dashboard Hub "Veridian CRM" self-service

- Carte "Veridian CRM" dans `app/dashboard/page.tsx` côté Hub
- Click → wizard rapide (nom workspace, slug) → appelle `/api/admin/crm/create-tenant` (route déjà créée en vague 2)
- Magic link auto-login en retour, ouvre l'onglet
- Carte affiche statut "active / suspended" + bouton "Ouvrir CRM"

### 3.2 Webhook AGPL `workspace.created` Twenty → Hub

Modif AGPL minimale dans `packages/twenty-server/src/engine/core-modules/auth/services/sign-in-up.service.ts` :

```typescript
// Après création réussie d'un workspace, POST best-effort au Hub
if (process.env.VERIDIAN_HUB_WEBHOOK_URL) {
  await fetch(`${process.env.VERIDIAN_HUB_WEBHOOK_URL}/api/webhooks/crm/workspace-created`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Veridian-Hub-Signature': hmac(...),
      'X-Veridian-Timestamp': Date.now().toString(),
    },
    body: JSON.stringify({ workspaceId, userId, email, createdAt }),
  }).catch(err => logger.warn('Hub webhook failed', err));
}
```

Belt-and-suspenders : le Hub sait déjà puisque c'est lui qui a appelé,
mais le webhook lui donne un signal asynchrone si jamais un signup est
fait via OAuth Google/Microsoft sans passer par le Hub.

### 3.3 Guard AGPL "signup only via Hub"

Sur `sign-in-up.service.ts`, ajouter un guard plus strict que le simple
redirect Traefik :

```typescript
if (process.env.VERIDIAN_HUB_ONLY === 'true') {
  const hubToken = context.req.headers['x-veridian-hub-token'];
  if (hubToken !== process.env.VERIDIAN_HUB_API_TOKEN) {
    throw new AuthException('Signup must go through Veridian Hub', AuthExceptionCode.FORBIDDEN_EXCEPTION);
  }
}
```

Bloque même les bypass via GraphQL direct (qui contournent le redirect Traefik).

### 3.4 Rebrand visuel minimal

Cf `docs/spec/02-rebrand-checklist.md`. Au minimum pour aller en prod :

- Logo Veridian dans `packages/twenty-front/public/`
- Nom "Twenty" → "Veridian CRM" dans les titres, copy, emails
- Couleur primaire Veridian dans `packages/twenty-ui/src/theme/`
- Footer "Source code" (obligation AGPL)

⚠️ Aucun fichier `@license Enterprise` ne doit être modifié. Vérifier
`head -3` avant chaque edit.

### 3.5 Déploiement prod `crm.veridian.site`

Une fois staging stable + rebrand fait + 1-3 clients consulting validés,
déployer en prod :

- Nouveau compose Dokploy prod (séparé du staging)
- DNS Cloudflare `crm.veridian.site` + `*.crm.veridian.site` → IP prod (`100.88.202.29`)
- Cert Let's Encrypt wildcard via DNS-01 (cf token `CF_DNS_TOKEN_TRAEFIK_DEV` existant pour dev, peut-être un autre pour prod)
- Smoke E2E avant promotion

### 3.6 Lifecycle (suspend/resume/delete tenant)

À implémenter quand un client annule ou est suspendu pour paiement.
Pour l'instant Veridian CRM = tout illimité, pas de paywall, donc pas
de cas d'usage immédiat.

Endpoints à ajouter côté Hub :
- `POST /api/admin/crm/suspend-tenant/{tenantId}`
- `POST /api/admin/crm/resume-tenant/{tenantId}`
- `DELETE /api/admin/crm/tenant/{tenantId}` (avec soft-delete d'abord, purge après 30j)

Côté Twenty : utiliser les mutations GraphQL natives `deleteUserAccount`
ou `deactivateWorkspaceMember` selon le scope.

## Non-objectifs (à NE PAS faire en vague 3)

- ❌ Implémenter le contrat Hub complet (HMAC strict + 9 endpoints obligatoires) — pas utile tant que le pattern API-bridge maigre suffit
- ❌ Reverse SSO/SAML clean room (vague 4+ si un client le demande)
- ❌ Row-Level Security (RLS) — feature EE, à laisser tant qu'aucun client la demande
- ❌ Custom domain par client — feature EE, idem
- ❌ JWT key rotation — feature EE, idem
