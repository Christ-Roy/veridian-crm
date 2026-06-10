# Faire sauter les verrous EE de Twenty — mode standalone

> **Sévérité** : 🔴 P0
> **Owner** : agent veridian-crm
> **Créé** : 2026-05-26
> **Stratégie** : Twenty reste **standalone**. Pas d'intégration contrat Hub. Modifications **minimales** dans le code. On débloque juste les features EE qui sont juste gated par `enterprisePlanService.isValid()` côté code AGPL.

## Contexte (décision Robert 2026-05-26)

Cadre stratégique simplifié :

- ✅ Twenty fork rebrandé Veridian CRM
- ✅ Tourne en **standalone** (son propre login, son propre admin, ses propres magic links, son propre billing désactivé)
- ❌ **PAS** d'intégration Hub auth (pas de HMAC, pas d'`update-plan`, pas de provisioning Hub→CRM)
- ❌ **PAS** de réimplémentation clean room de SSO/SAML/RLS (ces features restent inactives jusqu'à demande client)
- ✅ Modifications minimales dans le code Twenty (le moins de surface = le moins de rebase pain à l'avenir)

Conséquence : l'audit `docs/spec/AUDIT-CONFORMITE-HUB.md` (529 lignes) est **archivé** comme référence future, pas comme spec à implémenter.

## Légal — rappel rapide

Cf `docs/spec/AUDIT-LIMITE-EE-TWENTY.md` :

- **300 fichiers `/* @license Enterprise */`** : code propriétaire Twenty Labs. **NE PAS LES MODIFIER**.
- Le reste = AGPLv3 : modifications libres, à condition de publier nos modifs.

**Patcher la limite "5 workspaces" est OK** (fichier AGPL).
**Patcher `enterprisePlanService.isValid()` pour retourner `true` artificiellement = INTERDIT** (le fichier `enterprise-plan.service.ts` est EE).

## Ce qu'on PEUT débloquer légalement

L'analyse de `enterprisePlanService.isValid()` dans le code montre 2 catégories d'usages :

### Catégorie 1 : Check fait depuis un fichier AGPL (✅ on peut modifier)

Ce sont les **callsites** de `enterprisePlanService.isValid()` qui vivent dans des fichiers SANS le marker `@license Enterprise`. Le check appelle bien une fonction EE (`isValid()`), mais le code qui décide quoi faire en réponse est AGPL. **On peut modifier le code AGPL qui appelle ce check pour neutraliser le gating.**

Exemple confirmé pendant l'audit légal :
- `auth/services/sign-in-up.service.ts:459-477` (AGPL) appelle `enterprisePlanService.isValid()` pour gater la limite 5 workspaces
- → on peut modifier `sign-in-up.service.ts` librement (déjà fait : on a passé `MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY` à `Number.MAX_SAFE_INTEGER` dans le fichier constante AGPL)

### Catégorie 2 : Check fait depuis un fichier EE (❌ ne pas toucher)

Quand le check est dans un fichier marqué `@license Enterprise`, on ne touche pas. La feature reste désactivée dans notre fork (acceptable — on les active jamais ou on les réimplémente clean room plus tard si client le demande).

## Tâches

### 1. Patch limite workspaces (✅ DÉJÀ FAIT le 2026-05-26)

Fichier : `packages/twenty-server/src/engine/core-modules/auth/constants/max-workspaces-without-enterprise-key.constants.ts`
```typescript
export const MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY = Number.MAX_SAFE_INTEGER;
```

Effort : trivial. Statut : ✅ committé sur staging local (pas encore push).

### 2. Inventorier tous les callsites AGPL de `enterprisePlanService.isValid()`

Grepper le code et lister chaque callsite avec :
- Fichier + ligne
- Header de licence du fichier (AGPL ou EE)
- Feature qui est gatée
- Décision : (a) neutraliser le gating (le check retourne toujours "feature active"), (b) laisser gaté (feature inactive dans notre fork), (c) feature dans fichier EE → ne pas toucher

À partir de l'audit déjà fait, on sait que `enterprisePlanService.isValid()` est appelé depuis :
- `auth/services/sign-in-up.service.ts` (AGPL) — limite workspaces → ✅ déjà neutralisé
- `metadata-modules/row-level-permission-predicate/services/row-level-permission-predicate*.service.ts` (header à vérifier) — RLS
- `core-modules/jwt/crons/jobs/rotate-signing-keys.cron.job.ts` (header à vérifier) — rotation JWT
- `core-modules/auth/guards/enterprise-features-enabled.guard.ts` (header à vérifier) — guard generic EE features
- `core-modules/billing/services/billing-subscription.service.ts` (probablement EE) — billing
- `core-modules/workspace/workspace.resolver.ts` (header à vérifier) — getters `hasValidEnterpriseKey` exposés en GraphQL

Pour chaque fichier : `head -3 <file>` pour voir le header de licence.

### 3. Neutraliser les checks AGPL qui gatent des features qu'on veut utiliser

Pour chaque callsite AGPL identifié dans la tâche 2 : décider feature par feature.

**Règle de décision** :
- Feature utile pour le SaaS Veridian (multi-workspace, RLS si AGPL, custom domain si AGPL) → neutraliser le gating (la feature devient "free for all")
- Feature inutile ou EE-only → laisser gaté

**Forme du patch** : modifier le callsite AGPL pour ignorer le résultat de `isValid()`. Exemple :
```typescript
// AVANT (sign-in-up.service.ts:459)
if (this.enterprisePlanService.isValid()) return;
if (workspaceCount < MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY) return;
throw new AuthException(...);

// APRÈS (option : supprimer entièrement la fonction)
// Pas de check, illimité.
```

### 4. Désactiver le billing Twenty proprement (sans toucher au code EE)

Le module `core-modules/billing/` est **majoritairement EE** (107/139 fichiers selon l'audit). On ne le modifie pas.

Mais comme on n'utilise pas le billing Twenty (Veridian = tout illimité, pas de paywall), il faut le **désactiver** pour qu'il ne déclenche pas d'erreurs au runtime.

Options à investiguer :
- (a) Variable d'env Twenty qui désactive le billing (genre `IS_BILLING_ENABLED=false`) — à chercher dans `config-variables.ts`
- (b) Ne pas charger le module `BillingModule` dans `app.module.ts` (modif AGPL : `app.module.ts` est-il AGPL ?)
- (c) Laisser le billing tourner en mode "Stripe key absente" → il devrait gracefully ne rien faire

À tester en staging avant de trancher.

### 5. Setup admin Robert

Une fois le mode `IS_MULTIWORKSPACE_ENABLED=true` activé (cf tâche 6), Twenty ne donne plus `canAccessFullAdminPanel = true` automatiquement au premier user.

Créer une **migration Veridian custom** (dans `packages/twenty-server/src/database/typeorm/core/migrations/veridian/`) qui fait :
```sql
UPDATE core."user"
SET "canAccessFullAdminPanel" = true,
    "canImpersonate" = true
WHERE email IN (
  'robert.brunon@veridian.site',
  'brunon5robert@gmail.com'
);
```

Ou alternative plus propre : un script seed à lancer manuellement après le premier login Robert.

### 6. Activer le mode multi-workspace

Dans le `.env` du compose Veridian CRM (à créer plus tard) :
```bash
IS_MULTIWORKSPACE_ENABLED=true
DEFAULT_SUBDOMAIN=app
SERVER_URL=https://crm.veridian.site
```

Et provisionner le DNS wildcard `*.crm.veridian.site → IP serveur` côté Cloudflare (skill `cloudflare-dns` disponible).

### 7. Rebrand visuel minimal

Pas dans ce ticket. Sera un ticket séparé (jour suivant) :
- Logo Veridian
- Nom "Twenty" → "Veridian CRM" dans l'UI
- Couleurs Veridian (`twenty-ui` theme)
- Footer "Source code" pour conformité AGPL

## Livrable de CE ticket

Un commit `staging` (ou série de petits commits) qui :

1. ✅ Limite workspaces patchée (déjà fait)
2. Liste markdown des callsites `enterprisePlanService.isValid()` avec décision par fichier (à ajouter dans `docs/spec/`)
3. Patches AGPL minimaux pour neutraliser le gating des features qu'on veut activer
4. Module billing désactivé (méthode à trancher après test)
5. Migration seed admin Robert
6. README expliquant comment lancer en mode multi-workspace local pour dev

**Pas de code Hub. Pas de HMAC. Pas de provisioning. Pas de SSO custom. Pas d'audit log GDPR.**

Twenty stand-alone, modifications surgical.

## Non-objectifs (À NE PAS FAIRE)

- ❌ Implémenter le contrat Hub (audit archivé pour référence future, pas pour exécution)
- ❌ Réécrire SSO/SAML/RLS en clean room (on attend qu'un client le demande)
- ❌ Patcher les 300 fichiers `@license Enterprise` (interdit légalement)
- ❌ Ajouter des modules `veridian-*/` custom (pas avant qu'un besoin réel apparaisse)
- ❌ Supprimer les packages ignorés (`twenty-docs`, etc. — pas urgent, on les laisse)

## Référence

- `docs/spec/AUDIT-LIMITE-EE-TWENTY.md` — cadre légal AGPL/EE
- `docs/spec/AUDIT-CONFORMITE-HUB.md` — archive (référence si un jour on intègre Hub)
- `docs/spec/AUDIT-TWENTY-MICRO.md` — archi technique Twenty (utile pour comprendre où on touche)

---

## Résolution — 2026-06-10 (agent twenty-crm, sprint tunnel)

**Tâche 2 (inventaire callsites `enterprisePlanService.isValid()`) — FAIT** :

| Callsite | Licence | Feature gatée | Décision |
|---|---|---|---|
| `auth/services/sign-in-up.service.ts:462` | AGPL | limite 5 workspaces | ✅ neutralisé (MAX_WORKSPACES → MAX_SAFE_INTEGER, commit `eb4c2df`) |
| `row-level-permission-predicate/services/*.service.ts` (×2) | **EE** | RLS | ❌ intouchable — reste gated (on ne la veut pas) |
| `jwt/crons/jobs/rotate-signing-keys.cron.job.ts:29` | **EE** | JWT rotation | ❌ intouchable — cron no-op sans `SIGNING_KEY_ROTATION_DAYS` |
| `auth/guards/enterprise-features-enabled.guard.ts:25` | **EE** | guard générique EE | ❌ intouchable |
| `billing/services/billing-subscription.service.ts:190` | **EE** | billing v2 | ❌ intouchable — piloté par `IS_BILLING_ENABLED` (ENV) |

**Conclusion** : aucun autre callsite AGPL à neutraliser. Toutes les features
nécessaires au SaaS Veridian et au tunnel sont accessibles (multi-workspace
illimité ✅, signup multi-tenant ✅ via `IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS=false`).
Les features EE restent légalement inactives — réimplémentation clean room
si un client les demande (vague 4).

Tâches 4-6 du ticket : couvertes depuis par le déploiement prod (ENV
multiworkspace posées, admin Robert promu en base le 2026-05-27, billing
piloté par ENV). Ticket archivé.
