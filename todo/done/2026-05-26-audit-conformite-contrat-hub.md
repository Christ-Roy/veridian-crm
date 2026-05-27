# Audit de conformité Veridian CRM (fork Twenty) vs CONTRAT-HUB v1.7

> **Sévérité** : 🔴 P0
> **Owner** : agent veridian-crm
> **Créé** : 2026-05-26
> **Bloquant pour** : Vague 11.2 (intégration Hub auth) — sans ce ticket résolu, on ne peut pas câbler l'auth Veridian sur le CRM ni intégrer Stripe billing.

## Contexte

Veridian CRM est un fork de `twentyhq/twenty` (commit `1188ea9c` du 2026-05-25), cloné dans `veridian-platform/veridian-crm-repo/`. Le code de Twenty est conçu pour être un produit **standalone** (auth interne, billing interne, magic links internes, tenants internes au sens "workspaces").

Le Hub Veridian impose un contrat strict (`CONTRAT-HUB.md` v1.7) à toutes les apps qu'il pilote : provisioning HMAC, update-plan webhook Stripe, magic links centralisés via Hub, lookup user data, cycle de vie tenant, etc.

**Question centrale** : qu'est-ce que Twenty fait DÉJÀ qui se mappe au contrat Hub, qu'est-ce qu'il faut ADAPTER (réécrire ou wrapper), et qu'est-ce qu'il faut AJOUTER de zéro ?

Sans cet audit, on va inventer du code à l'arrache ou réécrire des choses que Twenty fait déjà bien.

## Périmètre

Auditer ces 9 endpoints obligatoires du contrat Hub (cf `veridian-hub/docs/CONTRAT-HUB.md` §5) :

| # | Endpoint Hub attendu | Équivalent Twenty existant ? | Action |
|---|---|---|---|
| 1 | `POST /api/tenants/provision` | ? | ? |
| 2 | `POST /api/tenants/update-plan` | ? (Twenty a son propre billing Stripe) | ? |
| 3 | `POST /api/tenants/attach-owner` | ? | ? |
| 4 | `POST /api/tenants/suspend` | ? | ? |
| 5 | `POST /api/tenants/resume` | ? | ? |
| 6 | `GET /api/tenants/{id}/health` | ? | ? |
| 7 | `POST /api/workspaces.generateMagicLink` | ? (Twenty a magic link interne) | ? |
| 8 | `DELETE /api/tenants/{id}` | ? | ? |
| 9 | `POST /api/sso/issue-magic-link` | ? (bounce OAuth Hub) | ? |

Plus les invariants transverses :

- **Auth HMAC** (`CONTRAT-HUB.md` §6) : Twenty utilise probablement JWT pour son auth interne — comment plug HMAC pour les appels Hub→CRM ?
- **Modèle d'identité user cross-app** (§3.7) : Twenty a sa table `users` + `workspaceMembers`. Mappage avec `hub_user_id` du contrat ?
- **Lookup user data** (§5.12) : endpoint `GET /api/users/by-email` pour discovery cross-app. Twenty a-t-il un équivalent GraphQL exposable ?
- **Localisation/i18n** (§5.13) : Twenty supporte i18n ?
- **Rotation api_key** (§5.15)
- **Transfer ownership** (§5.16)
- **Sync membres tenant cross-app — Option C** (§5.18)
- **Permissions et droits cross-app v1.5** (§11bis) : Twenty a son propre système de rôles (owner/admin/member) — comment harmoniser ?
- **Format d'erreurs standardisé** (§5.10) : Twenty renvoie quoi en cas d'erreur GraphQL ?
- **Idempotency-Key header** (§5.11) : Twenty gère ?
- **Audit log** (§7 + SAAS-STANDARDS) : Twenty a un audit log natif ? Sous quelle licence (AGPL ou EE) ?

## Méthode d'audit

Pour chaque endpoint et invariant ci-dessus :

1. **Grep le code Twenty cloné** (`veridian-crm-repo/packages/twenty-server/src/`) pour identifier les modules existants équivalents.
2. **Vérifier la licence** de chaque fichier impliqué :
   - Si AGPL → on peut modifier librement
   - Si `/* @license Enterprise */` → on ne peut PAS modifier, il faut wrapper depuis du code AGPL ou réécrire en clean room
3. **Lire** les routes GraphQL/REST exposées, les schémas, les services.
4. **Cross-référencer** avec `CONTRAT-HUB.md` §5 + §6 + §7.
5. **Produire un mapping** : "Twenty fait X via `path/to/file.ts:42` → on plug Hub en Y, gap = Z".

Endpoints Twenty natifs probablement utiles à creuser en priorité :

- `packages/twenty-server/src/engine/core-modules/workspace/` — gestion workspaces
- `packages/twenty-server/src/engine/core-modules/auth/` — auth (sign-in-up, magic link, tokens)
- `packages/twenty-server/src/engine/core-modules/user/` — gestion users
- `packages/twenty-server/src/engine/core-modules/billing/` — billing Stripe interne Twenty (à virer ou adapter)
- `packages/twenty-server/src/engine/core-modules/api-key/` — API keys (si existe, mappage avec api_key Hub)
- `packages/twenty-server/src/engine/core-modules/audit/` — audit logs (si existe)

## Livrable attendu

Un fichier `AUDIT-CONFORMITE-HUB.md` dans `veridian-crm/` avec :

1. **Tableau de mapping** endpoint Hub → fichier Twenty existant + statut (✅ ready / 🟡 à adapter / 🔴 à créer)
2. **Liste des fichiers EE à éviter** dans ce périmètre (le module `enterprise/` ne touche pas au billing/auth Hub mais à confirmer)
3. **Effort estimé par catégorie** (heures-agent) : adaptation vs création
4. **Risques identifiés** : conflits entre l'auth Twenty interne et l'auth Hub HMAC, double-billing (Stripe Twenty + Stripe Hub), etc.
5. **Recommandation stratégique** : 3 options possibles (ex : "ripper le billing Twenty et tout faire via Hub" vs "garder le billing Twenty et désactiver le pricing externe" vs "hybride"), avec reco motivée.

## Pourquoi P0

- Bloque la spec de Vague 11.2 (intégration auth Hub)
- Bloque la décision "garde le billing Twenty ou rip et utilise le billing Hub-only"
- Sans cet audit, l'agent qui attaquera Vague 11 va inventer des trucs ou casser le contrat Hub

## Non-objectifs de ce ticket

- Ne PAS commencer à coder
- Ne PAS modifier le code Twenty
- Ne PAS faire le rebrand visuel (autre ticket)
- Ne PAS toucher aux 300 fichiers `@license Enterprise`

Juste **lire, mapper, recommander**.

## Dépendances

- `veridian-hub/docs/CONTRAT-HUB.md` (lire en entier — 4269 lignes mais skip les sections billing extraites)
- `veridian-hub/docs/CONTRAT-HUB-API-REF.md` (référence technique exhaustive)
- `veridian-hub/docs/CONTRAT-BILLING.md` (frontière Stripe — important pour décision billing Twenty vs Hub)
- `veridian-crm/AUDIT-LIMITE-EE-TWENTY.md` (déjà produit — cadre légal AGPL)
- `veridian-crm-repo/` (fork cloné, code à auditer)
