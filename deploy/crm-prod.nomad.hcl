# crm : Twenty v2.56.1 en production, jumeau de crm-staging (VERIDIAN-PATCHES.md).
# Base : pg-saas (entrée fixe du bridge Nomad), base twenty. Redis : groupe `redis` de ce job, sur le tailnet
# de ovh-prod, volume /opt/veridian-prod/crm/redis. REDIS_URL et PG_DATABASE_URL sont posés en dur :
# aucune course au rendu d'un nomadService (cause de la bascule annulée du 09/11/2026).
# La tâche `attente-dependances` (prestart) attend la base et Redis avant le serveur et le worker. Elle remplace
# l'entrypoint de l'image : sinon /app/entrypoint.sh lancerait les migrations en parallèle du serveur.
#
# Secrets (Nomad var nomad/jobs/crm) : APP_SECRET, HUB_API_SECRET, PG_SAAS_PASSWORD, REDIS_PASSWORD.
# Volumes à créer une fois sur le nœud :
#   sudo install -d -o 1000 -g 1000 /opt/veridian-prod/crm/storage
#   sudo install -d -o 999 -g 999 /opt/veridian-prod/crm/redis

variable "noeud_provider" {
  type        = string
  default     = "ovh-prod"
  description = "meta.provider du nœud : celui qui porte le volume Redis et l'entrée pg-saas."
}

variable "image_tag" {
  type    = string
  default = "staging-ac623bd" # 09/11/2026 : JWT du Hub sur /mcp, règle tenant_id, pool pg résilient
}

# Adresses fixes. Aucune ne vient d'un nomadService : le gabarit se rend sans attendre l'enregistrement.
variable "pg_hote" {
  type    = string
  default = "172.26.64.1"
}

variable "pg_port" {
  type    = number
  default = 15432
}

variable "pg_base" {
  type    = string
  default = "twenty"
}

variable "redis_hote" {
  type    = string
  default = "100.88.202.29" # adresse tailnet de ovh-prod
}

variable "redis_port" {
  type    = number
  default = 16381
}

job "crm" {
  datacenters = ["veridian-eu"]
  type        = "service"
  priority    = 80

  group "stack" {
    count          = 1
    shutdown_delay = "30s"

    # Bleu-vert, comme hub : le canari démarre à côté (environ 2 min de démarrage Nest), Traefik ne le sert qu'une fois
    # /healthz vert, puis la promotion arrête l'ancienne après shutdown_delay. Pas de canary_tags : deux définitions du
    # même routeur, Traefik l'écarte (404 mesurés sur hub le 07/11/2026). Le canari ne double que le serveur (800 Mio).
    update {
      max_parallel      = 1
      canary            = 1
      auto_promote      = true
      min_healthy_time  = "30s"
      healthy_deadline  = "20m"
      progress_deadline = "30m"
      auto_revert       = true
    }

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
      delay    = "2s" # retour après plantage : 5,8 s contre 26 s mesurés sur le CMS (parente, 09/11/2026)
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
        "traefik.http.routers.crm.middlewares=crm-retry@nomad",
        # Ne pas changer ces tags dans un déploiement ordinaire (voir hub.nomad.hcl).
        "traefik.http.services.crm.loadbalancer.healthcheck.path=/healthz",
        "traefik.http.services.crm.loadbalancer.healthcheck.interval=2s",
        "traefik.http.services.crm.loadbalancer.healthcheck.timeout=1s",
        "traefik.http.middlewares.crm-retry.retry.attempts=4",
        "traefik.http.middlewares.crm-retry.retry.initialinterval=200ms",
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

    task "crm-attente-dependances" {
      driver = "docker"
      lifecycle {
        hook    = "prestart"
        sidecar = false
      }
      user   = "1000"
      template {
        destination = "secrets/attente.env"
        perms       = "600"
        env         = true
        data        = <<EOH
ATTENTE_PG_HOTE=${var.pg_hote}
ATTENTE_PG_PORT=${var.pg_port}
ATTENTE_REDIS_HOTE=${var.redis_hote}
ATTENTE_REDIS_PORT=${var.redis_port}
EOH
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
        cap_drop     = ["ALL"]
        image        = "ghcr.io/christ-roy/veridian-crm:${var.image_tag}"
        entrypoint   = ["node"]
        args = ["-e", "const n=require('net');const t=(h,p)=>new Promise(r=>{const s=n.connect(+p,h);s.setTimeout(3000);s.once('connect',()=>{s.destroy();r(true)});s.once('error',()=>{s.destroy();r(false)});s.once('timeout',()=>{s.destroy();r(false)})});(async()=>{for(let i=0;i<300;i++){if(await t(process.env.ATTENTE_PG_HOTE,process.env.ATTENTE_PG_PORT)&&await t(process.env.ATTENTE_REDIS_HOTE,process.env.ATTENTE_REDIS_PORT)){console.log('base et redis joignables');process.exit(0)}await new Promise(r=>setTimeout(r,2000))}console.log('base ou redis injoignable apres 10 min');process.exit(1)})()"]
      }
      resources {
        cpu        = 100
        memory     = 64
        memory_max = 128
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
# Traefik joint le serveur par le tailnet : sans lui dans TRUST_PROXY, X-Forwarded-Proto est ignoré, le serveur se croit
# en http et refuse le cookie de session à l'origine https (connexion par le Hub cassée, mesuré le 08/11/2026).
TRUST_PROXY=loopback, linklocal, uniquelocal, 100.64.0.0/10
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
VERIDIAN_AI_DISABLED=true
IS_CONFIG_VARIABLES_IN_DB_ENABLED=false
# Porte MCP du Hub (CONTRAT-MCP) : JWT ES256 du Hub, aud = l'URL inscrite au registre du Hub.
VERIDIAN_HUB_MCP_ISSUER=https://app.veridian.site
VERIDIAN_HUB_MCP_AUDIENCE=https://crm.app.veridian.site/mcp
MARKETPLACE_CATALOG_SYNC_CRON_ENABLED=false
AUTH_GOOGLE_ENABLED=false
MESSAGING_PROVIDER_GMAIL_ENABLED=false
CALENDAR_PROVIDER_GOOGLE_ENABLED=false
EMAIL_DRIVER=logger
STORAGE_TYPE=local
PGUSER=twenty
PGDATABASE=${var.pg_base}
PGHOST=${var.pg_hote}
PGPORT=${var.pg_port}
{{ with nomadVar "nomad/jobs/crm" }}
APP_SECRET={{ .APP_SECRET }}
HUB_API_SECRET={{ .HUB_API_SECRET }}
PGPASSWORD={{ .PG_SAAS_PASSWORD }}
PG_DATABASE_URL=postgres://twenty:{{ .PG_SAAS_PASSWORD }}@${var.pg_hote}:${var.pg_port}/${var.pg_base}
REDIS_URL=redis://:{{ .REDIS_PASSWORD }}@${var.redis_hote}:${var.redis_port}
{{ end }}
EOH
      }
      resources {
        cpu        = 1000
        memory     = 800
        memory_max = 1800
      }
    }
  }

  # Le worker n'a ni port ni service : hors canari (infra, 08/11/2026), il redémarre seul pendant la bascule du serveur.
  # La file Redis garde les tâches le temps de son démarrage.
  group "worker" {
    count = 1

    # Bridge Nomad, comme le serveur : l entrée pg-saas n est joignable que depuis ce réseau.
    network {
      mode = "bridge"
    }

    update {
      max_parallel      = 1
      canary            = 0
      health_check      = "task_states"
      min_healthy_time  = "30s"
      healthy_deadline  = "20m"
      progress_deadline = "30m"
      auto_revert       = true
    }

    constraint {
      attribute = "${meta.provider}"
      value     = var.noeud_provider
    }

    reschedule {
      attempts  = 0
      unlimited = false
    }

    restart {
      attempts = 10
      interval = "10m"
      delay    = "2s"
      mode     = "delay"
    }

    task "crm-attente-dependances" {
      driver = "docker"
      lifecycle {
        hook    = "prestart"
        sidecar = false
      }
      user   = "1000"
      template {
        destination = "secrets/attente.env"
        perms       = "600"
        env         = true
        data        = <<EOH
ATTENTE_PG_HOTE=${var.pg_hote}
ATTENTE_PG_PORT=${var.pg_port}
ATTENTE_REDIS_HOTE=${var.redis_hote}
ATTENTE_REDIS_PORT=${var.redis_port}
EOH
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
        cap_drop     = ["ALL"]
        image        = "ghcr.io/christ-roy/veridian-crm:${var.image_tag}"
        entrypoint   = ["node"]
        args = ["-e", "const n=require('net');const t=(h,p)=>new Promise(r=>{const s=n.connect(+p,h);s.setTimeout(3000);s.once('connect',()=>{s.destroy();r(true)});s.once('error',()=>{s.destroy();r(false)});s.once('timeout',()=>{s.destroy();r(false)})});(async()=>{for(let i=0;i<300;i++){if(await t(process.env.ATTENTE_PG_HOTE,process.env.ATTENTE_PG_PORT)&&await t(process.env.ATTENTE_REDIS_HOTE,process.env.ATTENTE_REDIS_PORT)){console.log('base et redis joignables');process.exit(0)}await new Promise(r=>setTimeout(r,2000))}console.log('base ou redis injoignable apres 10 min');process.exit(1)})()"]
      }
      resources {
        cpu        = 100
        memory     = 64
        memory_max = 128
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
VERIDIAN_AI_DISABLED=true
IS_CONFIG_VARIABLES_IN_DB_ENABLED=false
MARKETPLACE_CATALOG_SYNC_CRON_ENABLED=false
EMAIL_DRIVER=logger
STORAGE_TYPE=local
DISABLE_DB_MIGRATIONS=true
DISABLE_CRON_JOBS_REGISTRATION=true
PGUSER=twenty
PGDATABASE=${var.pg_base}
PGHOST=${var.pg_hote}
PGPORT=${var.pg_port}
{{ with nomadVar "nomad/jobs/crm" }}
APP_SECRET={{ .APP_SECRET }}
PGPASSWORD={{ .PG_SAAS_PASSWORD }}
PG_DATABASE_URL=postgres://twenty:{{ .PG_SAAS_PASSWORD }}@${var.pg_hote}:${var.pg_port}/${var.pg_base}
REDIS_URL=redis://:{{ .REDIS_PASSWORD }}@${var.redis_hote}:${var.redis_port}
{{ end }}
EOH
      }
      resources {
        cpu        = 600
        memory     = 832
        memory_max = 1600
      }
    }
  }

  # Redis du CRM : sorti de crm-db. Port et volume propres : le Redis de crm-db (16380, /opt/veridian-prod/crm-db/redis)
  # reste en place jusqu'à la purge de crm-db, il est le retour arrière. Le volume est une copie de son AOF, prise gel en main.
  group "redis" {
    count = 1

    constraint {
      attribute = "${meta.provider}"
      value     = var.noeud_provider
    }

    reschedule {
      attempts  = 0
      unlimited = false
    }

    restart {
      attempts = 10
      interval = "10m"
      delay    = "2s"
      mode     = "delay"
    }

    network {
      mode = "bridge"
      port "redis" {
        static       = var.redis_port
        to           = 6379
        host_network = "tailscale"
      }
    }

    task "crm-redis" {
      driver          = "docker"
      shutdown_delay  = "5s"
      config {
        security_opt = ["no-new-privileges:true"]
        labels = {
          "site.veridian.job"   = "${NOMAD_JOB_NAME}"
          "site.veridian.group" = "${NOMAD_GROUP_NAME}"
          "site.veridian.task"  = "${NOMAD_TASK_NAME}"
          "site.veridian.node"  = "${node.unique.name}"
          "site.veridian.tier"  = "saas-prod"
          "site.veridian.app"   = "crm"
        }
        image   = "redis:7-alpine"
        ports   = ["redis"]
        command = "redis-server"
        args    = ["--requirepass", "${REDIS_PASSWORD}", "--appendonly", "yes", "--maxmemory-policy", "noeviction", "--loglevel", "warning"]
        volumes = ["/opt/veridian-prod/crm/redis:/data"]
      }
      template {
        destination = "secrets/redis.env"
        perms       = "600"
        env         = true
        data        = <<EOH
{{ with nomadVar "nomad/jobs/crm" }}REDIS_PASSWORD={{ .REDIS_PASSWORD }}{{ end }}
EOH
      }
      service {
        name     = "crm-redis"
        provider = "nomad"
        port     = "redis"
        check {
          type     = "tcp"
          interval = "20s"
          timeout  = "5s"
        }
      }
      resources {
        cpu        = 100
        memory     = 64
        memory_max = 256
      }
    }
  }
}
