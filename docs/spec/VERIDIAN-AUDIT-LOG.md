# Veridian Audit Log — journal d'audit append-only (clean-room AGPL)

> **Module** : `packages/twenty-server/src/engine/core-modules/veridian-audit-log/`
> **Licence** : AGPLv3 (Veridian) — réimplémentation clean-room, **aucun** code EE lu/copié
> **Statut** : livré 2026-06-14
> **Owner** : agent veridian-crm

---

## 0. Pourquoi ce module (et pourquoi il est clean-room)

Twenty embarque un module d'audit **`engine/core-modules/event-logs/`** marqué
`/* @license Enterprise */` → licence commerciale Twenty Labs, **interdit de
lire/modifier/redistribuer activé** (cf `AUDIT-LIMITE-EE-TWENTY.md`).

On a besoin d'un journal d'audit (RGPD art. 30 « registre des traitements » +
exigence SOC2 CC7 « audit trail ») pour le SaaS CRM. On le **réécrit depuis
zéro** en se branchant sur le **bus d'events AGPL natif** de Twenty
(`WorkspaceEventEmitter` + décorateurs `@OnDatabaseBatchEvent` /
`@OnCustomBatchEvent`), exactement le même point d'accroche public que la queue
webhook AGPL (`entity-events-to-db.listener.ts`). **Aucun fichier EE n'a été
ouvert** pour ce travail.

### ⚠️ Urgence : les events passés ne se rattrapent pas

Un journal d'audit ne capte que les events postérieurs à son déploiement.
Chaque jour sans audit = un trou définitif dans l'historique. C'est pourquoi ce
module est prioritaire et écrit large dès le départ (mieux vaut capter trop que
trop peu — on filtre à la lecture).

---

## 1. Events tracés (couverture)

| Catégorie | Source AGPL | Action(s) | Notes |
|---|---|---|---|
| **Record CRUD** | `@OnDatabaseBatchEvent('*', …)` sur `WorkspaceEventEmitter` | `record.created` / `record.updated` / `record.deleted` / `record.restored` / `record.destroyed` | Tous les objets métier (Company, Person, Opportunity, custom objects…). `diff` (before/after par champ) capté sur update. |
| **Auth — login** | custom event `veridian.auth.signed_in` émis par notre listener auth (cf §6) | `auth.signed_in` | actor + IP + provider (password / google / microsoft / sso) |
| **Auth — logout** | `veridian.auth.signed_out` | `auth.signed_out` | |
| **Auth — échec login** | `veridian.auth.sign_in_failed` | `auth.sign_in_failed` | email tenté + IP + raison (pas de mot de passe) |
| **Rôle / permission** | les rôles/permissions sont des records core → captés via `record.*` sur `role`, `roleTarget`, `permissionFlag` | `record.updated` etc. | pas besoin de listener dédié, c'est du CRUD core |
| **API key** | record core `apiKey` → `record.created` / `record.updated` (révocation = update `revokedAt`) | `record.*` | |
| **Custom domain change** | record core → `record.*` (quand le module veridian-custom-domains émettra ses events) | `record.*` | dépend du module custom-domains (tâche #1) |

> **Principe** : tout ce qui passe par le bus d'events natif est capté
> automatiquement par le listener `*` (wildcard). Les events non-DB (login,
> logout) nécessitent une émission explicite — c'est le rôle du listener auth
> §6. Si demain un module Veridian veut auditer un event métier custom, il lui
> suffit d'émettre un `emitCustomBatchEvent('veridian.audit.<x>', …)`.

---

## 2. Structure de la table `core.veridianAuditLog` (append-only)

```
id            uuid PK
workspaceId   uuid   (NULLABLE — un échec de login n'a pas toujours de workspace résolu)
              ⚠️ PAS de FK CASCADE vers workspace : un audit log SURVIT à la
              suppression du workspace (rétention légale). On garde l'id en clair.
action        varchar         ex "record.updated", "auth.signed_in"
targetType    varchar NULL    ex "company", "person", "apiKey", "role" — nameSingular de l'objet
targetId      uuid    NULL    recordId concerné (NULL pour login)
actorUserId         uuid NULL  l'utilisateur humain (userId du contexte)
actorWorkspaceMemberId uuid NULL le workspace member
actorType     varchar         "user" | "api_key" | "system" | "anonymous"
actorDisplay  varchar NULL    email ou nom affiché de l'acteur (dénormalisé pour la lecture)
ipAddress     varchar NULL    IP source (login + mutations via REST quand dispo)
userAgent     varchar NULL    user-agent (login)
context       jsonb  NULL     { provider, reason, ... } métadonnées libres selon l'action
diff          jsonb  NULL     { field: { before, after } } pour les updates — payload du diff natif
recordedAt    timestamptz     NOT NULL DEFAULT now()  (≈ l'instant d'écriture audit)
occurredAt    timestamptz NULL l'instant de l'event métier si différent (best effort)
```

Index :
- `IDX_VERIDIAN_AUDIT_LOG_WORKSPACE_RECORDED` sur `(workspaceId, recordedAt DESC)` — listing admin par workspace, le plus récent d'abord
- `IDX_VERIDIAN_AUDIT_LOG_TARGET` sur `(workspaceId, targetType, targetId)` — « historique d'un record »
- `IDX_VERIDIAN_AUDIT_LOG_ACTOR` sur `(workspaceId, actorUserId)` — « qu'a fait cet utilisateur »
- `IDX_VERIDIAN_AUDIT_LOG_ACTION` sur `(workspaceId, action)` — filtrer par type d'action

### Append-only — garanti par quoi ?

- **Pas de resolver/service de mutation** : aucune route GraphQL/REST `update` ou
  `delete` n'est exposée sur cette entité. Le code applicatif n'écrit QUE des
  INSERT (`repository.insert`, jamais `save`/`update`/`delete`).
- L'entité n'a **ni** `@UpdateDateColumn` **ni** colonne mutable métier.
- La purge de rétention (§3) est la **seule** suppression autorisée, faite par
  un job dédié borné par date.

---

## 3. Rétention

- **Défaut** : 365 jours glissants (`VERIDIAN_AUDIT_LOG_RETENTION_DAYS`, env,
  surchargeable). RGPD : pas de conservation illimitée de données personnelles
  sans base légale ; 1 an couvre la plupart des besoins SOC2/contractuels.
- **Purge** : un cron (à câbler plus tard, hors scope de cette première
  livraison — noté en §8) `DELETE FROM core."veridianAuditLog" WHERE
  "recordedAt" < now() - interval 'N days'`. Append-only sauf cette purge bornée.
- Tant que le cron n'est pas câblé, la table grandit — acceptable au volume
  CRM actuel (quelques milliers d'events/jour). Ticket de suivi posé.

---

## 4. Architecture & performance

```
  Mutation record (API GraphQL)
        │  (le runner émet déjà l'event sur le bus AGPL — gratuit)
        ▼
  WorkspaceEventEmitter.emitDatabaseBatchEvent()    ← bus AGPL natif
        │  @OnDatabaseBatchEvent('*', action)
        ▼
  VeridianAuditLogDatabaseEventListener  (process API, SYNCHRONE mais léger)
        │  → mappe l'event en AuditLogEntry[] + queue.add()   ← NE bloque PAS la mutation
        ▼
  veridianAuditLogQueue  (BullMQ, async)
        │  @Process
        ▼
  VeridianAuditLogWriterJob  (worker)
        │  repository.insert(entries)   ← écriture DB hors du chemin critique
        ▼
  core.veridianAuditLog
```

**Garantie perf** : le listener ne fait qu'un `mapping + queue.add()` (I/O Redis
non bloquant pour la mutation). L'INSERT Postgres se fait dans le worker. C'est
le **même pattern que le listener webhook AGPL natif** (`entity-events-to-db`),
donc zéro régression de latence sur les mutations.

**Fail-safe** : si la queue/worker est down, l'event est perdu mais la mutation
réussit (l'audit ne doit JAMAIS faire échouer une opération métier). Le listener
catch toute erreur et log un warning, il ne re-throw pas.

---

## 5. Lecture admin

- **Service** `VeridianAuditLogService.findEntries(filters)` : filtres
  `workspaceId` (obligatoire), `action?`, `targetType?`, `targetId?`,
  `actorUserId?`, `from?`, `to?`, pagination cursor `recordedAt`.
- **Resolver GraphQL** `veridianAuditLog(...)` gardé par
  `@UseGuards(WorkspaceAuthGuard)` + check `canAccessFullAdminPanel` (admin du
  workspace uniquement — un audit trail ne se lit pas par un membre lambda).
- Lecture seule, jamais de mutation exposée.

---

## 6. Listener auth (events non-DB)

Login/logout ne passent pas par le bus DB. On ajoute des **hooks d'émission**
non-invasifs : un service `VeridianAuditLogEmitter` exposé, appelé depuis les
points d'auth Veridian (ou via un guard/interceptor). Pour rester clean-room et
non-invasif sur le code Twenty, la première livraison fournit :

- le **listener** `@OnCustomBatchEvent('veridian.auth.*')` côté audit,
- le **service émetteur** `VeridianAuditLogEmitter.emitAuthEvent(...)` que le
  code Veridian peut appeler.

Le câblage effectif des points d'appel login/logout dans le flow auth Twenty
(interceptor sur le resolver de sign-in) est marqué en §8 (suite). La couverture
record CRUD (qui inclut déjà role/permission/apiKey) est, elle, **active
immédiatement** via le wildcard `*`.

---

## 7. Clean-room — preuve

- Bus utilisé : `WorkspaceEventEmitter`, `@OnDatabaseBatchEvent`,
  `@OnCustomBatchEvent` → tous **AGPL** (vérifiés `head -3`, aucun marker EE).
- Pattern de listener copié sur `telemetry.listener.ts` + `entity-events-to-db.listener.ts` → **AGPL**.
- Pattern de job copié sur `call-webhook-jobs.job.ts` → **AGPL**.
- Migration via `FastInstanceCommand` (système d'upgrade AGPL) sur le modèle
  `CreateSigningKeyTableFastInstanceCommand` → **AGPL**.
- **Le module `event-logs/` (EE) n'a jamais été ouvert.** On ne réutilise NI
  `EventLogEmitterModule` NI `EventLogIngestionModule` NI
  `CreateEventLogFromInternalEvent`.

---

## 8. Reste à câbler (suivi)

1. **Cron de purge rétention** — job `@Cron` qui DELETE au-delà de N jours.
2. **Câblage login/logout** — interceptor sur le resolver de sign-in pour appeler
   `VeridianAuditLogEmitter.emitAuthEvent`. (Le listener est prêt à recevoir.)
3. **UI admin** de consultation (front) — le resolver est prêt.
4. **Capture IP sur mutations GraphQL** — aujourd'hui dispo proprement seulement
   sur les events auth ; l'IP des mutations CRUD nécessitera de propager le
   `RequestContext` jusqu'au listener (best effort, non bloquant).
