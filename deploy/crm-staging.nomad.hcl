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
#   sudo install -d -o 999 -g 999 /opt/veridian-staging/crm/redis-groupe
#   sudo install -d -o 1000 -g 1000 /opt/veridian-staging/crm/storage

variable "image_tag" {
  type    = string
  default = "staging-47861fe" # 24/11/2026 : jeton d'action à act borné, couples liaisons (VER-246)
}

variable "redis_port" {
  type    = number
  default = 16382
}

job "crm-staging" {
  datacenters = ["veridian-eu"]
  node_pool   = "dragonair" # 25/11/2026 : hors bastion saturé (charge 18-30). Retour arrière : ce commit inversé, les données du bastion sont gardées.
  type        = "service"
  priority    = 30

  group "stack" {
    count = 1

    # Démarrage de 2 à plus de 20 min sur un nœud chargé : le défaut de Nomad (5 min) déclarait en échec
    # un déploiement dont le serveur finissait de démarrer (09/11/2026).
    update {
      min_healthy_time  = "30s"
      healthy_deadline  = "20m"
      progress_deadline = "30m"
    }

    constraint {
      attribute = "${meta.provider}"
      value     = "dragonair"
    }

    # Volumes locaux : le bind ne suit pas une replanification.
    reschedule {
      attempts  = 0
      unlimited = false
    }

    restart {
      attempts = 10
      interval = "15m"
      delay    = "2s"
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
        name     = "vivacite"
        type     = "http"
        path     = "/healthz"
        interval = "20s"
        timeout  = "5s"
        check_restart {
          limit = 30
          grace = "15m"
        }
      }
      # Base joignable (09/11/2026) : /healthz ne la lit pas. Ce check sort l'instance de la rotation Traefik pendant
      # une bascule pg-saas sans la tuer (pas de check_restart : une base absente ne fait pas redémarrer en boucle).
      check {
        name     = "base"
        type     = "http"
        path     = "/healthz/base"
        interval = "5s"
        timeout  = "3s"
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

    # Remplacé par le groupe `redis` (25/11/2026). Gardé à vide : retour arrière immédiat, aucune tâche supprimée.
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
        image        = "ghcr.io/veridian-site/redis:7-20261126-cc2a313@sha256:f93473b0a94e5a62fe4988050e92984396381c69246b6c827a157d54788ab726"
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
          "for i in $(seq 1 120); do pg_isready -h 127.0.0.1 -p 5432 -U twenty && nc -z -w 3 $NOMAD_HOST_IP_http ${var.redis_port} && exit 0; sleep 1; done; exit 1",
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
# Traefik joint le serveur par le tailnet : sans 100.64.0.0/10 dans TRUST_PROXY, X-Forwarded-Proto est ignoré, le
# serveur se croit en http et refuse le cookie de session (rebond Hub en échec, mesuré le 22/11 ; même piège en prod le 08/11).
TRUST_PROXY=loopback, linklocal, uniquelocal, 100.64.0.0/10
SERVER_URL=https://crm.staging.veridian.site
FRONTEND_URL=https://crm.staging.veridian.site
IS_MULTIWORKSPACE_ENABLED=true
DEFAULT_SUBDOMAIN=app
IS_BILLING_ENABLED=false
IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS=false
AUTH_PASSWORD_ENABLED=false
AUTH_MICROSOFT_ENABLED=false
HUB_URL=https://hub.staging.veridian.site
# Administrateurs d'instance par identité du Hub (25/11/2026) : jamais d'adresse dans ce dépôt public.
# Avant de changer l'une des deux listes : scripts/ci/admins-instance.py staging
HUB_SERVER_ADMIN_HUB_USER_IDS=03edb21f-4560-4698-987b-37b5f4d230d1,f4c4ed75-5103-4494-a58d-27f207529fb5
TELEMETRY_ENABLED=false
# IA (VER-203, épreuve staging du 23/11/2026) : seul fournisseur « veridian » ; chaque appel au modèle porte une
# identité signée (secrets de la Variable partagée veridian/ia-identite, posée par l'infra, lisible par hub, crm et
# crm-staging ; clés secret et cle_instance). Coupée hors épreuve : pas d'écran mort.
VERIDIAN_AI_DISABLED=true
VERIDIAN_IA_FOURNISSEUR=veridian
# Fonctions des apps (ROB-235, 18/11/2026) : LOCAL, mais seules s'exécutent les apps des couples
# <workspaceId>:<appUniversalId> listés (garde du fork, veridian-coupures). Vide = rien ne s'exécute.
# Staging : cheerful-yellow-zebra + chantier (répétition du plugin, 22/11/2026).
LOGIC_FUNCTION_TYPE=LOCAL
VERIDIAN_LOGIC_FUNCTION_ALLOW=0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b:26679b6d-2464-436e-81f8-ae68059bb8d3,0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b:1a1ab23e-60e5-4eca-be1f-718c96055c79
# Installation des apps publiées (VER-173, 22/11/2026) : seuls les couples <workspaceId>:<appUniversalId> listés
# installent ou mettent à jour (garde du fork, veridian-coupures). Vide = tout refusé ; un espace jetable y compris.
VERIDIAN_APP_INSTALL_ALLOW=0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b:26679b6d-2464-436e-81f8-ae68059bb8d3,0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b:e3df4b02-559e-4624-b985-3fd49cfd1725,4e8c64ad-e4bd-4633-89cb-746957ef2a81:e3df4b02-559e-4624-b985-3fd49cfd1725,0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b:f7baf702-cc85-4d4a-a3f2-0ceb42516d68,0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b:1a1ab23e-60e5-4eca-be1f-718c96055c79,0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b:79be0014-d023-4aa5-b28b-ef3362692d69
# Apps de base (26/11/2026, Liaisons) : posées à la création de chaque espace, ouvertes partout sauf aux espaces
# clients existants listés en exclusion (décision de Robert attendue).
VERIDIAN_EDITOR_WORKSPACE_IDS=0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b
VERIDIAN_BASE_APPS_EXCLUDE=
# CORS (26/11/2026) : une origine hors liste ne reçoit plus « * » (rien de Veridian n'appelle d'ailleurs).
VERIDIAN_CORS_STRICT=true
VERIDIAN_CATALOGUE=1a1ab23e-60e5-4eca-be1f-718c96055c79:liste,58a58b5a-8a63-441b-b314-996221f309dd:liste,65f44458-3dde-49de-9b19-c52b60b5d1e8:liste,dccc9944-ddb7-4019-a95d-ec27679f70ba:liste,e3df4b02-559e-4624-b985-3fd49cfd1725:liste
VERIDIAN_CSP=report
IS_CONFIG_VARIABLES_IN_DB_ENABLED=false
# Budget de connexions pg-saas (parente, 09/11/2026) : 8 par pool, 2 pools (cœur, workspace).
PG_POOL_MAX_CONNECTIONS=8
PG_POOL_IDLE_TIMEOUT_MS=60000
# Porte MCP du Hub (CONTRAT-MCP) : JWT ES256 du Hub, aud = l'URL inscrite au registre du Hub.
VERIDIAN_HUB_MCP_ISSUER=https://hub.staging.veridian.site
VERIDIAN_HUB_MCP_AUDIENCE=https://crm.staging.veridian.site/mcp
MARKETPLACE_CATALOG_SYNC_CRON_ENABLED=false
# Grâce avant destruction d'un espace supprimé : 104 - 14 = 90 jours, comme le Hub (25/11/2026).
WORKSPACE_INACTIVE_DAYS_BEFORE_DELETION=104
AUTH_GOOGLE_ENABLED=false
MESSAGING_PROVIDER_GMAIL_ENABLED=false
CALENDAR_PROVIDER_GOOGLE_ENABLED=false
EMAIL_DRIVER=logger
STORAGE_TYPE=local
PGHOST=127.0.0.1
PGUSER=twenty
PGDATABASE=twenty
{{ with nomadVar "nomad/jobs/crm-staging" }}
APP_SECRET={{ .APP_SECRET }}
HUB_API_SECRET={{ .HUB_API_SECRET }}
PGPASSWORD={{ .POSTGRES_PASSWORD }}
PG_DATABASE_URL=postgres://twenty:{{ .POSTGRES_PASSWORD }}@127.0.0.1:5432/twenty
REDIS_URL=redis://:{{ sha256Hex (printf "crm-redis-%s" .POSTGRES_PASSWORD) }}@{{ env "NOMAD_HOST_IP_http" }}:${var.redis_port}
{{ end }}
{{ with nomadVar "veridian/ia-identite" }}
VERIDIAN_IA_IDENTITE_SECRET={{ .secret }}
AI_PROVIDERS='{"veridian":{"npm":"@ai-sdk/openai-compatible","name":"veridian","label":"Veridian","baseUrl":"https://app.veridian.site/api/ia/v1","apiKey":"{{ .cle_instance }}","models":[{"name":"veridian-auto","label":"Assistant Veridian","contextWindowTokens":200000,"maxOutputTokens":8192}]}}'
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
# IA (VER-203, épreuve staging du 23/11/2026) : seul fournisseur « veridian » ; chaque appel au modèle porte une
# identité signée (secrets de la Variable partagée veridian/ia-identite, posée par l'infra, lisible par hub, crm et
# crm-staging ; clés secret et cle_instance). Coupée hors épreuve : pas d'écran mort.
VERIDIAN_AI_DISABLED=true
VERIDIAN_IA_FOURNISSEUR=veridian
# Fonctions des apps (ROB-235, 18/11/2026) : LOCAL, mais seules s'exécutent les apps des couples
# <workspaceId>:<appUniversalId> listés (garde du fork, veridian-coupures). Vide = rien ne s'exécute.
# Staging : cheerful-yellow-zebra + chantier (répétition du plugin, 22/11/2026).
LOGIC_FUNCTION_TYPE=LOCAL
VERIDIAN_LOGIC_FUNCTION_ALLOW=0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b:26679b6d-2464-436e-81f8-ae68059bb8d3,0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b:1a1ab23e-60e5-4eca-be1f-718c96055c79
# Installation des apps publiées (VER-173, 22/11/2026) : seuls les couples <workspaceId>:<appUniversalId> listés
# installent ou mettent à jour (garde du fork, veridian-coupures). Vide = tout refusé ; un espace jetable y compris.
VERIDIAN_APP_INSTALL_ALLOW=0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b:26679b6d-2464-436e-81f8-ae68059bb8d3,0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b:e3df4b02-559e-4624-b985-3fd49cfd1725,4e8c64ad-e4bd-4633-89cb-746957ef2a81:e3df4b02-559e-4624-b985-3fd49cfd1725,0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b:f7baf702-cc85-4d4a-a3f2-0ceb42516d68,0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b:1a1ab23e-60e5-4eca-be1f-718c96055c79,0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b:79be0014-d023-4aa5-b28b-ef3362692d69
# Apps de base (26/11/2026, Liaisons) : posées à la création de chaque espace, ouvertes partout sauf aux espaces
# clients existants listés en exclusion (décision de Robert attendue).
VERIDIAN_EDITOR_WORKSPACE_IDS=0e1e92ed-c8e4-4a7e-bcdd-e75f5dc0ce6b
VERIDIAN_BASE_APPS_EXCLUDE=
# CORS (26/11/2026) : une origine hors liste ne reçoit plus « * » (rien de Veridian n'appelle d'ailleurs).
VERIDIAN_CORS_STRICT=true
VERIDIAN_CATALOGUE=1a1ab23e-60e5-4eca-be1f-718c96055c79:liste,58a58b5a-8a63-441b-b314-996221f309dd:liste,65f44458-3dde-49de-9b19-c52b60b5d1e8:liste,dccc9944-ddb7-4019-a95d-ec27679f70ba:liste,e3df4b02-559e-4624-b985-3fd49cfd1725:liste
VERIDIAN_CSP=report
IS_CONFIG_VARIABLES_IN_DB_ENABLED=false
# Budget de connexions pg-saas (parente, 09/11/2026) : 4 par pool, 2 pools (cœur, workspace).
PG_POOL_MAX_CONNECTIONS=4
PG_POOL_IDLE_TIMEOUT_MS=60000
MARKETPLACE_CATALOG_SYNC_CRON_ENABLED=false
# Grâce avant destruction d'un espace supprimé : 104 - 14 = 90 jours, comme le Hub (25/11/2026).
WORKSPACE_INACTIVE_DAYS_BEFORE_DELETION=104
EMAIL_DRIVER=logger
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
REDIS_URL=redis://:{{ sha256Hex (printf "crm-redis-%s" .POSTGRES_PASSWORD) }}@{{ env "NOMAD_HOST_IP_http" }}:${var.redis_port}
{{ end }}
{{ with nomadVar "veridian/ia-identite" }}
VERIDIAN_IA_IDENTITE_SECRET={{ .secret }}
AI_PROVIDERS='{"veridian":{"npm":"@ai-sdk/openai-compatible","name":"veridian","label":"Veridian","baseUrl":"https://app.veridian.site/api/ia/v1","apiKey":"{{ .cle_instance }}","models":[{"name":"veridian-auto","label":"Assistant Veridian","contextWindowTokens":200000,"maxOutputTokens":8192}]}}'
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

  # Redis à la forme exacte de la prod (groupe à part, sans canari) : une répétition en staging mesure ce que la prod vivra.
  group "redis" {
    count = 1

    constraint {
      attribute = "${meta.provider}"
      value     = "dragonair"
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
      driver         = "docker"
      shutdown_delay = "5s"
      config {
        security_opt = ["no-new-privileges:true"]
        labels = {
          "site.veridian.job"   = "${NOMAD_JOB_NAME}"
          "site.veridian.group" = "${NOMAD_GROUP_NAME}"
          "site.veridian.task"  = "${NOMAD_TASK_NAME}"
          "site.veridian.node"  = "${node.unique.name}"
          "site.veridian.tier"  = "saas-staging"
          "site.veridian.app"   = "crm"
        }
        image   = "ghcr.io/veridian-site/redis:7-20261126-cc2a313@sha256:f93473b0a94e5a62fe4988050e92984396381c69246b6c827a157d54788ab726"
        ports   = ["redis"]
        command = "redis-server"
        args    = ["--requirepass", "${REDIS_PASSWORD}", "--appendonly", "yes", "--maxmemory-policy", "noeviction", "--loglevel", "warning"]
        volumes = ["/opt/veridian-staging/crm/redis-groupe:/data"]
      }
      template {
        destination = "secrets/redis.env"
        perms       = "600"
        env         = true
        data        = <<EOH
{{ with nomadVar "nomad/jobs/crm-staging" }}REDIS_PASSWORD={{ sha256Hex (printf "crm-redis-%s" .POSTGRES_PASSWORD) }}{{ end }}
EOH
      }
      service {
        name     = "crm-staging-redis"
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
        memory     = 192
        memory_max = 384
      }
    }
  }
}
