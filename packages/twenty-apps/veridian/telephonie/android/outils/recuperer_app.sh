#!/usr/bin/env bash
# L app Twenty « Téléphonie » (ingestion Python de référence, src, manifeste) vit depuis le 16/11/2026 dans le dépôt
# privé Veridian-site/veridian-crm-apps. La CI de ce dépôt public la récupère par une clé de déploiement en lecture
# seule (secret VERIDIAN_CRM_APPS_DEPLOY_KEY) et la pose dans ../ pour que les chemins relatifs d android/ tiennent.
set -euo pipefail
: "${VERIDIAN_CRM_APPS_DEPLOY_KEY:?secret VERIDIAN_CRM_APPS_DEPLOY_KEY absent}"
ICI="$(cd "$(dirname "$0")/.." && pwd)"          # .../telephonie/android
CIBLE="$(dirname "$ICI")"                           # .../telephonie
T="$(mktemp -d)"; trap "rm -rf $T" EXIT
umask 077; printf "%s\n" "$VERIDIAN_CRM_APPS_DEPLOY_KEY" > "$T/cle"
GIT_SSH_COMMAND="ssh -i $T/cle -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$T/hotes" \
  git clone -q --depth 1 git@github.com:Veridian-site/veridian-crm-apps.git "$T/apps"
echo "app Twenty telephonie : veridian-crm-apps $(git -C "$T/apps" rev-parse --short HEAD)"
for f in ingestion src package.json yarn.lock tsconfig.json .yarnrc.yml .nvmrc LISEZMOI.md; do cp -r "$T/apps/telephonie/$f" "$CIBLE/$f"; done
