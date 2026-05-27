# Déployer Twenty fork sur staging (crm.staging.veridian.site)

> **Sévérité** : 🔴 P0
> **Owner** : agent veridian-crm (vague 2 infra)
> **Créé** : 2026-05-27
> **Dépend de** : commit `eb4c2df` (patch workspaces + CI verte) — ✅ fait

## Objectif

Avoir une URL `https://crm.staging.veridian.site` (et subdomain wildcard `*.crm.staging.veridian.site`) où Robert peut cliquer et voir Twenty fork tourner avec :

- Multi-workspace activé
- Billing désactivé
- Signup public bloqué (redirect Traefik vers Hub)
- Image buildée depuis le fork (pas l'image upstream `twentycrm/twenty`)
- SMTP Lark Veridian branché
- Postgres + Redis dédiés au CRM

## Contexte stratégique

### Pivot 2026-05-27 (gravé par Robert)

Twenty CRM **est intégré au Hub avec souplesse via API native**, pas en standalone strict comme prévu le 2026-05-26.

**Pattern API-bridge maigre** :
- Hub initie tout signup CRM via mutation GraphQL Twenty `signUpInNewWorkspace`
- Hub stocke `tenant.twentyWorkspaceId` + `tenant.twentyApiKey` dans sa DB
- Magic link auto-login via GraphQL Twenty `emailPasswordResetSession` (ou équivalent)
- **Pas** de contrat HMAC strict, pas de provisioning Hub→CRM via 9 endpoints obligatoires
- Hub appelle simplement l'API REST/GraphQL Twenty native avec une Bearer API key admin

### Use case immédiat Robert

> "Je vais créer avec toi via api les tenants de notre stack et je vais
> leur faire un travail sur mesure de création de tenant crm avec les
> bonnes data, et leur mettre des prospects qualifiés dans leur crm à la
> main."

Donc : pas de UI dashboard self-service en vague 1. Robert provision les tenants manuellement via une route admin Hub (voir ticket suivant `2026-05-27-hub-route-create-crm-tenant.md`), puis utilise l'API REST Twenty pour pousser de la data custom.

### Suite à terme (hors scope vague 2)

- Carte dashboard Hub "Veridian CRM" self-service (vague 3)
- Webhook `tenant.created` Twenty → Hub (belt-and-suspenders)
- Rebrand visuel (logo, nom, couleurs, footer AGPL)
- Lifecycle complet (suspend/resume/delete)

Ces points sont des tickets séparés à créer au fur et à mesure.

## Tâches

### 1. Dockerfile fork Veridian CRM

Créer `Dockerfile.veridian` à la racine du repo (NE PAS toucher au `Dockerfile` Twenty upstream existant qui sert peut-être à autre chose).

Multi-stage :
- Stage 1 : build avec `node:24.5-alpine` + yarn 4.13.0 + `yarn workspaces focus twenty-server twenty-front`
- Stage 2 : runtime minimal avec `node:24.5-alpine`, copy build artifacts, expose 3000

Référence : regarder le `Dockerfile` ou `packages/twenty-docker/Dockerfile` existant dans le fork pour réutiliser ce qui marche, mais en évitant les surprises EE.

### 2. Workflow GH Actions build + push image GHCR

Créer `.github/workflows/veridian-crm-build-image.yaml` :

- Trigger : push sur `staging` ET `main`
- Build l'image via `Dockerfile.veridian`
- Push sur `ghcr.io/christ-roy/veridian-crm:staging` (sur push staging) et `:latest` + `:<sha>` (sur push main)
- Auth GHCR via `GITHUB_TOKEN` (permissions packages:write)
- Cache layer Docker via buildx pour speed up
- **Ne PAS exécuter ce workflow en même temps que `veridian-crm-ci.yaml`** : le CI tourne déjà sur les mêmes pushes. Possibilité : faire que le build-image n'attaque qu'après que le CI soit vert (job `needs:` ou workflow_run trigger).

### 3. Compose Dokploy adapté

Récupérer le compose archive : `~/Bureau/dokploy-infra/prod/twenty.yml` + variant `migration-bundle/twenty.yml` (qui a déjà `IS_MULTIWORKSPACE_ENABLED=true` + `IS_BILLING_ENABLED=false`).

Créer dans le repo : `infra/dokploy/staging/docker-compose.yml`.

Adaptations :

- Image `twentycrm/twenty:v1.16.7` → `ghcr.io/christ-roy/veridian-crm:staging` (4 occurrences : server + worker)
- Domaine `twenty.app.veridian.site` → `crm.staging.veridian.site`
- ENV ajoutées :
  - `IS_MULTIWORKSPACE_ENABLED=true`
  - `IS_BILLING_ENABLED=false`
  - `IS_FREE_ACCESS_ENABLED=true` (skip onboarding wizard)
  - `DEFAULT_SUBDOMAIN=app`
- ENV à retirer :
  - `BILLING_STRIPE_API_KEY` (puisque billing off)
  - `BILLING_STRIPE_WEBHOOK_SECRET` (idem)
- Volumes : nommer en `crm-staging-*` (départ propre, ne pas réutiliser les volumes legacy `infra_twenty-*` qui traînent sur le VPS)
- Labels Traefik wildcard : `Host(\`crm.staging.veridian.site\`) || HostRegexp(\`^[a-z0-9-]+\.crm\.staging\.veridian\.site$\`)`
- Network : staging-edge externe (cohérent avec convention staging des autres apps)

### 4. DNS Cloudflare wildcard

Pas via Robert — l'agent a accès `CF_API_TOKEN` dans `~/credentials/.all-creds.env`. Créer 2 records :

- `crm.staging.veridian.site` → IP dev (`37.187.199.185`) — A record proxied=false
- `*.crm.staging.veridian.site` → CNAME vers `crm.staging.veridian.site`

**Important** : staging tourne sur le dev server (`dev-pub`, `37.187.199.185`), PAS sur la prod (cf `veridian-platform/CLAUDE.md` "Staging — dev server dédié"). Vérifier ce point avant de poser les DNS.

### 5. Bloquer signup public Twenty via redirect Traefik

Reprendre exactement le pattern de `~/Bureau/dokploy-infra/prod/migration-bundle/twenty-wildcard-prod.yml` :

```yaml
labels:
  - "traefik.http.routers.crm-welcome-redirect.rule=Host(`crm.staging.veridian.site`) && Path(`/welcome`)"
  - "traefik.http.routers.crm-welcome-redirect.priority=100"
  - "traefik.http.middlewares.crm-redirect-signup.redirectregex.regex=.*"
  - "traefik.http.middlewares.crm-redirect-signup.redirectregex.replacement=https://hub.staging.veridian.site/signup"
  - "traefik.http.middlewares.crm-redirect-signup.redirectregex.permanent=true"
```

Ne pas se contenter du redirect Traefik : si un agent ou un client devine l'URL de la GraphQL mutation `signUp`, il peut bypass. Voir tâche 6 pour le guard AGPL.

### 6. (OPTIONNEL vague 2 — peut être différé vague 3) Guard AGPL signup

Sur `packages/twenty-server/src/engine/core-modules/auth/services/sign-in-up.service.ts` (AGPL, on a déjà patché ce fichier — vérifier header), ajouter un guard simple :

```typescript
// Au début de signUp et signUpInNewWorkspace, si VERIDIAN_HUB_ONLY=true :
const hubToken = req.headers['x-veridian-hub-token'];
if (process.env.VERIDIAN_HUB_ONLY === 'true' && hubToken !== process.env.VERIDIAN_HUB_API_TOKEN) {
  throw new AuthException('Signup must go through Hub', AuthExceptionCode.FORBIDDEN_EXCEPTION);
}
```

Décision : reporter en vague 3 si la complexité d'extraire le header dans la couche service est trop forte (probable — c'est NestJS GraphQL, le `req` n'est pas trivialement accessible). Pour la vague 2, on se contente du redirect Traefik comme défense périmétrique.

### 7. Déploiement Dokploy

Soit :
- (a) Créer un nouveau compose Dokploy via API (`POST /api/compose.create`) puis pointer son source sur le repo GitHub `veridian-crm` path `infra/dokploy/staging/`
- (b) SSH dev-pub et `docker compose up -d` manuellement dans `~/services/veridian-crm/` (plus rapide pour staging)

Recommandation : (b) pour la vague 2 (rapidité), (a) pour la prod plus tard (mode GitOps).

L'agent peut SSH dev-pub : `ssh dev-pub`. Token Dokploy dans `~/credentials/.all-creds.env` si l'agent choisit (a).

### 8. Smoke + URL livrée à Robert

À la fin, l'agent doit :

- `curl -sI https://crm.staging.veridian.site/healthz` ou `/api/health` → 200
- `curl -sI https://crm.staging.veridian.site` → 200 ou 301 vers `/login` (selon le routing Twenty)
- `curl -sI https://crm.staging.veridian.site/welcome` → 301 vers `https://hub.staging.veridian.site/signup`
- Ouvrir l'URL dans un Chrome MCP et screenshot la page de login Twenty pour Robert
- Retourner dans le rapport final : **l'URL exacte à cliquer** + screenshot

## Livrables

1. `Dockerfile.veridian` à la racine
2. `.github/workflows/veridian-crm-build-image.yaml`
3. `infra/dokploy/staging/docker-compose.yml`
4. DNS Cloudflare créés (2 records)
5. Image `ghcr.io/christ-roy/veridian-crm:staging` pushée sur GHCR
6. Stack démarrée sur dev-pub
7. URL staging livrée à Robert avec screenshot
8. Commit sur `staging` (trunk-based, pas de PR)

## Garde-fous

- **NE PAS toucher** au `Dockerfile` Twenty upstream existant (si présent) — créer `Dockerfile.veridian` à côté
- **NE PAS toucher** aux 300 fichiers `@license Enterprise` (vérifier `head -3` avant chaque edit)
- **NE PAS réutiliser** les volumes legacy `infra_twenty-*` sur la prod (départ propre, nouveaux volumes nommés `crm-staging-*`)
- **NE PAS déployer en prod** dans cette vague — staging only, sur dev-pub
- **NE PAS créer** de branche feature, pas de PR — trunk-based sur `staging`

## Non-objectifs (à NE PAS faire dans cette vague)

- ❌ Rebrand visuel (logo, couleurs, copy) — vague 3
- ❌ Carte dashboard Hub self-service — vague 3
- ❌ Webhook Twenty→Hub `tenant.created` — vague 3
- ❌ Guard AGPL signup-via-Hub-only — vague 3 (Traefik redirect suffit en vague 2)
- ❌ Désactiver le module Billing dans le code (ENV suffit)
- ❌ Setup admin Robert dans la DB — pas besoin tant que Robert utilise l'API via Hub
- ❌ Déploiement prod — viendra quand le staging sera stable
