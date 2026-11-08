# crm-staging : Twenty v2.56.1, fork minimal Veridian (VERIDIAN-PATCHES.md).
#
# Placement mesuré le 06/11/2026 (`nomad-v free`) : contabo-bastion est le seul
# noeud à avoir de la réservation libre (8,3 GHz, 10,5 GiB). node02 n'a plus que
# 150 MHz, ovh-dev 0,9 GiB, app-01 1,2 GiB.
#
# Base neuve, aucune donnée client. Exposition privée : port sur l'IP Tailscale,
# routeur limité au tailnet, DNS crm.staging et *.crm.staging en 100.x.
# Routage par tags et non en @file : ajouter une route n'impose pas de redémarrer
# Traefik. Pas de Sablier pour l'instant, le passer en scale-to-zero demandera une
# route @file et un redéploiement de l'ingress.
#
# Identité : le Hub seul. Mot de passe coupé par variable, inscription et invitations par
# le garde HubOnlyIdentityGuard ; les créations passent par /api/tenants/provision.
#
# Coupures réseau : TELEMETRY_ENABLED et MARKETPLACE_CATALOG_SYNC_CRON_ENABLED.
# Contrôle : scripts/ci/capture-sortante.sh, sur le conteneur crm-postgres.
#
# Secrets (Nomad var nomad/jobs/crm-staging) : APP_SECRET, POSTGRES_PASSWORD,
# HUB_API_SECRET. Volumes à créer une fois :
#   sudo install -d -o 70 -g 70 /opt/veridian-staging/crm/db
#   sudo install -d -o 999 -g 999 /opt/veridian-staging/crm/redis
#   sudo install -d -o 1000 -g 1000 /opt/veridian-staging/crm/storage

variable "image_tag" {
  type    = string
  default = "staging-3008f78"
}

job "crm-staging" {
  datacenters = ["veridian-eu"]
  type        = "service"
  priority    = 30

  group "stack" {
    count = 1

    constraint {
      attribute = "${meta.provider}"
      value     = "contabo"
    }

    # Volumes locaux : le bind ne suit pas une replanification.
    reschedule {
      attempts  = 0
      unlimited = false
    }

    restart {
      attempts = 10
      interval = "15m"
      delay    = "20s"
      mode     = "delay"
    }

    network {
      mode = "bridge"
      port "http" {
        static       = 19099
        to           = 3000
        host_network = "tailscale"
      }
    }

    service {
      name     = "crm-staging"
      provider = "nomad"
      port     = "http"
      tags = [
        "traefik.enable=true",
        "traefik.http.routers.crm-staging.rule=Host(`crm.staging.veridian.site`) || HostRegexp(`^[a-z0-9-]+\\.crm\\.staging\\.veridian\\.site$`)",
        "traefik.http.routers.crm-staging.entrypoints=websecure",
        "traefik.http.routers.crm-staging.tls.certresolver=letsencrypt",
        "traefik.http.routers.crm-staging.tls.domains[0].main=crm.staging.veridian.site",
        "traefik.http.routers.crm-staging.tls.domains[0].sans=*.crm.staging.veridian.site",
        "traefik.http.routers.crm-staging.middlewares=internal-only@file",
      ]
      check {
        type     = "http"
        path     = "/healthz"
        interval = "20s"
        timeout  = "5s"
        check_restart {
          limit = 30
          grace = "15m"
        }
      }
    }

    task "crm-postgres" {
      driver = "docker"
      lifecycle {
        hook    = "prestart"
        sidecar = true
      }
      config {
        labels = {
          "site.veridian.job"   = "${NOMAD_JOB_NAME}"
          "site.veridian.group" = "${NOMAD_GROUP_NAME}"
          "site.veridian.task"  = "${NOMAD_TASK_NAME}"
          "site.veridian.node"  = "${node.unique.name}"
          "site.veridian.tier"  = "saas-staging"
          "site.veridian.app"   = "crm"
        }
        security_opt = ["no-new-privileges:true"]
        image        = "postgres:16-alpine"
        volumes      = ["/opt/veridian-staging/crm/db:/var/lib/postgresql/data"]
      }
      template {
        destination = "secrets/pg.env"
        perms       = "600"
        env         = true
        data        = <<EOH
POSTGRES_USER=twenty
POSTGRES_DB=twenty
{{ with nomadVar "nomad/jobs/crm-staging" }}
POSTGRES_PASSWORD={{ .POSTGRES_PASSWORD }}
{{ end }}
EOH
      }
      resources {
        cpu        = 150
        memory     = 128
        memory_max = 1024
      }
    }

    task "crm-redis" {
      driver = "docker"
      lifecycle {
        hook    = "prestart"
        sidecar = true
      }
      config {
        labels = {
          "site.veridian.job"   = "${NOMAD_JOB_NAME}"
          "site.veridian.group" = "${NOMAD_GROUP_NAME}"
          "site.veridian.task"  = "${NOMAD_TASK_NAME}"
          "site.veridian.node"  = "${node.unique.name}"
          "site.veridian.tier"  = "saas-staging"
          "site.veridian.app"   = "crm"
        }
        security_opt = ["no-new-privileges:true"]
        image        = "redis:7-alpine"
        args         = ["--maxmemory-policy", "noeviction", "--appendonly", "yes"]
        volumes      = ["/opt/veridian-staging/crm/redis:/data"]
      }
      resources {
        cpu        = 100
        memory     = 64
        memory_max = 512
      }
    }

    # Les tâches d'un groupe démarrent en parallèle : on attend Postgres avant les
    # migrations du serveur plutôt que de compter sur un crash puis un redémarrage.
    task "crm-wait-postgres" {
      lifecycle {
        hook    = "prestart"
        sidecar = false
      }
      driver = "docker"
      config {
        labels = {
          "site.veridian.job"   = "${NOMAD_JOB_NAME}"
          "site.veridian.group" = "${NOMAD_GROUP_NAME}"
          "site.veridian.task"  = "${NOMAD_TASK_NAME}"
          "site.veridian.node"  = "${node.unique.name}"
          "site.veridian.tier"  = "saas-staging"
          "site.veridian.app"   = "crm"
        }
        security_opt = ["no-new-privileges:true"]
        image        = "postgres:16-alpine"
        command      = "/bin/sh"
        args = [
          "-ec",
          "for i in $(seq 1 120); do pg_isready -h 127.0.0.1 -p 5432 -U twenty && exit 0; sleep 1; done; exit 1",
        ]
      }
      resources {
        cpu        = 20
        memory     = 32
        memory_max = 64
      }
    }

    task "crm-server" {
      driver = "docker"
      user   = "1000"
      config {
        labels = {
          "site.veridian.job"   = "${NOMAD_JOB_NAME}"
          "site.veridian.group" = "${NOMAD_GROUP_NAME}"
          "site.veridian.task"  = "${NOMAD_TASK_NAME}"
          "site.veridian.node"  = "${node.unique.name}"
          "site.veridian.tier"  = "saas-staging"
          "site.veridian.app"   = "crm"
        }
        security_opt = ["no-new-privileges:true"]
        cap_drop     = ["ALL"]
        image        = "ghcr.io/christ-roy/veridian-crm:${var.image_tag}"
        ports        = ["http"]
        volumes      = ["/opt/veridian-staging/crm/storage:/app/packages/twenty-server/.local-storage"]
      }
      template {
        destination = "secrets/server.env"
        perms       = "600"
        env         = true
        data        = <<EOH
NODE_PORT=3000
SERVER_URL=https://crm.staging.veridian.site
FRONTEND_URL=https://crm.staging.veridian.site
IS_MULTIWORKSPACE_ENABLED=true
DEFAULT_SUBDOMAIN=app
IS_BILLING_ENABLED=false
IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS=false
AUTH_PASSWORD_ENABLED=false
AUTH_MICROSOFT_ENABLED=false
HUB_URL=https://hub.staging.veridian.site
HUB_SERVER_ADMIN_EMAILS=robert.brunon@veridian.site
TELEMETRY_ENABLED=false
VERIDIAN_AI_DISABLED=true
MARKETPLACE_CATALOG_SYNC_CRON_ENABLED=false
AUTH_GOOGLE_ENABLED=false
MESSAGING_PROVIDER_GMAIL_ENABLED=false
CALENDAR_PROVIDER_GOOGLE_ENABLED=false
EMAIL_DRIVER=logger
REDIS_URL=redis://127.0.0.1:6379
STORAGE_TYPE=local
PGHOST=127.0.0.1
PGUSER=twenty
PGDATABASE=twenty
{{ with nomadVar "nomad/jobs/crm-staging" }}
APP_SECRET={{ .APP_SECRET }}
HUB_API_SECRET={{ .HUB_API_SECRET }}
PGPASSWORD={{ .POSTGRES_PASSWORD }}
PG_DATABASE_URL=postgres://twenty:{{ .POSTGRES_PASSWORD }}@127.0.0.1:5432/twenty
{{ end }}
EOH
      }
      resources {
        cpu        = 400
        memory     = 900
        memory_max = 2560
      }
    }

    task "crm-worker" {
      driver = "docker"
      user   = "1000"
      config {
        labels = {
          "site.veridian.job"   = "${NOMAD_JOB_NAME}"
          "site.veridian.group" = "${NOMAD_GROUP_NAME}"
          "site.veridian.task"  = "${NOMAD_TASK_NAME}"
          "site.veridian.node"  = "${node.unique.name}"
          "site.veridian.tier"  = "saas-staging"
          "site.veridian.app"   = "crm"
        }
        security_opt = ["no-new-privileges:true"]
        cap_drop     = ["ALL"]
        image        = "ghcr.io/christ-roy/veridian-crm:${var.image_tag}"
        command      = "yarn"
        args         = ["worker:prod"]
        volumes      = ["/opt/veridian-staging/crm/storage:/app/packages/twenty-server/.local-storage"]
      }
      template {
        destination = "secrets/worker.env"
        perms       = "600"
        env         = true
        data        = <<EOH
SERVER_URL=https://crm.staging.veridian.site
FRONTEND_URL=https://crm.staging.veridian.site
IS_MULTIWORKSPACE_ENABLED=true
DEFAULT_SUBDOMAIN=app
IS_BILLING_ENABLED=false
TELEMETRY_ENABLED=false
VERIDIAN_AI_DISABLED=true
MARKETPLACE_CATALOG_SYNC_CRON_ENABLED=false
EMAIL_DRIVER=logger
REDIS_URL=redis://127.0.0.1:6379
STORAGE_TYPE=local
DISABLE_DB_MIGRATIONS=true
DISABLE_CRON_JOBS_REGISTRATION=true
PGHOST=127.0.0.1
PGUSER=twenty
PGDATABASE=twenty
{{ with nomadVar "nomad/jobs/crm-staging" }}
APP_SECRET={{ .APP_SECRET }}
PGPASSWORD={{ .POSTGRES_PASSWORD }}
PG_DATABASE_URL=postgres://twenty:{{ .POSTGRES_PASSWORD }}@127.0.0.1:5432/twenty
{{ end }}
EOH
      }
      resources {
        cpu        = 200
        memory     = 750
        memory_max = 1792
      }
    }
  }
}
