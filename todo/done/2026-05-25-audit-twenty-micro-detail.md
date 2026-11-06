# [P0] Audit détaillé repo Twenty avant fork — recherche & spec technique

> **Type** : Audit technique préalable fork
> **Sévérité** : 🔴 P0 — bloque le démarrage Vague 11 jusqu'à ce que cet audit soit livré et validé par Robert
> **Owner** : Agent dédié à spawner (Opus, recherche + lecture code)
> **Créé** : 2026-05-25 par team-lead
> **Décideur final** : Robert (brainstorm avec l'agent post-audit)

---

## Pourquoi ce ticket

L'audit Twenty fait dans `todo/2026-05-25-vision-customisation-crm-audit-twenty.md` reste **macro** (concepts, voies possibles, verdict licence). Avant qu'on fork pour de vrai dans la Vague 11, il faut **un audit micro** qui répond aux questions techniques précises qu'on aura à trancher pendant le sprint.

L'objectif : que Robert puisse **brainstormer avec l'agent** sur les détails d'implémentation avant qu'on engage 2 mois de boulot.

## Ce que l'agent doit faire

### Phase 1 — Clone + exploration

```bash
git clone https://github.com/twentyhq/twenty /tmp/twenty-audit
cd /tmp/twenty-audit
git log --oneline -20  # voir la roadmap récente
git tag | tail -10      # versions stables récentes
```

L'agent lit en profondeur :
- `packages/twenty-server/` (NestJS backend)
- `packages/twenty-front/` (React + Recoil frontend)
- `packages/twenty-shared/` + `twenty-ui/`
- `docker-compose.yml` (stack runtime)
- `.env.example` (config requise)
- `docs/` (doc dev)
- `CHANGELOG.md` (roadmap récente)

### Phase 2 — Questions micro auxquelles répondre

L'agent produit un fichier `AUDIT-TWENTY-REPONSES.md` dans `todo/customisable-crm/` qui répond précisément à :

#### Métadata layer
1. Comment Twenty stocke physiquement les rows custom : **1 table par Object** ou **table générique JSONB** ? Trace le DDL généré sur un Object custom créé via API.
2. Quand un user crée un Field (ex: nouveau "Priority" sur "Deal"), quelle est la **séquence DDL exacte** ? Combien de temps ça prend sur une table avec 100k rows ?
3. Les indexes sur les fields custom : auto-créés ou à demander ? Quelle stratégie ?

#### Multi-tenancy
4. Workspace = 1 schéma Postgres séparé `workspace_{uuid}` ou 1 row dans une table partagée avec `workspace_id` ?
5. Combien de workspaces Twenty supporte sur un seul Postgres (limites OS sur nombre de schémas) ?
6. Comment ils isolent les workers BullMQ par workspace (ou tous mélangés) ?

#### Auth
7. Le module `core-modules/auth/` est-il facile à remplacer par HMAC Hub (sans casser le reste) ? Quels callbacks doit-on hooker ?
8. Twenty supporte-t-il les magic-links ? Les sessions cross-app (cookie domain `.veridian.site`) ?
9. Le système `User` Twenty est-il compatible avec notre `hub_user_id` (UUID) ou il impose son propre schéma ?

#### Billing
10. Le module `core-modules/billing/` est-il monolithique ou modulaire (replace facile par Hub HMAC) ?
11. Quels événements Stripe Twenty utilise déjà (subscription.updated, etc.) ? Est-ce compatible avec notre Hub orchestrator ?

#### Email
12. Comment Twenty envoie un mail transactional (signup, password reset) ? Quel provider par défaut ?
13. Possible de remplacer par un client HTTP vers Notifuse via 1 fichier de service ?

#### Messaging (mail réception)
14. Twenty a son propre module messaging IMAP/Gmail/MS. Quelle est l'archi (cf brief Twenty IMAP qu'on avait fait) ?
15. Est-ce qu'on garde Twenty messaging tel quel ou on rip et on remplace par notre Mail Gateway Hub Veridian ?
16. Si on garde : impact AGPL sur Mail Gateway (Twenty module = AGPLv3, donc nos modifications doivent être publiées) ?

#### Workflows
17. Le module Workflows Twenty est en EE (Enterprise Edition) ou CE (Community) ? Si EE → on doit le recoder pour échapper à la licence commerciale.
18. Quelle est l'archi Workflow (trigger + condition + action) ? Comment c'est exécuté (sync ou async via BullMQ) ?
19. Possible d'ajouter notre propre action "Send via Notifuse" facilement ?

#### Frontend / UI
20. Stack frontend exact : React + Recoil ? Vite ou Webpack ? Composants reutilisables ?
21. Le UI builder (Object/Field/View configuration) est dans `twenty-front/src/modules/settings/` ? Quel est le composant principal ?
22. Le thème (couleurs, fontes) est centralisé ? Combien de fichiers à modifier pour rebrand visuel Veridian ?

#### Tests
23. Twenty a-t-il une suite E2E ? Quelle lib (Playwright / Cypress) ? Coverage ?
24. Comment on hooke nos propres tests E2E hard-core sur le fork ?

#### Déploiement
25. Stack runtime exacte : compose Docker ? Node version ? Postgres version ? Redis ?
26. Quelle taille machine minimum (RAM/CPU) pour staging + prod ?
27. Logs structurés (JSON Pino) ou texte ? Compatible avec Grafana Cloud Veridian ?

#### Licences enterprise edition
28. Quelles features EE sont les plus précieuses pour nous (SSO, RBAC, audit logs, workflows) ?
29. Coût estimé licence EE OEM pour rebrand commercial (si Twenty Inc. propose) ?
30. Si on dev nos features EE-like en interne, lesquelles coûtent le plus cher en dev ?

### Phase 3 — Recommandations actionables

L'agent finit avec **3 recommandations chiffrées** :

1. **Quelles parties du fork on garde tel quel** (UI builder, méta-modèle DDL, GraphQL recomputed, etc.)
2. **Quelles parties on rip et remplace** (auth, billing, email, messaging) avec effort estimé chacune
3. **Quelles parties on évite de toucher** (à cause du risque de casser le upstream merge futur)

### Phase 4 — Risques et mitigation

L'agent liste les **risques majeurs** avec mitigation :
- Breaking changes upstream Twenty qui nous obligent à re-merger souvent
- Codebase 100k+ lignes TS/NestJS — comment on apprend efficacement
- Dette technique cachée (issues GitHub critiques, hot fixes récents)
- Roadmap Twenty Inc. — pivot possible ? Acquisition ?

## Output attendu

Un seul fichier markdown : `todo/customisable-crm/AUDIT-TWENTY-REPONSES.md` qui répond aux 30+ questions ci-dessus, avec :
- Citations directes du code Twenty (lien GitHub à la ligne)
- Estimations effort en jours-humain
- Recommandations claires et chiffrées
- Section "à brainstormer avec Robert" pour les décisions stratégiques

## Règles dures

1. **PAS de code** côté Veridian repo
2. **Lecture profonde** du repo Twenty cloné en local, pas juste web
3. **Sois critique** : si tu trouves des trucs douteux dans Twenty (sécurité, perf, dette), DIS-LE
4. **Sois honnête** sur l'effort réel d'adaptation Veridian — pas de bullshit "ça sera rapide"
5. Output **dans le dossier `customisable-crm/`** uniquement, pas ailleurs

## Estimation

~1-2h de recherche profonde par l'agent dédié. Robert pourra ensuite brainstormer avec l'agent en lui posant des questions de suivi.

## Pré-requis pour démarrer

- [ ] Robert ouvre une nouvelle session
- [ ] Robert dit "spawn l'agent audit Twenty détaillé" → team-lead spawn 1 agent Opus avec ce ticket comme brief
- [ ] Agent travaille ~1-2h en background
- [ ] Robert lit l'output et brainstorme avec l'agent (SendMessage)
- [ ] Décision finale : on fork ou on revient à une voie alternative ?
