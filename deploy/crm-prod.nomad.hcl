# crm : Twenty v2.56.1 en production, jumeau de crm-staging (VERIDIAN-PATCHES.md).
# PAS ENCORE DÉPLOYÉ : attend un nœud, la décision de marque et les prérequis de
# todo/2026-11-07-passage-prod.md. Tout écart avec crm-staging se justifie ici :
# nom, domaine, Hub de prod, priorité, volumes, routeur public, réservations mesurées.
#
# Secrets (Nomad var nomad/jobs/crm) : APP_SECRET, POSTGRES_PASSWORD, HUB_API_SECRET,
# neufs, jamais ceux du staging. Volumes à créer une fois sur le nœud :
#   sudo install -d -o 70 -g 70 /opt/veridian-prod/crm/db
#   sudo install -d -o 999 -g 999 /opt/veridian-prod/crm/redis
#   sudo install -d -o 1000 -g 1000 /opt/veridian-prod/crm/storage

variable "noeud_provider" {
  type        = string
  default     = "a-choisir"
  description = "meta.provider du nœud retenu : la valeur par défaut ne place rien, on choisit en le mesurant."
}

variable "image_tag" {
  type    = string
  default = "staging-e0376ab" # promu après parcours en staging
}

job "crm" {
  datacenters = ["veridian-eu"]
  type        = "service"
  priority    = 80

  group "stack" {
    count          = 1
    shutdown_delay = "5s"

    constraint {
      attribute = "${meta.provider}"
      value     = var.noeud_provider
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
        to           = 3000
        host_network = "tailscale"
      }
    }

    service {
      name     = "crm"
      provider = "nomad"
      port     = "http"
      tags = [
        "traefik.enable=true",
        "traefik.http.routers.crm.rule=Host(`crm.app.veridian.site`) || HostRegexp(`^[a-z0-9-]+\\.crm\\.app\\.veridian\\.site$`)",
        "traefik.http.routers.crm.entrypoints=websecure",
        "traefik.http.routers.crm.tls.certresolver=letsencrypt",
        "traefik.http.routers.crm.tls.domains[0].main=crm.app.veridian.site",
        "traefik.http.routers.crm.tls.domains[0].sans=*.crm.app.veridian.site",
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
          "site.veridian.tier"  = "saas-prod"
          "site.veridian.app"   = "crm"
        }
        security_opt = ["no-new-privileges:true"]
        image        = "postgres:16-alpine"
        volumes      = ["/opt/veridian-prod/crm/db:/var/lib/postgresql/data"]
      }
      template {
        destination = "secrets/pg.env"
        perms       = "600"
        env         = true
        data        = <<EOH
POSTGRES_USER=twenty
POSTGRES_DB=twenty
{{ with nomadVar "nomad/jobs/crm" }}
POSTGRES_PASSWORD={{ .POSTGRES_PASSWORD }}
{{ end }}
EOH
      }
      resources {
        cpu        = 300
        memory     = 256
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
          "site.veridian.tier"  = "saas-prod"
          "site.veridian.app"   = "crm"
        }
        security_opt = ["no-new-privileges:true"]
        image        = "redis:7-alpine"
        args         = ["--maxmemory-policy", "noeviction", "--appendonly", "yes"]
        volumes      = ["/opt/veridian-prod/crm/redis:/data"]
      }
      resources {
        cpu        = 100
        memory     = 192
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
          "site.veridian.tier"  = "saas-prod"
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
          "site.veridian.tier"  = "saas-prod"
          "site.veridian.app"   = "crm"
        }
        security_opt = ["no-new-privileges:true"]
        cap_drop     = ["ALL"]
        image        = "ghcr.io/christ-roy/veridian-crm:${var.image_tag}"
        ports        = ["http"]
        volumes      = ["/opt/veridian-prod/crm/storage:/app/packages/twenty-server/.local-storage"]
      }
      template {
        destination = "secrets/server.env"
        perms       = "600"
        env         = true
        data        = <<EOH
NODE_PORT=3000
SERVER_URL=https://crm.app.veridian.site
FRONTEND_URL=https://crm.app.veridian.site
IS_MULTIWORKSPACE_ENABLED=true
DEFAULT_SUBDOMAIN=app
IS_BILLING_ENABLED=false
IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS=false
AUTH_PASSWORD_ENABLED=false
AUTH_MICROSOFT_ENABLED=false
HUB_URL=https://app.veridian.site
HUB_SERVER_ADMIN_EMAILS=robert.brunon@veridian.site
TELEMETRY_ENABLED=false
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
{{ with nomadVar "nomad/jobs/crm" }}
APP_SECRET={{ .APP_SECRET }}
HUB_API_SECRET={{ .HUB_API_SECRET }}
PGPASSWORD={{ .POSTGRES_PASSWORD }}
PG_DATABASE_URL=postgres://twenty:{{ .POSTGRES_PASSWORD }}@127.0.0.1:5432/twenty
{{ end }}
EOH
      }
      resources {
        cpu        = 1000
        memory     = 1280
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
          "site.veridian.tier"  = "saas-prod"
          "site.veridian.app"   = "crm"
        }
        security_opt = ["no-new-privileges:true"]
        cap_drop     = ["ALL"]
        image        = "ghcr.io/christ-roy/veridian-crm:${var.image_tag}"
        command      = "yarn"
        args         = ["worker:prod"]
        volumes      = ["/opt/veridian-prod/crm/storage:/app/packages/twenty-server/.local-storage"]
      }
      template {
        destination = "secrets/worker.env"
        perms       = "600"
        env         = true
        data        = <<EOH
SERVER_URL=https://crm.app.veridian.site
FRONTEND_URL=https://crm.app.veridian.site
IS_MULTIWORKSPACE_ENABLED=true
DEFAULT_SUBDOMAIN=app
IS_BILLING_ENABLED=false
TELEMETRY_ENABLED=false
MARKETPLACE_CATALOG_SYNC_CRON_ENABLED=false
EMAIL_DRIVER=logger
REDIS_URL=redis://127.0.0.1:6379
STORAGE_TYPE=local
DISABLE_DB_MIGRATIONS=true
DISABLE_CRON_JOBS_REGISTRATION=true
PGHOST=127.0.0.1
PGUSER=twenty
PGDATABASE=twenty
{{ with nomadVar "nomad/jobs/crm" }}
APP_SECRET={{ .APP_SECRET }}
PGPASSWORD={{ .POSTGRES_PASSWORD }}
PG_DATABASE_URL=postgres://twenty:{{ .POSTGRES_PASSWORD }}@127.0.0.1:5432/twenty
{{ end }}
EOH
      }
      resources {
        cpu        = 600
        memory     = 1100
        memory_max = 1792
      }
    }
  }
}
