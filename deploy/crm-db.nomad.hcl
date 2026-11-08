# crm-db : Postgres et Redis de Veridian CRM, hors du job applicatif `crm` : déployer l'app ne coupe
# plus la base (lint BASE-GROUPE). Patron : jobs/medusa-prod/asd-db.nomad.hcl.
#
# Nœud retenu par infra le 07/11/2026 : ovh-prod (fsync p50 0,61 ms, 7 Go libres).
# Ports tailnet statiques : 15433 et 16380, 15432 étant pris par hub-db sur ce nœud.
# pgBackRest : stanza, dépôt et drill posés par infra au premier déploiement (RPO 15 min).
#
# Secrets (Nomad var nomad/jobs/crm-db) : POSTGRES_PASSWORD et REDIS_PASSWORD, en hexadécimal car ils
# entrent dans des URL, recopiés dans nomad/jobs/crm ; SFTP_REPO_*, PGBACKREST_CIPHER_PASS. Volumes :
#   sudo install -d -o 70 -g 70 /opt/veridian-prod/crm-db/pgdata
#   sudo install -d -o 999 -g 999 /opt/veridian-prod/crm-db/redis

job "crm-db" {
  datacenters = ["veridian-eu"]
  type        = "service"
  priority    = 80

  group "db" {
    count = 1

    meta = {
      "env"        = "prod"
      "disposable" = "false"
    }

    constraint {
      attribute = "${meta.provider}"
      value     = "ovh-prod"
    }


    restart {
      attempts = 10
      interval = "10m"
      delay    = "2s"
      mode     = "delay"
    }

    reschedule {
      unlimited      = true
      delay          = "30s"
      delay_function = "exponential"
      max_delay      = "10m"
    }

    network {
      mode = "bridge"
      port "pg" {
        static       = 15433
        to           = 5432
        host_network = "tailscale"
      }
      port "redis" {
        static       = 16380
        to           = 6379
        host_network = "tailscale"
      }
    }

    task "postgres" {
      driver = "docker"
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
        image = "ghcr.io/christ-roy/veridian-postgres-pgbackrest:16-alpine@sha256:ca672c3127d4e9e1fef42e813ecd751a6759ed4e7916e44a6ae7fb3a6862716e"
        ports = ["pg"]
        volumes = [
          "/opt/veridian-prod/crm-db/pgdata:/var/lib/postgresql/data",
        ]
        args = [
          "-c", "tcp_keepalives_idle=20", "-c", "tcp_keepalives_interval=10", "-c", "tcp_keepalives_count=6",
          "-c", "unix_socket_directories=/var/run/postgresql,/alloc",
          "-c", "archive_mode=on",
          "-c", "archive_command=pgbackrest --stanza=crm-db archive-push %p",
          "-c", "archive_timeout=300",
          "-c", "wal_level=replica",
        ]
      }
      template {
        destination = "secrets/pgbackrest-repo.key"
        perms       = "600"
        uid         = 70
        gid         = 70
        data        = <<EOH
{{ with nomadVar "nomad/jobs/crm-db" }}{{ .SFTP_REPO_KEY }}{{ end }}
EOH
      }

      template {
        destination = "secrets/pgbackrest-repo.key.pub"
        perms       = "644"
        uid         = 70
        gid         = 70
        data        = <<EOH
{{ with nomadVar "nomad/jobs/crm-db" }}{{ .SFTP_REPO_KEY_PUB }}{{ end }}
EOH
      }

      template {
        destination = "secrets/pg.env"
        perms       = "600" # secret: lisible du seul proprietaire
        env         = true
        data        = <<EOH
TZ=UTC
POSTGRES_USER=twenty
POSTGRES_DB=twenty
{{ with nomadVar "nomad/jobs/crm-db" }}
POSTGRES_PASSWORD={{ .POSTGRES_PASSWORD }}
{{ end }}
PGBACKREST_REPO1_TYPE=sftp
{{ with nomadVar "nomad/jobs/crm-db" }}PGBACKREST_REPO1_SFTP_HOST={{ .SFTP_REPO_HOST }}{{ end }}
PGBACKREST_REPO1_SFTP_HOST_USER=pgbackrest
PGBACKREST_REPO1_SFTP_PRIVATE_KEY_FILE=/secrets/pgbackrest-repo.key
PGBACKREST_REPO1_SFTP_PUBLIC_KEY_FILE=/secrets/pgbackrest-repo.key.pub
PGBACKREST_REPO1_SFTP_HOST_KEY_CHECK_TYPE=fingerprint
PGBACKREST_REPO1_SFTP_HOST_KEY_HASH_TYPE=sha1
{{ with nomadVar "nomad/jobs/crm-db" }}PGBACKREST_REPO1_SFTP_HOST_FINGERPRINT={{ .SFTP_REPO_FP }}{{ end }}
PGBACKREST_REPO1_PATH=/data/crm-db
PGBACKREST_REPO1_CIPHER_TYPE=aes-256-cbc
PGBACKREST_COMPRESS_TYPE=zst
PGBACKREST_COMPRESS_LEVEL=6
PGBACKREST_REPO1_BUNDLE=y
PGBACKREST_REPO1_BLOCK=y
PGBACKREST_LOG_LEVEL_CONSOLE=info
PGBACKREST_LOG_LEVEL_FILE=off
PGBACKREST_PG1_PATH=/var/lib/postgresql/data
PGBACKREST_PG1_PORT=5432
PGBACKREST_PG1_USER=twenty
PGBACKREST_PG1_DATABASE=twenty
{{ with nomadVar "nomad/jobs/crm-db" }}
PGBACKREST_REPO1_CIPHER_PASS={{ .PGBACKREST_CIPHER_PASS }}
{{ end }}
EOH
      }
      service {
        name     = "crm-db-pg"
        provider = "nomad"
        port     = "pg"
        check {
          type     = "tcp"
          interval = "20s"
          timeout  = "5s"
        }
      }
      resources {
        cpu        = 200
        memory     = 256
        memory_max = 3072
      }
    }

    task "pgbackrest" {
      driver = "docker"
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
        image      = "ghcr.io/christ-roy/veridian-postgres-pgbackrest:16-alpine@sha256:ca672c3127d4e9e1fef42e813ecd751a6759ed4e7916e44a6ae7fb3a6862716e"
        entrypoint = ["/usr/local/bin/pgbackrest-scheduler"]
        command    = ""
        volumes = [
          "/opt/veridian-prod/crm-db/pgdata:/var/lib/postgresql/data",
        ]
      }
      user = "postgres"

      template {
        destination = "secrets/pgbackrest-repo.key"
        perms       = "600"
        uid         = 70
        gid         = 70
        data        = <<EOH
{{ with nomadVar "nomad/jobs/crm-db" }}{{ .SFTP_REPO_KEY }}{{ end }}
EOH
      }

      template {
        destination = "secrets/pgbackrest-repo.key.pub"
        perms       = "644"
        uid         = 70
        gid         = 70
        data        = <<EOH
{{ with nomadVar "nomad/jobs/crm-db" }}{{ .SFTP_REPO_KEY_PUB }}{{ end }}
EOH
      }

      template {
        destination = "secrets/pgbackrest.env"
        perms       = "600" # secret: lisible du seul proprietaire
        env         = true
        data        = <<EOH
TZ=UTC
PGBR_STANZA=crm-db
PGBACKREST_PG1_SOCKET_PATH=/alloc
PGBR_FULL_DOW=0
PGBR_DAILY_HOUR=3
PGBR_DAILY_MINUTE=35
PGBR_INCR_EVERY_H=6
PGBACKREST_REPO1_RETENTION_FULL=12
PGBACKREST_REPO1_RETENTION_DIFF=7
PGBACKREST_PROCESS_MAX=2
PGBACKREST_START_FAST=y
PGBACKREST_REPO1_TYPE=sftp
{{ with nomadVar "nomad/jobs/crm-db" }}PGBACKREST_REPO1_SFTP_HOST={{ .SFTP_REPO_HOST }}{{ end }}
PGBACKREST_REPO1_SFTP_HOST_USER=pgbackrest
PGBACKREST_REPO1_SFTP_PRIVATE_KEY_FILE=/secrets/pgbackrest-repo.key
PGBACKREST_REPO1_SFTP_PUBLIC_KEY_FILE=/secrets/pgbackrest-repo.key.pub
PGBACKREST_REPO1_SFTP_HOST_KEY_CHECK_TYPE=fingerprint
PGBACKREST_REPO1_SFTP_HOST_KEY_HASH_TYPE=sha1
{{ with nomadVar "nomad/jobs/crm-db" }}PGBACKREST_REPO1_SFTP_HOST_FINGERPRINT={{ .SFTP_REPO_FP }}{{ end }}
PGBACKREST_REPO1_PATH=/data/crm-db
PGBACKREST_REPO1_CIPHER_TYPE=aes-256-cbc
PGBACKREST_COMPRESS_TYPE=zst
PGBACKREST_COMPRESS_LEVEL=6
PGBACKREST_REPO1_BUNDLE=y
PGBACKREST_REPO1_BLOCK=y
PGBACKREST_LOG_LEVEL_CONSOLE=info
PGBACKREST_LOG_LEVEL_FILE=off
PGBACKREST_PG1_PATH=/var/lib/postgresql/data
PGBACKREST_PG1_PORT=5432
PGBACKREST_PG1_USER=twenty
PGBACKREST_PG1_DATABASE=twenty
{{ with nomadVar "nomad/jobs/crm-db" }}
PGBACKREST_REPO1_CIPHER_PASS={{ .PGBACKREST_CIPHER_PASS }}
{{ end }}
EOH
      }

      resources {
        cpu        = 100
        memory     = 32
        memory_max = 512
      }
    }

    task "redis" {
      driver = "docker"
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
        volumes = ["/opt/veridian-prod/crm-db/redis:/data"]
      }
      template {
        destination = "secrets/redis.env"
        perms       = "600"
        env         = true
        data        = <<EOH
{{ with nomadVar "nomad/jobs/crm-db" }}REDIS_PASSWORD={{ .REDIS_PASSWORD }}{{ end }}
EOH
      }
      service {
        name     = "crm-db-redis"
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
