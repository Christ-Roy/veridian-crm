# Veridian CRM — staging deploy

> Stack staging Twenty fork sur `dev-pub` (37.187.199.185), exposée sur
> `https://crm.staging.veridian.site` via Traefik standalone.

## Composition

- `crm-postgres` : Postgres 15-alpine, données dans le volume `crm-staging-db-data`
- `crm-redis` : Redis 7-alpine, données dans `crm-staging-redis-data`
- `crm-server` : Twenty server (image fork `ghcr.io/christ-roy/veridian-crm:staging`), sert le front bundlé + API GraphQL + REST
- `crm-worker` : Twenty worker (BullMQ + crons), `DISABLE_DB_MIGRATIONS=true` (le server s'en charge)

## Déploiement initial (départ propre)

### 1. Préparer le `.env`

Sur dev-pub :

```bash
ssh dev-pub
mkdir -p ~/services/veridian-crm-staging
cd ~/services/veridian-crm-staging
# Copier docker-compose.yml depuis ce repo
# Copier .env.example en .env et remplir les valeurs
cp .env.example .env
# Générer les secrets :
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)" >> .env
echo "TWENTY_APP_SECRET=$(openssl rand -base64 64 | tr -d '/+=' | cut -c1-64)" >> .env
# SMTP : récupérer depuis ~/credentials/.all-creds.env côté machine locale
```

### 2. Démarrer la stack

```bash
docker compose up -d
```

### 3. ⚠️ FORCER l'init DB au premier boot

**Important** : l'entrypoint Twenty détecte mal une DB vierge (il vérifie
juste `EXISTS schema=core`, qui est créé automatiquement par Postgres au
1er boot pour gérer le namespace, même si vide). Résultat : sans
intervention, le server boot avec une DB sans tables, crashe en boucle
sur les queries, mais `/healthz` répond quand même 200 (faux positif).

**Procédure obligatoire au 1er boot (ou après `docker compose down -v`)** :

```bash
# Attendre que postgres soit healthy
until docker exec veridian-crm-staging-crm-postgres-1 pg_isready -U twenty >/dev/null 2>&1; do sleep 2; done

# Lancer les migrations Twenty depuis le container server
docker exec veridian-crm-staging-crm-server-1 yarn database:init:prod

# Restart server pour clear le state buggy
docker restart veridian-crm-staging-crm-server-1

# Attendre que ça remonte
until curl -sf https://crm.staging.veridian.site/healthz >/dev/null 2>&1; do sleep 3; done

echo "✅ Staging prêt"
```

### 4. Vérifications

```bash
# /healthz doit retourner {"status":"ok"...}
curl https://crm.staging.veridian.site/healthz

# /graphql doit retourner une erreur GraphQL parseable (pas du HTML d'erreur)
curl -X POST https://crm.staging.veridian.site/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __typename }"}'

# /welcome doit rediriger vers Hub
curl -sI https://crm.staging.veridian.site/welcome | grep -i location

# Logs server : aucune erreur "does not exist"
docker logs --tail=200 veridian-crm-staging-crm-server-1 | grep -c "does not exist"
# → doit retourner 0
```

## Update de l'image

À chaque push sur la branche `staging` du repo `Christ-Roy/veridian-crm` :

1. Le workflow `veridian-crm-build-image.yaml` build et push
   `ghcr.io/christ-roy/veridian-crm:staging`
2. Sur dev-pub :

```bash
cd ~/services/veridian-crm-staging
docker compose pull
docker compose up -d
```

3. **Pas besoin** de relancer `database:init:prod` — l'entrypoint Twenty
   appelle `yarn command:prod upgrade` qui est idempotent et applique
   les migrations incrémentales.

## Rollback

```bash
# Lister les images disponibles
docker images ghcr.io/christ-roy/veridian-crm

# Forcer une version précédente
docker compose pull  # OU édite docker-compose.yml pour pinner un tag :staging-<sha>
docker compose up -d
```

## Endpoints

| URL | Comportement |
|---|---|
| `/` | HTML Twenty front (page login natif) |
| `/healthz` | `{"status":"ok"}` — health check minimaliste, ne vérifie PAS la DB |
| `/graphql` | API GraphQL (introspection désactivée en prod) |
| `/welcome` | 301 → `https://hub.staging.veridian.site/signup` (signup public bloqué) |
| `/rest/*` | API REST data (CRUD objets) |

## Pièges connus

1. **DNS résout vers Tailscale IP** : `crm.staging.veridian.site → 37.187.199.185` côté Cloudflare, mais depuis une machine sur le tailnet, MagicDNS résout vers `100.92.215.42`. C'est normal — Traefik dev-pub écoute sur les deux.

2. **Cert Let's Encrypt wildcard via DNS-01** : utilise le token `CF_DNS_TOKEN_TRAEFIK_DEV` côté Traefik standalone (config dans `~/traefik-staging/` sur dev-pub).

3. **Healthz minimaliste** : il répond 200 même si la DB est down. Ne s'appuyer que sur lui pour valider un déploiement = piège. Toujours tester `/graphql` ou un endpoint qui hit la DB.

4. **Entrypoint Twenty buggé sur DB vierge** : cf §3 du init.
