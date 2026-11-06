# 07 — Décomposition giga-sprint Vague 11

> Plan d'attaque parallèle avec N agents Opus pour livrer le MVP CRM en ~1.5-2 mois.

## Découpage 4 vagues

### Vague 11.1 — Setup + Rebrand (semaine 1)

Effort total : ~5 jours, **3-4 agents en parallèle**

| Agent | Mission |
|---|---|
| A | Fork twentyhq/twenty → Christ-Roy/veridian-crm + nettoyer history |
| B | Rebrand visuel (logo, favicon, couleurs OKLCH Veridian) cf `02-rebrand-checklist.md` |
| C | Rebrand textuel (search/replace global "Twenty" → "Veridian CRM") |
| D | Setup local-dev + valider build local fonctionne |

Gate : `pnpm dev` lance Twenty en local sans aucune mention "Twenty" visible.

### Vague 11.2 — Intégrations Hub + Stack Veridian (semaines 2-3)

Effort total : ~2 semaines, **4 agents en parallèle**

| Agent | Mission |
|---|---|
| E | Auth Hub via HMAC cf `03-integration-hub-auth.md` |
| F | Billing Hub via HMAC cf `03-integration-hub-auth.md` |
| G | Email transactional via Notifuse cf `05-module-notifuse-mail.md` |
| H | File storage R2 (remplace S3 Twenty) |

Gate : un user Hub peut signin sur CRM via magic-link, créer un workspace, voir sa facturation Hub, recevoir un mail welcome via Notifuse.

### Vague 11.3 — Modules Veridian (semaines 4-5)

Effort total : ~2 semaines, **3 agents en parallèle**

| Agent | Mission |
|---|---|
| I | Module veridian-leads backend + GraphQL cf `04-module-leads-b2b.md` |
| J | Module veridian-leads frontend (port composants W7b → React Twenty) |
| K | Route Prospection `qualified-pull` (côté Prospection repo) |

Gate : un user CRM clique "Importer leads B2B FR" → filtre par secteur Tech → reçoit 50 leads dans son Object "Lead" du workspace.

### Vague 11.4 — Déploiement + Validation (semaine 6)

Effort total : ~1 semaine, **3 agents en parallèle**

| Agent | Mission |
|---|---|
| L | Compose Dokploy + Traefik + CI/CD cf `06-deploiement-infra.md` |
| M | Backup DB + monitoring + healthcheck |
| N | Mega battery E2E hard-core ≥ 50 specs cross-features |

Gate : `crm.staging.veridian.site` UP, smoke 200, signin OK, workspace créé, leads importés, mail envoyé via Notifuse, monitoring vert.

### Vague 11.5 — Bonus : Vente du 1er client consulting (semaine 7-8)

Effort total : ~2 semaines, **1 agent (toi en commercial) + 1 agent dev support**

- Démarcher 3-5 prospects
- 1er client signé → setup custom 2-5k€
- Agent dev : customisation spécifique client (Object custom, fields, vues, workflows)

Gate : 1 client paye 2k€+ et utilise le CRM en prod.

## Effort total estimé

| Vague | Effort | Agents parallèles |
|---|---|---|
| 11.1 Setup + Rebrand | 1 sem | 3-4 |
| 11.2 Intégrations Hub | 2 sem | 4 |
| 11.3 Modules Veridian | 2 sem | 3 |
| 11.4 Déploiement | 1 sem | 3 |
| 11.5 Premier client | 2 sem | 1-2 |
| **TOTAL** | **~8 sem** (~2 mois) | **~14 agents cumul** |

## Préalables avant attaque

- [ ] Promo prod Vague 9 + 10 Prospection (focus actuel)
- [ ] Audit légal AGPL 500-1000€ ou décision Robert d'attaquer sans (risque assumé)
- [ ] 2-3 prospects identifiés pour la Vague 11.5 (peut être Robert lui-même + 1 client existant)
- [ ] Décision sur le timing : enchaîner après promo Prosp ou pause de 2-4 semaines pour consolider ?

## Mode opérationnel

Sur ce nouveau projet, on adapte le skill `team-lead-vagues` :
- Worktrees git **dans le nouveau repo** `veridian-crm` (pas dans veridian-prospection)
- Migrations Prisma → ici migrations Twenty (`yarn database:migrate`)
- Mega battery E2E → à coder from scratch dans le repo CRM
- Auto-promote staging→main : à câbler comme pour les autres apps Veridian (§20 CI-ARCHITECTURE)
