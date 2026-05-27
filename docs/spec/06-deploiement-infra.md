# 06 — Déploiement infra Veridian CRM

> Comment on déploie le CRM forké sur l'infra Veridian existante (Dokploy + Traefik staging-edge).

## Topologie cible

| URL | Pointage | Stack |
|---|---|---|
| `crm.staging.veridian.site` | dev-pub (Tailscale, derrière VPN) | docker-compose.staging.yml |
| `crm.app.veridian.site` | prod-pub (OVH VPS) | docker-compose.prod.yml via Dokploy |

## Compose docker (à adapter du Twenty officiel)

Twenty fournit un compose officiel. À adapter :

```yaml
# docker-compose.staging.yml (à mettre dans veridian-crm repo)
services:
  crm-server:
    image: ghcr.io/christ-roy/veridian-crm-server:staging
    networks:
      - staging-edge
      - default
    environment:
      - DATABASE_URL=postgresql://postgres:veridian-crm-staging@crm-db:5432/veridian_crm
      - REDIS_URL=redis://crm-redis:6379
      - HUB_API_SECRET=${HUB_API_SECRET}
      - HUB_URL=https://hub.staging.veridian.site
      - NOTIFUSE_API_SECRET=${NOTIFUSE_API_SECRET}
      - NOTIFUSE_URL=https://notifuse.staging.veridian.site
      - PROSPECTION_API_SECRET=${PROSPECTION_API_SECRET}
      - PROSPECTION_URL=https://prospection.staging.veridian.site
      - R2_BUCKET=veridian-crm-staging
      - R2_ACCESS_KEY=${R2_ACCESS_KEY}
      - R2_SECRET_KEY=${R2_SECRET_KEY}
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=staging-edge"
      - "traefik.http.routers.crm.rule=Host(`crm.staging.veridian.site`)"
      - "traefik.http.routers.crm.entrypoints=websecure"
      - "traefik.http.routers.crm.tls.certresolver=letsencrypt"
      - "traefik.http.services.crm.loadbalancer.server.port=3000"

  crm-worker:
    image: ghcr.io/christ-roy/veridian-crm-server:staging
    command: ['yarn', 'command:prod', 'cron:messaging:*']  # worker BullMQ
    networks: [default]
    environment: # mêmes que crm-server

  crm-front:
    image: ghcr.io/christ-roy/veridian-crm-front:staging
    networks: [staging-edge, default]
    labels:
      - traefik labels pour crm.staging.veridian.site (path / → front)

  crm-db:
    image: postgres:15
    volumes:
      - crm-staging-db-data:/var/lib/postgresql/data
    environment:
      - POSTGRES_PASSWORD=veridian-crm-staging
      - POSTGRES_DB=veridian_crm

  crm-redis:
    image: redis:7-alpine
    volumes:
      - crm-staging-redis-data:/data

networks:
  staging-edge:
    external: true

volumes:
  crm-staging-db-data:
  crm-staging-redis-data:
```

## DNS Cloudflare

- Wildcard `*.staging.veridian.site → 37.187.199.185` (existant)
- Wildcard `*.app.veridian.site → 100.88.202.29` (existant)
- Le subdomain `crm` est automatiquement pris en charge ✓

## Dokploy

- Créer un compose Dokploy `veridian-crm-staging` (URL `crm.staging.veridian.site`)
- Créer un compose Dokploy `veridian-crm-prod` (URL `crm.app.veridian.site`)
- ENV variables : injecter HUB_API_SECRET, NOTIFUSE_API_SECRET, PROSPECTION_API_SECRET, R2_*

## CI/CD

Reprendre le pattern Veridian Prospection :
- `.github/workflows/crm-staging.yml` : sur push branche `staging` → build Docker → push GHCR → SSH dev-pub déploie compose
- `.github/workflows/crm-ci.yml` : sur push branche `main` → build → push GHCR → trigger Dokploy compose.deploy prod

## Backup DB

- Cron prod 04:00 UTC → R2 (pattern existant Veridian)
- Sync local 07:00 Europe/Paris

## Monitoring

- Stack obs Grafana Cloud Veridian (existant, agent veridian-system-monitor)
- Healthcheck `/api/health` à ajouter dans le CRM (Twenty natif a déjà `/healthz`)

## Estimation

- Compose + Traefik labels : 1 jour
- Dokploy setup + ENV : 1 jour
- CI/CD : 2 jours
- DNS + DB backup + monitoring : 1 jour
- **Total : ~5 jours (1 agent infra)**
