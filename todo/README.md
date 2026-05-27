# `veridian-crm/todo/` — Boîte de réception agent

> Convention standard cross-app Veridian (cf `veridian-platform/CLAUDE.md`).

## Stratégie (gravée 2026-05-27 par Robert — pivot vs spec 2026-05-26)

Veridian CRM est **intégré au Hub avec souplesse via API GraphQL/REST native Twenty**, pas en standalone strict.

**Pattern API-bridge maigre** :
- Hub initie tous les signups CRM via `signUpInNewWorkspace` (GraphQL Twenty)
- Hub stocke `twentyWorkspaceId` + `twentyApiKey` (chiffrée) dans une nouvelle table `crm_tenants`
- Signup public Twenty bloqué par redirect Traefik `/welcome` → Hub
- Use case immédiat : Robert provision les tenants à la main pour ses premiers clients consulting, pousse des leads qualifiés via API REST Twenty avec moi

**Pas dans le scope immédiat** :
- ❌ Implémentation du contrat Hub strict (9 endpoints HMAC, etc.)
- ❌ UI dashboard self-service Hub (vague 3)
- ❌ Rebrand visuel complet (vague 3)
- ❌ Réimplémentation clean room des features EE (RLS, SSO custom, JWT rotation)

**Cadre légal** : 300 fichiers `@license Enterprise` intouchables. Modifs minimales dans le code AGPL Twenty. Cf `docs/spec/AUDIT-LIMITE-EE-TWENTY.md`.

## Tickets actifs (vague 2 — en cours)

| Fichier | Sévérité | Description |
|---|---|---|
| `2026-05-27-deploy-staging-twenty-fork.md` | 🔴 P0 | Déploiement Twenty fork sur `crm.staging.veridian.site` — Dockerfile + workflow build GHCR + compose Dokploy + DNS Cloudflare + smoke |
| `2026-05-26-faire-sauter-verrous-twenty.md` | 🟡 P1 (rétrogradé) | Patch limite workspaces ✅ fait. Reste : neutraliser autres callsites AGPL si besoin (à voir à l'usage). Désactivation billing = ENV-only, pas besoin de toucher au code. |
| `2026-05-27-vague-3-self-service-rebrand-webhook.md` | 🟡 P1 | Vague 3 — UI self-service Hub + rebrand + webhook + déploiement prod. **À déclencher après vague 2 validée terrain.** |

## Tickets associés (autres repos)

| Repo | Ticket | Description |
|---|---|---|
| `veridian-hub` | `todo/2026-05-27-route-admin-create-crm-tenant.md` | Route admin Hub `POST /api/admin/crm/create-tenant` qui appelle Twenty et stocke les creds |

## Archivés

- `done/2026-05-26-audit-conformite-contrat-hub.md` — audit Hub livré, archivé (stratégie pivotée 2x : standalone → API-bridge)
- `done/2026-05-25-audit-twenty-micro-detail.md` — audit technique micro Twenty livré dans `docs/spec/AUDIT-TWENTY-MICRO.md`

## Archivage manuel

```bash
mv todo/<ticket>.md todo/done/
```

## Roadmap de vagues

- **Vague 1** (✅ fait 2026-05-27) : patch limite workspaces + CI Veridian CRM verte sur `eb4c2df`
- **Vague 2** (⏳ en cours) : déploiement staging + route admin Hub
- **Vague 3** (à venir) : UI self-service + rebrand + webhook + prod
- **Vague 4** (long terme) : features clean room sur demande client (SSO custom, RLS, etc.)
