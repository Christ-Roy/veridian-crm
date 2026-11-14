#!/usr/bin/env bash
# deployer.sh <plan|apply> <env> <workspace> : twenty app plan|apply de l'app Dossiers sur un workspace.
# La clé est lue dans ~/credentials/.all-creds.env (twenty-admin agent:grant), jamais affichée.
set -euo pipefail
ACTION=$1; ENV=$2; WS=$3
P="TWENTY_$(echo "$ENV" | tr a-z A-Z)_$(echo "$WS" | tr a-z- A-Z_)_"
eval "$(python3 - "$P" <<'PY'
import sys, shlex
p = sys.argv[1]; v = {}
for l in open('/home/brunon5/credentials/.all-creds.env'):
    l = l.strip()
    if l.startswith('export '): l = l[7:]
    k, _, x = l.partition('=')
    if k in (p + 'API_URL', p + 'API_KEY'): v[k] = x.strip().strip('"').strip("'")
if len(v) != 2: sys.exit('clé absente : ' + p + 'API_KEY (twenty-admin agent:grant)')
print('export TWENTY_API_URL=' + shlex.quote(v[p + 'API_URL']) + ' TWENTY_API_KEY=' + shlex.quote(v[p + 'API_KEY']))
PY
)"
cd "$(dirname "$0")"
export PATH="$HOME/.local/twenty-cli/node/bin:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0
EXTRA=(); [ "$ACTION" = apply ] && EXTRA=(--create)
[ "$ACTION" = uninstall ] && exec corepack yarn twenty app uninstall --yes --no-input
exec corepack yarn twenty app "$ACTION" --no-prune --no-input "${EXTRA[@]}"
