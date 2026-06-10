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

## Tickets actifs

| Fichier | Sévérité | Description |
|---|---|---|
| `2026-05-27-P0-couper-leaks-outbound-twenty-labs.md` | 🔴 P0 | Leaks outbound vers Twenty Labs/tiers — **patches livrés 2026-06-10** (commit `16925b7`, cf `docs/spec/AUDIT-OUTBOUND-LEAKS.md`). Reste : vérif réseau prod post-deploy + test e2e nock (dette). |
| `2026-06-10-journal-structure-tunnel.md` | 🟢 P2 | Journal IaC de la structure "Tunnel de vente" (sprint tunnel) — référence pour l'export IaC (SPEC-IAC-TWENTY §5) |
| `2026-05-27-vague-3-self-service-rebrand-webhook.md` | 🟡 P1 | Vague 3 — UI self-service Hub + rebrand + webhook. **À déclencher après validation terrain.** |

## Tickets associés (autres repos)

| Repo | Ticket | Description |
|---|---|---|
| `veridian-hub` | `todo/2026-05-27-route-admin-create-crm-tenant.md` | Route admin Hub `POST /api/admin/crm/create-tenant` qui appelle Twenty et stocke les creds |

## Archivés

- `done/2026-05-27-deploy-staging-twenty-fork.md` — staging livré 2026-05-27
- `done/2026-05-26-faire-sauter-verrous-twenty.md` — soldé 2026-06-10 : inventaire complet callsites `isValid()` (1 AGPL neutralisé, 5 EE intouchables), rien d'autre à faire
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
