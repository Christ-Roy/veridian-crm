"""Installe l'agent du téléphone (telephone.py) sur le Pixel, depuis `mail`, sans toucher à l'écran.

    crm-telephonie telephone cle       --env prod --workspace veridian-4   # clé du rôle « Téléphone », une fois
    crm-telephonie telephone installer --env prod --workspace veridian-4   # code, accès, service, démarrage
    crm-telephonie telephone relancer  --env prod --workspace veridian-4   # Termux tué par Android : tout repart
    crm-telephonie telephone revoquer  --env prod --workspace veridian-4   # téléphone perdu : la clé ne vaut plus rien

La clé est créée sur le bastion (rebond signé du Hub, au nom du membre rangé avec la clé Admin), rangée dans
~/credentials (`TWENTY_<ENV>_<WS>_TELEPHONE_*`), puis écrite sur le téléphone en 600 : elle passe par des tubes
ssh, jamais par l'écran ni par un fichier de `mail`. Rejouable : installer remplace le code par celui de
origin/staging et redémarre l'agent ; la clé existante est gardée.
"""
import hashlib
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
# Agent téléphone → CRM (veridian-crm, packages/twenty-apps/veridian/telephonie). Relancé par runit.
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
    # Android 12+ tue les processus enfants d'une app au-delà de 32 (« Trimming phantom processes ») : le 12/11 il a
    # tué l'agent, puis runsvdir et sshd. Limite levée, et la synchro serveur de device_config gelée pour qu'elle tienne.
    subprocess.run(["pixel", "shell", "device_config set_sync_disabled_for_tests persistent; device_config put "
                    "activity_manager max_phantom_processes 2147483647; settings put global "
                    "settings_enable_monitor_phantom_procs false"], capture_output=True, text=True, timeout=60)
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


TERMUX = "/data/data/com.termux/files"


def relancer(env=None, workspace=None):
    """Termux tué (mémoire, installation d'un module, composant modifié) : relance services, agent et sshd sans
    toucher à l'écran. adb exécute sous l'uid de Termux (build debuggable, run-as) et lui envoie RUN_COMMAND, ce que
    Termux n'accepte qu'avec allow-external-apps (la commande reste réservée aux apps qui ont sa permission)."""
    proprietes = f"{TERMUX}/home/.termux/termux.properties"
    commandes = [
        f"run-as com.termux sh -c 'mkdir -p {TERMUX}/home/.termux; grep -q \"^allow-external-apps *= *true\" "
        f"{proprietes} 2>/dev/null || echo \"allow-external-apps = true\" >> {proprietes}'",
        f"run-as com.termux /system/bin/am startservice --user 0 -n com.termux/com.termux.app.RunCommandService "
        f"-a com.termux.RUN_COMMAND --es com.termux.RUN_COMMAND_PATH {TERMUX}/usr/bin/sh --esa "
        f"com.termux.RUN_COMMAND_ARGUMENTS '-c,. {TERMUX}/usr/etc/profile.d/start-services.sh; termux-wake-lock' "
        f"--ez com.termux.RUN_COMMAND_BACKGROUND true",
    ]
    for commande in commandes:
        resultat = subprocess.run(["pixel", "shell", commande], capture_output=True, text=True, timeout=60)
        if "Exception" in resultat.stdout + resultat.stderr:
            raise c.NonAbouti(f"relance refusée : {(resultat.stdout + resultat.stderr).strip()[-200:]}")
    for _ in range(12):
        processus = subprocess.run(["pixel", "shell", "ps -A -o ARGS"], capture_output=True, text=True,
                                   timeout=60).stdout
        if "telephone.py" in processus and "sshd" in processus:
            print("agent et sshd relancés")
            return 0
        subprocess.run(["sleep", "5"])
    raise c.NonAbouti("agent ou sshd toujours absents après la relance")


REVOQUER_CLE = r'''
import sys
sys.path.insert(0, "/home/brunon5/.claude/skills/twenty-cli/bin")
import twenty_admin as ta
env, ws = sys.argv[1], sys.argv[2]
p = ta.prefixe(env, ws)
creds = ta.lire_creds()
cle_id = creds.get(p + "_TELEPHONE_API_KEY_ID")
if not cle_id:
    print("aucune clé Téléphone rangée"); sys.exit(1)
client = ta.Client(env)
origine, jeton, _ = client.session(creds[p + "_EMAIL"], ws)
client.gql(origine, "mutation($i:RevokeApiKeyInput!){revokeApiKey(input:$i){id}}", {"i": {"id": cle_id}}, jeton)
ta.ecrire_creds({}, retirer=[p + "_TELEPHONE_API_URL", p + "_TELEPHONE_API_KEY", p + "_TELEPHONE_API_KEY_ID"])
print("révoquée " + cle_id)
'''


def revoquer(env, workspace):
    """Téléphone perdu ou volé : la clé du rôle Téléphone est révoquée dans le CRM (l'API répond alors 403) et
    retirée du bastion. Si le téléphone répond encore, l'agent s'arrête et son accès est effacé. Pour repartir :
    `crm-telephonie telephone cle` puis `installer`."""
    _, cle = c.charger_acces(env, workspace, suffixe="TELEPHONE_")
    empreinte = hashlib.sha256(cle.encode()).hexdigest()
    distante = "sudo -u brunon5 python3 -c " + shlex.quote(REVOQUER_CLE) + f" {shlex.quote(env)} {shlex.quote(workspace)}"
    print("clé Téléphone :", c.executer(["ssh", c.BASTION, distante], delai=120).strip())
    try:
        # Le téléphone n'est arrêté que s'il porte cette clé-là : révoquer une clé de staging ne coupe pas la prod.
        sur_le_telephone = _pixel("python3 -c 'import json,hashlib,os;print(hashlib.sha256(json.load(open("
                                  "os.path.expanduser(\"~/.config/crm-telephone/acces.json\")))[\"cle\"].encode())"
                                  ".hexdigest())' 2>/dev/null || true", delai=60).strip()
        if sur_le_telephone != empreinte:
            print("le téléphone porte une autre clé : agent laissé en marche")
            return 0
        _pixel(". $PREFIX/etc/profile.d/start-services.sh; sv down crm-telephone; rm -f ~/.config/crm-telephone/acces.json",
               delai=60)
        print("téléphone joint : agent arrêté, accès effacé")
    except (c.NonAbouti, subprocess.SubprocessError, OSError):
        print("téléphone injoignable : la clé est révoquée de toute façon, l'agent ne peut plus rien écrire")
    return 0
