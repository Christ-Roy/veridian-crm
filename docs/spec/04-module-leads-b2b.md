# 04 — Module Veridian-Leads (pull leads qualifiés depuis Prospection)

> Module ajouté au CRM forké qui permet à un user CRM d'importer des leads B2B qualifiés depuis Veridian Prospection. C'est le différenciateur produit Vertical FR.

## Pattern

```
User CRM dans workspace XXX
  └─ click "Importer leads B2B FR"
     └─ Configurateur ICP (composant porté de W7b refill-icp Next.js → React Twenty)
        └─ click "Importer N leads"
           └─ POST crm.app.veridian.site/api/veridian-leads/import body { workspaceId, filters }
              └─ Backend CRM HMAC vers Prospection :
                 POST prospection.app.veridian.site/api/veridian-leads/qualified-pull
                 Headers HMAC Pattern A (CRM_PROSPECTION_API_SECRET)
                 Body { tenant_id, quantity, filters }
                 ──► Prospection :
                     1. Re-vérifie quota / billing tenant
                     2. Query DB leads qualifiés selon filtres (réutilise lib refill-icp/filters.ts)
                     3. Return list de N leads { siren, raison_sociale, contacts, email, ... }
              └─ CRM job BullMQ inserts les leads dans workspace_{uuid}.lead (Object "Lead")
              └─ UI rafraîchit, leads visibles dans l'Object 'Lead'
```

## Composants à coder côté CRM

### Backend

```
apps/twenty-server/src/modules/veridian-leads/
├── veridian-leads.module.ts
├── veridian-leads.service.ts      ← HMAC client vers Prospection
├── veridian-leads.resolver.ts     ← GraphQL: `veridianLeadsImport(filters, quantity)`
├── jobs/sync-leads-to-workspace.job.ts  ← BullMQ job idempotent
└── seed/lead-object.seed.ts       ← Seed l'Object "Lead" avec ses fields (siren, raison_sociale, contacts, score_tech, etc.)
```

### Frontend

```
apps/twenty-front/src/modules/veridian-leads/
├── components/
│   ├── ImportLeadsDialog.tsx           ← Modal config ICP
│   ├── SectorMultiSelect.tsx           ← Porté W7b refill-icp
│   ├── GeoMultiSelect.tsx
│   ├── EmployeeRangeSlider.tsx
│   ├── LiveCountPreview.tsx
│   └── ImportProgress.tsx              ← Polling de l'état du job BullMQ
└── pages/
    └── ImportLeadsPage.tsx
```

## Composants à coder côté Prospection

### Nouvelle route HMAC

```ts
// src/app/api/veridian-leads/qualified-pull/route.ts
// Auth: HMAC Pattern A (header X-Veridian-Prospection-Signature)
// Body: { tenant_id, quantity, filters }
// Return: { leads: Lead[], total_qualified: number, billed_credits: number }
```

Cette route :
1. Vérifie HMAC contre `CRM_PROSPECTION_API_SECRET`
2. Récupère le tenant Hub correspondant (HMAC Hub `/api/tenants/<id>` ou cache)
3. Re-vérifie quota Hub (refill leads disponibles ?)
4. Si quota OK, query la DB enrichie selon filtres
5. Décrémente le quota Hub (HMAC POST `hub/api/tenants/<id>/decrement-leads`)
6. Return les leads matchés

### Ticket cross-app Prospection

Déposer dans `veridian-prospection/todo/` :
`2026-05-25-veridian-leads-qualified-pull-route.md`

## Seed Object "Lead" dans Twenty

Au workspace provisioning, créer un Object système :

```ts
// Migration metadata
INSERT INTO core.objectMetadata (id, workspaceId, nameSingular, namePlural, labelSingular, labelPlural, icon, isCustom, isSystem)
VALUES (gen_random_uuid(), $1, 'lead', 'leads', 'Lead', 'Leads', 'IconTargetArrow', false, true);

INSERT INTO core.fieldMetadata (objectMetadataId, type, name, label, ...)
VALUES
  ($1, 'TEXT', 'siren', 'SIREN', ...),
  ($1, 'TEXT', 'raisonSociale', 'Raison sociale', ...),
  ($1, 'TEXT', 'nafCode', 'Code NAF', ...),
  ($1, 'TEXT', 'sector', 'Secteur', ...),
  ($1, 'NUMBER', 'employeeCount', 'Effectif', ...),
  ($1, 'CURRENCY', 'revenue', 'CA', ...),
  ($1, 'EMAIL', 'primaryEmail', 'Email principal', ...),
  ($1, 'PHONE', 'primaryPhone', 'Téléphone', ...),
  ($1, 'ADDRESS', 'address', 'Adresse', ...),
  ($1, 'NUMBER', 'scoreTech', 'Score tech', ...),
  ($1, 'NUMBER', 'scoreOverall', 'Score global', ...),
  ($1, 'DATE_TIME', 'lastEnrichedAt', 'Dernier enrichissement', ...);
```

L'user peut ensuite ajouter des fields custom par-dessus (notes, tags, mon score perso, etc.) — c'est le coeur du méta-modèle.

## Estimation

- Backend module CRM : 3-4 jours
- Frontend port composants W7b refill-icp → React Twenty : 2-3 jours
- Route Prospection HMAC qualified-pull : 2 jours
- Seed Object Lead + tests : 1 jour
- **Total : ~1.5 semaine (1 agent backend + 1 agent frontend)**
