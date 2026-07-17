# 01 — Archi méta-modèle Twenty (forked Veridian CRM)

> Décrit l'archi DB + serveur du fork Twenty qu'on rebrand. Sert de référence pour les agents qui attaqueront la Vague 11.

---

## 1. Topologie Twenty (état post-fork)

```
veridian-crm/
├── packages/
│   ├── twenty-server/          ← NestJS — backend (modules, schema, GraphQL, auth, billing)
│   │   ├── src/engine/
│   │   │   └── core-modules/   ← auth, billing, workspace, user, file, search...
│   │   └── src/modules/         ← business modules (messaging, calendar, workflow, view...)
│   ├── twenty-front/            ← React + Recoil — UI builder, kanban, tableau, fiches
│   ├── twenty-shared/           ← types + utils partagés
│   └── twenty-ui/               ← composants UI (tableau drag-drop, kanban, form generator)
├── docker-compose.yml           ← Postgres + Redis + server + worker + front
└── ...
```

**Stack** :
- Postgres 15+ (multi-schéma : `public` pour core, `workspace_{uuid}` par tenant pour data)
- Redis (cache + BullMQ queue)
- NestJS (backend, GraphQL schema dynamique recomputed)
- React + Recoil (frontend SPA, pas Next.js)
- BullMQ worker container séparé (jobs : indexation search, sync mail, workflows)

## 2. Métadata layer

C'est le cœur du méta-modèle. Tout repose sur 2 tables `core.objectMetadata` + `core.fieldMetadata` :

```sql
-- Tables CORE (système, partagées entre tous les workspaces)
CREATE TABLE core.objectMetadata (
  id UUID PRIMARY KEY,
  workspaceId UUID NOT NULL,
  nameSingular TEXT NOT NULL,        -- "deal"
  namePlural TEXT NOT NULL,          -- "deals"
  labelSingular TEXT NOT NULL,       -- "Deal"
  labelPlural TEXT NOT NULL,         -- "Deals"
  icon TEXT,
  isCustom BOOLEAN DEFAULT true,     -- false pour les Objects natifs (Company, Person, etc.)
  isActive BOOLEAN DEFAULT true,
  isSystem BOOLEAN DEFAULT false,
  description TEXT,
  imageIdentifierFieldMetadataId UUID,
  labelIdentifierFieldMetadataId UUID,
  createdAt TIMESTAMPTZ,
  updatedAt TIMESTAMPTZ
);

CREATE TABLE core.fieldMetadata (
  id UUID PRIMARY KEY,
  objectMetadataId UUID NOT NULL REFERENCES core.objectMetadata(id),
  type TEXT NOT NULL,                -- 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'DATE_TIME' | 'CURRENCY' | 'LINK' | 'EMAIL' | 'PHONE' | 'ADDRESS' | 'SELECT' | 'MULTI_SELECT' | 'RELATION' | 'UUID' | 'RICH_TEXT' | 'POSITION' | 'RATING'
  name TEXT NOT NULL,                -- "expectedCloseDate"
  label TEXT NOT NULL,               -- "Expected Close Date"
  defaultValue JSONB,
  options JSONB,                     -- pour SELECT / MULTI_SELECT : [{ id, label, color, position }]
  description TEXT,
  icon TEXT,
  isNullable BOOLEAN DEFAULT true,
  isUnique BOOLEAN DEFAULT false,
  isCustom BOOLEAN DEFAULT true,
  isActive BOOLEAN DEFAULT true,
  isSystem BOOLEAN DEFAULT false,
  -- pour RELATION :
  relationDefinition JSONB,          -- { fromObjectMetadataId, toObjectMetadataId, type: 'ONE_TO_MANY' | 'MANY_TO_ONE' | 'MANY_TO_MANY' }
  createdAt TIMESTAMPTZ,
  updatedAt TIMESTAMPTZ,
  UNIQUE(objectMetadataId, name)
);
```

À partir de ces 2 tables, Twenty **génère dynamiquement** :
- Les tables Postgres physiques dans le schéma `workspace_{uuid}` (DDL runtime via `WORKSPACE_SCHEMA_DDL_LOCKED` advisory lock)
- Le schéma GraphQL (recomputed à chaque ALTER metadata)
- L'UI : composants tableau / kanban / fiche pour chaque Object, avec colonnes dérivées des fields

## 3. Workspaces (multi-tenancy)

| Niveau | Lieu |
|---|---|
| **Core (système)** | Schéma Postgres `core` — tables `users`, `workspaces`, `objectMetadata`, `fieldMetadata`, `view`, `viewField`, `viewSort`, `viewFilter`, etc. |
| **Workspace data** | Schéma Postgres `workspace_{uuid}` — 1 table par Object (`company`, `person`, `deal`, ...). Toutes les rows custom de ce tenant. |
| **Cache** | Redis `tenant:{uuid}:cache:...` |

Création d'un workspace = CREATE SCHEMA + seed des Objects natifs (Company, Person, Opportunity, Note, Task, etc.).

## 4. Adaptations Veridian (à coder pendant la Vague 11)

| Composant Twenty natif | Remplacement Veridian | Fichier(s) touchés |
|---|---|---|
| Auth Twenty (email/password local + OAuth Google/MS) | **Auth Hub Veridian via HMAC** | `core-modules/auth/auth.module.ts`, `auth.service.ts` |
| Billing Stripe Twenty natif | **Billing Hub Veridian** (refactor → HMAC checkout) | `core-modules/billing/*` |
| Email transactional Twenty natif (SendGrid/SMTP) | **Notifuse via API HTTP** | `core-modules/email/email.module.ts` |
| File storage S3 Twenty | **R2 Cloudflare Veridian** | `core-modules/file/file.module.ts` |
| Messaging Twenty (Gmail OAuth direct) | **Mail Gateway Hub Veridian** (réutilise W7a) | `modules/messaging/*` |
| Workspaces "anonymous" | **Tenant Hub Veridian** (1 Hub user = N workspaces CRM) | `core-modules/workspace/workspace.module.ts` |

⚠️ **Beaucoup d'adaptations**. Ce sont les briques principales du sprint Vague 11.

## 5. Module spécifique Veridian — "Leads B2B FR"

Nouveau module à coder **par-dessus** Twenty :

```
packages/twenty-server/src/modules/veridian-leads/
├── veridian-leads.module.ts
├── veridian-leads.service.ts            ← Pull leads qualifiés depuis Prospection via HMAC
├── veridian-leads.resolver.ts           ← GraphQL queries : `lead_b2b_search`, `lead_b2b_pull_to_workspace`
└── jobs/sync-leads-to-workspace.job.ts  ← BullMQ job qui injecte les leads dans l'Object 'Lead' du workspace
```

Le pattern :
1. User CRM clique "Importer leads B2B FR"
2. Configurateur ICP (réutilise le composant React de W7b refill-icp, à porter de Next.js vers Twenty React)
3. POST `/api/leads/import-from-prospection` côté CRM
4. Backend CRM HMAC vers Prospection `POST /api/leads/qualified-pull` (nouvelle route Prospection à créer)
5. Prospection return liste de leads + filtres appliqués
6. CRM job BullMQ insert les leads dans la table `workspace_{uuid}.lead`
7. UI rafraîchit, leads visibles dans l'Object 'Lead' du workspace

## 6. Module spécifique Veridian — "Mail propre via Notifuse"

Nouveau module à coder **par-dessus** Twenty :

```
packages/twenty-server/src/modules/veridian-mail/
├── veridian-mail.module.ts
├── veridian-mail.service.ts             ← Push campagne mail vers Notifuse
└── workflows/send-campaign.workflow.ts  ← Action dispo dans Twenty Workflows pour envoyer une campagne
```

Le pattern :
1. User CRM crée un Workflow "Quand Deal passe en stage Hot, envoyer mail Y au contact"
2. Workflow exécution → CRM HMAC vers Notifuse `POST /api/campaigns/send-from-crm`
3. Notifuse envoie via SMTP/Gmail Hub Gateway (réutilise W7a)
4. Status mail synchronisé via webhook Notifuse → CRM

## 7. Risques techniques connus

| Risque | Mitigation |
|---|---|
| **Migrations destructives Twenty upstream** | Pin version stable, audit avant rebase upstream |
| **DDL dynamic + locks Postgres** | Tester les patterns avant prod, monitoring |
| **Stack NestJS vs Next.js Veridian** | Acceptable. On garde NestJS pour ce produit. Si besoin de service worker, on déploie un Next.js layer devant. |
| **BullMQ worker container séparé** | Task séparée dans le job Nomad `crm`. Pas un blocker (Veridian a déjà ce pattern pour Prospection cron) |
| **GraphQL recomputed = latence sur create field** | UX bien designée + spinner explicite "Recompute schéma..." |
| **AGPLv3 viral** | Accepté. Code public dès J1. Pas de dépendance secrète propriétaire. |

## 8. Effort détaillé (estimation)

| Module | Effort solo agents Opus parallèles |
|---|---|
| Fork + rebrand visuel (logo, nom, couleurs, copy) | 1-2 jours (1 agent) |
| Intégration Hub auth (HMAC) | 1 semaine (1 agent) |
| Intégration Hub billing | 1 semaine (1 agent) |
| Intégration Notifuse (email transactional) | 3-4 jours (1 agent) |
| R2 storage migration | 2-3 jours (1 agent) |
| Module veridian-leads (pull Prospection) | 1 semaine (1 agent backend + 1 agent UI port) |
| Module veridian-mail (push Notifuse) | 3-4 jours (1 agent) |
| Déploiement job Nomad + ingress Traefik | 2 jours (1 agent infra) |
| Documentation + tests E2E hard-core | 1 semaine (1 agent) |
| **TOTAL solo en giga-sprint** | **~6-8 semaines** (~1.5-2 mois cible) |

## 9. Liens

- Repo source : https://github.com/twentyhq/twenty (fork à faire)
- Doc archi Twenty : https://docs.twenty.com/developers
- Sibling files : `02-rebrand-checklist.md`, `03-integration-hub-auth.md`, ..., `07-sprint-decomposition.md`
