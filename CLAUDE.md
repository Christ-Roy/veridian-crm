# CLAUDE.md — Veridian CRM

> ## 🔴 Règle d'or Veridian — zéro contournement (gravée Robert 2026-06-10)
> **Interdit absolu** : cron bricolé, SQLite/store parallèle, job maison pour
> ÉVITER l'API ou la DB réelle de l'app. On travaille AVEC le vrai système :
> coder propre → tester staging → fixer la logique → MAJ DB staging si besoin
> → test lourd → push prod. Un blocage (accès, credential) se débloque via le
> lead, il ne se contourne pas. Détail : CLAUDE.md racine veridian-platform.


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

## 4. Identité : le Hub seul (décision Robert, 06/11/2026)

Le Hub est la seule source des utilisateurs : Twenty ne connaît ni inscription directe, ni mot de passe
client, ni changement d'email ou de nom hors Hub, ni invitation interne. Les tables `core` sont des copies
alimentées par `core-modules/veridian-hub-sso/`, identifiées par `hub_user_id` (= `hub_app.users.supabase_user_id`).
Détail des routes : `VERIDIAN-PATCHES.md`. Historique de la décision précédente : `docs/claude/01-historique-identite.md`.

## 5. Conventions de travail agent

### Trunk-based sur `staging` — pas de PR, pas de branche feature

Cf `veridian-platform/CLAUDE.md` §"Règle d'or : trunk-based sur staging".

- Tu travailles **direct sur `staging`** (`git push origin staging`)
- Tu ne crées **PAS** de branche feature
- Tu n'ouvres **PAS** de PR
- Auto-promotion `staging` → `main` après smoke staging vert

### Chaîne CI + déploiement

Le CRM a été décommissionné le 23/09/2026, puis remonté en staging sur v2.56.1 le 06/11/2026.

```
push staging → veridian-crm-ci.yaml, sur nos runners (veridian-jit, aucun runner hébergé)
  garde-legale → patch-survival → image ghcr.io/christ-roy/veridian-crm:staging-<sha7>
déploiement : bump du tag dans ~/nomad-veridian/jobs/saas-staging/crm-staging.nomad.hcl,
  commit, nomad-v deploy. Staging sur banc Tailscale. Pas de prod tant que les serveurs ne sont pas là.
```

Registre du fork et procédure de sync : `VERIDIAN-PATCHES.md`. Contrôle réseau : `scripts/ci/capture-sortante.sh`.

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
