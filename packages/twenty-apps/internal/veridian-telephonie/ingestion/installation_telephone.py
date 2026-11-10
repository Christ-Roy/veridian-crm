"""Installe l'agent du téléphone (telephone.py) sur le Pixel, depuis `mail`, sans toucher à l'écran.

    crm-telephonie telephone cle       --env prod --workspace veridian-4   # clé du rôle « Téléphone », une fois
    crm-telephonie telephone installer --env prod --workspace veridian-4   # code, accès, service, démarrage

La clé est créée sur le bastion (rebond signé du Hub, au nom du membre rangé avec la clé Admin), rangée dans
~/credentials (`TWENTY_<ENV>_<WS>_TELEPHONE_*`), puis écrite sur le téléphone en 600 : elle passe par des tubes
ssh, jamais par l'écran ni par un fichier de `mail`. Rejouable : installer remplace le code par celui de
origin/staging et redémarre l'agent ; la clé existante est gardée.
"""
import json
import shlex
import subprocess

import crm_telephonie as c

CREER_CLE = r'''
import sys
from datetime import datetime, timedelta, timezone
sys.path.insert(0, "/home/brunon5/.claude/skills/twenty-cli/bin")
import twenty_admin as ta
env, ws = sys.argv[1], sys.argv[2]
p = ta.prefixe(env, ws)
creds = ta.lire_creds()
if creds.get(p + "_TELEPHONE_API_KEY"):
    print("présente"); sys.exit(0)
client = ta.Client(env)
origine, jeton, espace = client.session(creds[p + "_EMAIL"], ws)
roles = client.gql(origine, "{getApiKeyRoles{id label}}", jeton=jeton)["getApiKeyRoles"]
role = next((r for r in roles if r["label"] == "Téléphone"), None)
if role is None:
    print("rôle Téléphone absent : crm-telephonie app apply d'abord"); sys.exit(1)
expire = (datetime.now(timezone.utc) + timedelta(days=3650)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
cle = client.gql(origine, "mutation($i:CreateApiKeyInput!){createApiKey(input:$i){id}}",
                 {"i": {"name": "telephone-pixel", "expiresAt": expire, "roleId": role["id"]}}, jeton)["createApiKey"]
jeton_cle = client.gql(origine, "mutation($a:UUID!,$e:String!){generateApiKeyToken(apiKeyId:$a,expiresAt:$e){token}}",
                       {"a": cle["id"], "e": expire}, jeton)["generateApiKeyToken"]["token"]
ta.ecrire_creds({p + "_TELEPHONE_API_URL": origine, p + "_TELEPHONE_API_KEY": jeton_cle,
                 p + "_TELEPHONE_API_KEY_ID": cle["id"]})
print("créée " + cle["id"])
'''

SERVICE_RUN = """#!/data/data/com.termux/files/usr/bin/sh
# Agent téléphone → CRM (veridian-crm, packages/twenty-apps/internal/veridian-telephonie). Relancé par runit.
exec 2>&1
exec python3 -u "$HOME/crm-telephone/telephone.py"
"""

DEMARRAGE = """#!/data/data/com.termux/files/usr/bin/sh
# Termux:Boot : au démarrage du téléphone, garder Termux éveillé, rouvrir sshd et lancer les services (agent CRM).
termux-wake-lock
sshd
. "$PREFIX/etc/profile.d/start-services.sh"
"""


def _pixel(commande, entree=None, delai=300):
    resultat = subprocess.run(["ssh", "pixel", commande], input=entree, capture_output=True, text=True, timeout=delai)
    if resultat.returncode != 0:
        raise c.NonAbouti(f"pixel : {commande[:60]} : code {resultat.returncode} {resultat.stderr.strip()[:200]}")
    return resultat.stdout


def _ecrire(chemin, contenu, mode="600"):
    _pixel(f"umask 077; mkdir -p \"$(dirname {chemin})\" && cat > {chemin} && chmod {mode} {chemin}", contenu)


def creer_cle(env, workspace):
    distante = "sudo -u brunon5 python3 -c " + shlex.quote(CREER_CLE) + f" {shlex.quote(env)} {shlex.quote(workspace)}"
    print("clé Téléphone :", c.executer(["ssh", c.BASTION, distante], delai=120).strip())
    return 0


def installer(env, workspace):
    url, cle = c.charger_acces(env, workspace, suffixe="TELEPHONE_")
    for paquet, outil in (("termux-services", "sv-enable"), ("inotify-tools", "inotifywait"), ("ffmpeg", "ffmpeg")):
        # Un par un : une installation groupée qui échoue sur un paquet n'installait rien, sans le dire.
        _pixel(f"command -v {outil} >/dev/null || (yes | pkg install -y {paquet} >/dev/null 2>&1); command -v {outil}",
               delai=900)
    for nom in ("crm_telephonie.py", "telephone.py"):
        _ecrire(f"~/crm-telephone/{nom}", (c.APP_DIR / "ingestion" / nom).read_text(encoding="utf-8"), "700")
    _ecrire("~/.config/crm-telephone/acces.json", json.dumps({"url": url, "cle": cle}))
    service = "$PREFIX/var/service/crm-telephone"
    _ecrire(f"{service}/run", SERVICE_RUN, "700")
    _pixel(f"mkdir -p {service}/log && ln -sf $PREFIX/share/termux-services/svlogger {service}/log/run")
    _ecrire("~/.termux/boot/demarrer", DEMARRAGE, "700")
    # sshd en service runit : il repart seul quand Android tue Termux, plus besoin de le retaper à l'écran.
    _pixel("command -v sv-enable >/dev/null && . $PREFIX/etc/profile.d/start-services.sh && sv-enable sshd")
    # Le service se lance dans la session Termux en cours ; Termux:Boot le relancera après un redémarrage.
    print(_pixel(f". $PREFIX/etc/profile.d/start-services.sh; sv-enable crm-telephone >/dev/null 2>&1; "
                 "sv restart crm-telephone; sleep 3; sv status crm-telephone").strip())
    boot = subprocess.run(["pixel", "shell", "pm list packages com.termux.boot"], capture_output=True, text=True,
                          timeout=60).stdout.strip()
    if "com.termux.boot" not in boot:
        print("⚠ Termux:Boot absent : sans lui, l'agent ne repart pas après un redémarrage du téléphone.")
    return 0
