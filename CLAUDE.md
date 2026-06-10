# CLAUDE.md — Veridian CRM

> **Ce repo est un fork de `twentyhq/twenty` rebrandé Veridian CRM.**
>
> Pour les directives techniques Twenty (commandes Nx, conventions tests, lint,
> Storybook, archi NestJS), lire **`CLAUDE-TWENTY.md`** dans ce même dossier — il
> reste la source de vérité pour le **comment ça tourne** côté Twenty upstream.
>
> Ce fichier-ci grave les **règles Veridian** : licence, périmètre de travail,
> intégrations cross-app, conventions agent. Il a **priorité** sur
> `CLAUDE-TWENTY.md` en cas de conflit.

---

## 1. Contexte produit

Veridian CRM est l'app **CRM customisable** de la suite Veridian. Elle vient en
complément de `veridian-prospection` (cold outbound) et vise les clients qui
ont besoin d'un CRM méta-modélisé (Object/Field/View dynamiques en DB).

Stratégie produit (décidée 2026-05-25, gravée dans `docs/spec/00-VISION.md`) :

- 2 produits séparés (Prospection cold + CRM customisable)
- Fork de Twenty (AGPLv3) + rebrand strict (trademark "Twenty" déposé, on ne le
  garde nulle part dans l'UI)
- Migration progressive des features Prospection → CRM (pas de big bang)
- Moat Veridian = data (996K leads B2B) + service consulting + intégration
  cross-app, **pas** le code

## 2. Licence — règles absolues

### 🔴 LE PIÈGE PRINCIPAL : les 300 fichiers `/* @license Enterprise */`

Twenty est **dual-licensé fichier par fichier** :

- Par défaut → **AGPLv3** (on peut modifier librement, à condition de publier
  nos modifs)
- **Fichiers marqués `/* @license Enterprise */` en tête → licence commerciale
  Twenty Labs**. On a le droit de les LIRE (ils sont publics sur GitHub) mais
  PAS de les modifier ni de les redistribuer activés.

**Liste des features EE** (300 fichiers, cf `docs/spec/AUDIT-LIMITE-EE-TWENTY.md`) :
SSO/SAML, custom domains Cloudflare, Row-Level Security (RLS), JWT key rotation,
billing v2, audit logs, module `enterprise/` complet.

**Règle de travail** :

1. **Ne jamais modifier** un fichier qui commence par `/* @license Enterprise */`.
2. **Ne jamais patcher** le check `enterprisePlanService.isValid()` pour
   débloquer une feature EE — c'est de la contrefaçon.
3. Si un client demande une feature EE → **réimplémentation clean room** dans
   un fichier neuf sous AGPL Veridian, jamais en copiant du code EE.
4. Les fichiers EE peuvent être **laissés inactifs** dans le repo (le check
   `isValid()` retournera toujours `false` sans clé EE) ou **supprimés** si on
   préfère un repo plus léger.

### Modifs Veridian autorisées

- ✅ `MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY = Number.MAX_SAFE_INTEGER`
  (la limite des 5 workspaces est dans du code AGPL, pas EE)
- ✅ Rebrand UI complet (logo, nom, couleurs, copy, emails)
- ✅ Suppression / désactivation des packages non utilisés
- ✅ Ajout de modules custom Veridian dans :
  - `packages/twenty-server/src/modules/veridian-*/`
  - `packages/twenty-front/src/modules/veridian-*/`
- ✅ Intégrations cross-app (Hub auth, Prospection leads, Notifuse emails)

### Obligations AGPL — non négociables

- Publier le code source de notre fork (accessible aux utilisateurs SaaS via
  un lien "Source code" en footer)
- Garder le copyright `Twenty.com PBC` dans tous les fichiers d'origine
- Indiquer clairement que c'est un fork modifié (README + footer SaaS)
- Nos propres ajouts (`veridian-*/`) sont eux aussi sous AGPLv3

## 3. Périmètre de travail — packages

### Packages **actifs** (qu'on modifie)

| Package | Rôle | Notes |
|---|---|---|
| `twenty-server` | Backend NestJS (API GraphQL, auth, DB) | Cœur produit |
| `twenty-front` | Frontend React (l'app web client) | À rebrand visuellement |
| `twenty-shared` | Types + utils partagés front/server | Dep des 2 ci-dessus |
| `twenty-ui` | Design system | À rebrand progressivement (couleurs, typo) |
| `twenty-emails` | Templates React Email | Probablement à remplacer par appels Notifuse |
| `twenty-front-component-renderer` | Rendu dynamique de composants | Dep front |

### Packages **ignorés** (ne pas modifier — supprimables jour J)

`twenty-docs`, `twenty-website`, `twenty-apps`, `twenty-sdk`, `twenty-client-sdk`,
`twenty-companion`, `twenty-e2e-testing`, `twenty-zapier`, `twenty-claude-skills`,
`twenty-oxlint-rules`, `twenty-cli`, `create-twenty-app`, `twenty-utils`.

Ces packages sont liés au produit Twenty officiel (docs, marketing site, bot
Discord, marketplace Zapier, etc.). Ils ne servent pas Veridian. Tant qu'on
n'a pas confirmé qu'ils sont 100% retirables sans casser le build, on les
laisse intacts.

### Cas spécial : `twenty-docker`

Garder, mais **adapter** : c'est notre point de départ pour notre propre
compose Veridian CRM (deploy via Dokploy + Traefik prod).

## 4. Stratégie — Twenty standalone, pas d'intégration Hub

**Décision Robert 2026-05-26** : Veridian CRM tourne en **standalone**, sans
intégration au contrat Hub. Pas de HMAC m2m, pas de provisioning Hub→CRM, pas
d'`update-plan` webhook, pas de `magic-link` cross-app, pas d'audit log GDPR
maison, pas de SSO/SAML clean room.

**Raison** : Twenty est conçu pour tourner seul. Il a son propre login
(email+password + Google OAuth + Microsoft OAuth), son propre admin panel,
ses propres magic links internes (via `AppToken`), son propre billing
(qu'on désactive parce qu'on facture autrement), son propre subdomain par
workspace. Forcer Twenty à se plier au contrat Hub coûterait ~150h-agent
pour un gain quasi nul à ce stade. On garde Twenty natif.

**Conséquence sur l'archi** :

- L'utilisateur s'inscrit/se logge **directement** sur le CRM Veridian
  (`crm.veridian.site` ou subdomain par client)
- Pas d'auth bouncée depuis le Hub
- Pas de tenant provisionné par le Hub
- Le billing client = via le canal Veridian habituel (Stripe direct ou
  facturation manuelle pour les premiers clients consulting), mais **pas
  via le module billing Twenty interne** (qui est 100% EE)

Les audits `docs/spec/AUDIT-CONFORMITE-HUB.md` et `AUDIT-TWENTY-MICRO.md`
restent en archive comme **référence si un jour la stratégie évolue**, pas
comme spec à implémenter.

### Si Robert pivote (futur)

Si un jour l'intégration Hub redevient nécessaire (genre Phase 2 quand le
CRM aura 5+ clients), réexhumer `AUDIT-CONFORMITE-HUB.md` qui contient le
plan détaillé (~115-150h-agent, 10 lots L1→L10).

## 5. Conventions de travail agent

### Trunk-based sur `staging` — pas de PR, pas de branche feature

Cf `veridian-platform/CLAUDE.md` §"Règle d'or : trunk-based sur staging".

- Tu travailles **direct sur `staging`** (`git push origin staging`)
- Tu ne crées **PAS** de branche feature
- Tu n'ouvres **PAS** de PR
- Auto-promotion `staging` → `main` après smoke staging vert

### Chaîne CI (état 2026-06-10)

```
push staging
  → veridian-crm-ci.yaml        (tests unitaires patches Veridian + typecheck)
  → veridian-crm-build-image    (GHCR :staging + :staging-<sha7>, si CI verte)
  → veridian-crm-staging-deploy (SSH dev-pub, compose pull/up, smoke healthz + /metadata)
promotion main (ff)
  → veridian-crm-ci + build-image (:latest + :<sha7>, l'ancienne :latest
    est re-taggée :rollback AVANT d'être écrasée) + Trivy scan (rapport)
  → Dokploy autoDeploy (webhook push main) — ⚠️ se déclenche AVANT la fin du
    build :latest (~30 min) → re-déclencher POST /api/compose.deploy
    (composeId 8zdqAAD1lkZFVAwuZ5USv) une fois l'image pushée, sinon la prod
    tourne sur l'ancienne :latest. Vérifier le digest du container après.
```

**Rollback prod** : `ghcr.io/christ-roy/veridian-crm:rollback` = la :latest
précédente. Procédure : éditer l'image du compose en `:rollback` (compose.update)
+ compose.deploy, ou `docker pull :rollback && docker tag` côté serveur.

### Hooks git versionnés (`.githooks/`)

`git config core.hooksPath .githooks` (à faire une fois par clone — déjà fait
sur le repo local). Le `pre-push` refuse : modification d'un fichier
`@license Enterprise` (contrefaçon), push d'une branche hors staging/main,
secrets évidents dans le diff. Pas de husky : pas de `node_modules` en local
(machine saturée), la batterie complète tourne en CI.

### Un agent par app, pas de cross-touch

Tu es l'agent **veridian-crm**. Tu touches **uniquement** ce repo. Si tu vois
un fix évident dans `veridian-hub`, `veridian-prospection`, `veridian-cms`,
`notifuse-veridian`, `veridian-analytics`, `veridian-infra` → **tu ne touches
pas**. Tu déposes un ticket dans le `todo/` du repo cible et tu préviens
Robert.

### Convention `todo/`

Ce repo a un dossier `todo/` à sa racine :

```
todo/
├── YYYY-MM-DD-<slug>.md   ← ticket actif (à la racine)
├── README.md               ← index
├── done/                   ← archive
└── blocked/  (optionnel)   ← en attente externe
```

Au début de chaque session, vérifier `todo/` — c'est ta file d'attente.

## 6. Spec produit Veridian

Toute la spec produit Veridian (décisions Robert, archi cible, sprint
decomposition, intégrations) vit dans `docs/spec/` :

- `00-VISION.md` — vision produit finale (décisions Robert verrouillées)
- `01-archi-meta-modele.md` — archi Twenty + adaptations Veridian
- `02-rebrand-checklist.md` — checklist rebrand strict
- `03-integration-hub-auth.md` — intégration Hub auth
- `04-module-leads-b2b.md` — pull leads depuis Prospection
- `05-module-notifuse-mail.md` — push campagnes vers Notifuse
- `06-deploiement-infra.md` — Dokploy + Traefik + CI/CD
- `07-sprint-decomposition.md` — Vague 11.1-11.5 (~8 semaines, ~14 agents cumul)
- `08-questions-ouvertes.md` — questions à trancher avec Robert
- `AUDIT-TWENTY-DETAIL-P0.md` — 30+ questions techniques d'audit micro
- `AUDIT-LIMITE-EE-TWENTY.md` — cadre légal AGPL/EE (à lire avant tout)

## 7. État au 2026-05-26

- ✅ Fork cloné (`Christ-Roy/veridian-crm`, commit Twenty `1188ea9c`)
- ✅ Branche `staging` créée (trunk-based)
- ✅ Audit légal AGPL livré (`docs/spec/AUDIT-LIMITE-EE-TWENTY.md`)
- ✅ Audit conformité Hub livré (`docs/spec/AUDIT-CONFORMITE-HUB.md`) — **archivé**, stratégie pivotée standalone
- ✅ Audit Twenty micro livré (`docs/spec/AUDIT-TWENTY-MICRO.md`)
- ✅ Limite 5 workspaces patchée (`MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY = Number.MAX_SAFE_INTEGER`)
- ⏳ **Ticket P0 actif** : `todo/2026-05-26-faire-sauter-verrous-twenty.md`
  - Inventorier les callsites `enterprisePlanService.isValid()` AGPL
  - Neutraliser le gating pour les features utiles
  - Désactiver le billing Twenty (proprement, sans toucher au code EE)
  - Setup admin Robert (`canAccessFullAdminPanel = true`)
  - Activer mode multi-workspace (`IS_MULTIWORKSPACE_ENABLED=true`)
