# crm : Twenty v2.56.1 en production, jumeau de crm-staging (VERIDIAN-PATCHES.md).
# PAS ENCORE DÉPLOYÉ : ordre et prérequis dans todo/2026-11-07-passage-prod.md.
# La base vit dans crm-db (deploy/crm-db.nomad.hcl), trouvée par nomadService. Tout écart avec crm-staging se justifie ici :
# nom, domaine, Hub de prod, priorité, volumes, routeur public, réservations mesurées.
#
# Secrets (Nomad var nomad/jobs/crm) : APP_SECRET, POSTGRES_PASSWORD, REDIS_PASSWORD, HUB_API_SECRET,
# neufs, jamais ceux du staging. Volumes à créer une fois sur le nœud :
#   sudo install -d -o 1000 -g 1000 /opt/veridian-prod/crm/storage

variable "noeud_provider" {
  type        = string
  default     = "ovh-prod"
  description = "meta.provider du nœud, retenu par infra le 07/11/2026 : celui de crm-db."
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
      interval = "10m"
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
        change_mode = "noop"
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
STORAGE_TYPE=local
PGUSER=twenty
PGDATABASE=twenty
{{ with nomadVar "nomad/jobs/crm" }}
APP_SECRET={{ .APP_SECRET }}
HUB_API_SECRET={{ .HUB_API_SECRET }}
PGPASSWORD={{ .POSTGRES_PASSWORD }}
{{ $pg := .POSTGRES_PASSWORD }}{{ $redis := .REDIS_PASSWORD }}
{{ range nomadService "crm-db-pg" }}PGHOST={{ .Address }}
PGPORT={{ .Port }}
PG_DATABASE_URL=postgres://twenty:{{ $pg }}@{{ .Address }}:{{ .Port }}/twenty
{{ end }}{{ range nomadService "crm-db-redis" }}REDIS_URL=redis://:{{ $redis }}@{{ .Address }}:{{ .Port }}
{{ end }}{{ end }}
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
        change_mode = "noop"
        data        = <<EOH
SERVER_URL=https://crm.app.veridian.site
FRONTEND_URL=https://crm.app.veridian.site
IS_MULTIWORKSPACE_ENABLED=true
DEFAULT_SUBDOMAIN=app
IS_BILLING_ENABLED=false
TELEMETRY_ENABLED=false
MARKETPLACE_CATALOG_SYNC_CRON_ENABLED=false
EMAIL_DRIVER=logger
STORAGE_TYPE=local
DISABLE_DB_MIGRATIONS=true
DISABLE_CRON_JOBS_REGISTRATION=true
PGUSER=twenty
PGDATABASE=twenty
{{ with nomadVar "nomad/jobs/crm" }}
APP_SECRET={{ .APP_SECRET }}
PGPASSWORD={{ .POSTGRES_PASSWORD }}
{{ $pg := .POSTGRES_PASSWORD }}{{ $redis := .REDIS_PASSWORD }}
{{ range nomadService "crm-db-pg" }}PGHOST={{ .Address }}
PGPORT={{ .Port }}
PG_DATABASE_URL=postgres://twenty:{{ $pg }}@{{ .Address }}:{{ .Port }}/twenty
{{ end }}{{ range nomadService "crm-db-redis" }}REDIS_URL=redis://:{{ $redis }}@{{ .Address }}:{{ .Port }}
{{ end }}{{ end }}
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
