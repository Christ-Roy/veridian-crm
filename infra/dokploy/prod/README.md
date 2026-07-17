# Veridian CRM — prod deploy (Dokploy GitOps)

> ⚠️ OBSOLÈTE (Dokploy décommissionné 2026-07-10) → déploiement = nomad-v / skill /nomad. Bloc historique.
>
> Le déploiement prod du CRM passe désormais par le cluster HashiCorp Nomad :
> job `crm` dans `~/nomad-veridian/jobs/saas-prod/crm.nomad.hcl`, piloté par
> `nomad-v` (`nomad-v deploy`, `nomad-v state`, `nomad-v logs crm`) + skill
> `/nomad`. Le `docker-compose.yml` de ce dossier et la procédure ci-dessous
> (compose Dokploy, composeId, webhook autoDeploy) ne sont plus opérants — ils
> restent ici comme référence historique. Ne RIEN exécuter tel quel.

> Stack prod Twenty fork sur VPS OVH (51.210.7.44), exposée sur
> `https://crm.app.veridian.site` via Traefik Dokploy.

## Composition

- `crm-postgres` : Postgres 15-alpine, volume `crm-prod-db-data`, mem_limit 2G
- `crm-redis` : Redis 7-alpine, volume `crm-prod-redis-data`, mem_limit 256M
- `crm-server` : Twenty server image fork `ghcr.io/christ-roy/veridian-crm:latest`, mem_limit 2G
- `crm-worker` : Twenty worker BullMQ + crons, mem_limit 1G

Total RAM réservée : ~5.3G hard limits / ~1G soft reservations.

## Mode de déploiement

**GitOps via Dokploy** : compose branché sur `Christ-Roy/veridian-crm`
branche `main`, path `infra/dokploy/prod/`. Auto-deploy à chaque push
sur `main` (webhook GitHub → Dokploy → rebuild).

ComposeId Dokploy : `8zdqAAD1lkZFVAwuZ5USv` (réutilisé depuis l'ancien
`twenty-prod` orphelin du 2026-05-18 — même slot, nouveau contenu).

## Premier déploiement (départ propre)

### 1. Côté Dokploy UI / API

1. Compose `8zdqAAD1lkZFVAwuZ5USv` → reset config :
   - Source : `git` (au lieu de `raw`)
   - Repository : `Christ-Roy/veridian-crm`
   - Branch : `main`
   - Compose path : `./infra/dokploy/prod/docker-compose.yml`
   - Auto deploy : enabled
2. ENV (Dokploy compose env) :
   - `POSTGRES_PASSWORD` = `$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)`
   - `TWENTY_APP_SECRET` = `$(openssl rand -base64 64 | tr -d '/+=' | cut -c1-64)`
   - `SMTP_HOST` = `smtp.larksuite.com`
   - `SMTP_PORT` = `465`
   - `SMTP_USER` = `robert.brunon@veridian.site`
   - `SMTP_PASS` = depuis `~/credentials/.all-creds.env`
   - `SMTP_ADMIN_EMAIL` = `robert.brunon@veridian.site`
   - `SMTP_SENDER_NAME` = `Veridian CRM`
3. Déployer (Dokploy redeploy ou push sur main)

### 2. ⚠️ Init DB au premier boot

Comme staging : l'entrypoint Twenty détecte mal une DB vierge. Procédure :

```bash
ssh prod-pub
# Attendre que postgres soit healthy
until docker exec compose-parse-optical-array-lvh5md-crm-postgres-1 pg_isready -U twenty >/dev/null 2>&1; do sleep 2; done

# Migrations Twenty (forced une fois)
docker exec compose-parse-optical-array-lvh5md-crm-server-1 yarn database:init:prod

# Restart server pour clear le state
docker restart compose-parse-optical-array-lvh5md-crm-server-1

# Attendre que ça remonte
until curl -sf https://crm.app.veridian.site/healthz >/dev/null 2>&1; do sleep 3; done

echo "✅ Prod prête"
```

⚠️ Les noms exacts des containers (`compose-parse-optical-array-...`)
dépendent du `appName` Dokploy. Vérifier avec `docker ps | grep crm`.

### 3. Vérifications smoke

```bash
# /healthz doit retourner {"status":"ok"...}
curl https://crm.app.veridian.site/healthz

# /graphql doit retourner une erreur GraphQL parseable
curl -X POST https://crm.app.veridian.site/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __typename }"}'

# /metadata doit accepter une mutation signUpInWorkspace
curl -X POST https://crm.app.veridian.site/metadata \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { signUpInWorkspace(email:\"smoke@veridian.site\",password:\"test12345678\") { workspace { id } } }"}'

# /welcome doit rediriger vers Hub
curl -sI https://crm.app.veridian.site/welcome | grep -i location
# → location: https://app.veridian.site/signup

# Logs server : aucune erreur "does not exist"
docker logs --tail=200 compose-parse-optical-array-lvh5md-crm-server-1 | grep -c "does not exist"
# → doit retourner 0
```

## Update normal

Push sur `main` du repo `Christ-Roy/veridian-crm` :
1. Workflow `veridian-crm-build-image.yaml` build et push `:latest` GHCR
2. Webhook Dokploy détecte le push main → redeploy auto compose prod
3. Twenty fait ses migrations incrémentales au boot via entrypoint
4. ✅ Pas besoin de relancer manuellement `database:init:prod`

## Rollback

```bash
# Option 1 : revert le commit qui pose problème + push main
git revert <bad-sha>
git push origin main
# → Dokploy redeploy automatique

# Option 2 : pointer une image GHCR plus ancienne via Dokploy ENV
# Éditer le compose pour pinner ghcr.io/christ-roy/veridian-crm:<previous-sha>
```

## Endpoints

| URL | Comportement |
|---|---|
| `https://crm.app.veridian.site/` | HTML Twenty front |
| `https://crm.app.veridian.site/healthz` | Health (200 OK) |
| `https://crm.app.veridian.site/graphql` | API GraphQL workspace data |
| `https://crm.app.veridian.site/metadata` | API GraphQL auth + workspace mgmt |
| `https://crm.app.veridian.site/rest/*` | API REST data (objets CRUD) |
| `https://crm.app.veridian.site/welcome` | 301 → Hub signup (signup public bloqué) |
| `https://<workspace>.crm.app.veridian.site/` | Frontend tenant spécifique |

## Pièges connus

1. **Healthz minimaliste** : répond 200 même si DB down. Toujours valider via `/graphql` ou `/metadata`.

2. **Entrypoint Twenty buggé sur DB vierge** : cf §2 init.

3. **Migrations Twenty incrémentales** : au passage d'une version mineure à l'autre, l'entrypoint applique automatiquement les migrations via `yarn command:prod upgrade`. C'est idempotent.

4. **Captcha** : aucune ENV `CAPTCHA_*` posée = bypass automatique. Si jamais on active Captcha en prod (Turnstile / reCAPTCHA), penser que ça casse le flow Hub → CRM (Hub n'a pas de token captcha).

5. **Sub-domain par workspace** : Twenty crée des subdomains `<slug>.crm.app.veridian.site` automatiquement. Couvert par le DNS wildcard `*.app.veridian.site → 51.210.7.44` déjà présent. Pas de nouveau record DNS à créer.
