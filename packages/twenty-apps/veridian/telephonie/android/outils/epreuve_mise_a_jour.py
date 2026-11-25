#!/usr/bin/env python3
"""Épreuve de mise à jour de l'app sur émulateur, contre un faux CRM (outils/faux_crm.py), jamais contre un vrai téléphone.

  epreuve_mise_a_jour.py --adb ADB --serie emulator-5554 --ancien ancien.apk --nouveau nouveau.apk
        [--scenario normal|effacement|perte-file] [--crm 8444]

Joue : l'ancienne version configurée (écriture, clé) traite SMS et appels injectés dans le téléphone ; le CRM tombe en panne,
des événements restent en file ; mise à jour par `adb install -r` ; le CRM revient. Compare avant/après : mode, accès, schéma,
clé, base (file, synchro, curseurs, adresse du CRM), aucun doublon créé, aucun événement perdu, service vivant, aucune
demande d'activation (/metadata). Les scénarios `effacement` et `perte-file` sabotent la mise à jour : la comparaison DOIT
échouer (contrôle négatif). Sortie : 0 tout est tenu, 1 une preuve échoue, 2 non abouti.
Prérequis : HOME pointe le dossier du jeton de la console de l'émulateur ; émulateur rooté (adb root) dont le magasin système contient le certificat du faux CRM, faux CRM lancé,
personnes Alice (+33611111111) et Bob (+33622222222) déjà dans le faux CRM.
"""
import argparse
import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

PAQUET = "site.veridian.telephonie"
EXT = f"/sdcard/Android/data/{PAQUET}/files"
CLE = "CLEFAUSSE123"
CONNUS = ["+33611111111", "+33622222222"]
INCONNU = "+33699999999"


class NonAbouti(Exception):
    pass


class Banc:
    def __init__(self, a):
        self.adb, self.serie, self.crm = a.adb, a.serie, f"http://127.0.0.1:{a.crm}"
        self.travail = Path(tempfile.mkdtemp(prefix="epreuve-"))
        self.serie_id = f"{int(time.time()) % 100000:05d}"
        self.base_duree = 1000 + int(self.serie_id)
        self.n_appels = 0
        self.injectes = []

    def sh(self, commande, delai=60):
        r = subprocess.run([self.adb, "-s", self.serie, "shell", commande], capture_output=True, text=True, timeout=delai)
        return r.stdout.replace("\r", "")

    def adb_(self, *args, delai=300):
        r = subprocess.run([self.adb, "-s", self.serie, *args], capture_output=True, text=True, timeout=delai)
        return r.returncode, (r.stdout + r.stderr).replace("\r", "")

    def commande(self, c, *extra):
        sortie = self.sh(f"am broadcast -a {PAQUET}.COMMANDE -n {PAQUET}/.Commandes --es c {c} {' '.join(extra)}")
        return sortie.split('data="', 1)[1].rsplit('"', 1)[0] if 'data="' in sortie else sortie

    def crm_get(self, chemin):
        return json.load(urllib.request.urlopen(self.crm + chemin, timeout=10))

    def crm_post(self, chemin, corps=None):
        req = urllib.request.Request(self.crm + chemin, data=json.dumps(corps or {}).encode(), method="POST")
        return json.load(urllib.request.urlopen(req, timeout=10))

    # ------------------------------------------------------------ données injectées dans le téléphone

    def sms(self, numero, texte, sens=1):
        """SMS reçu par le modem de l'émulateur (la console exige $HOME/.emulator_console_auth_token lisible) : le fournisseur
        SMS refuse l'insertion directe par `content insert`."""
        r = subprocess.run([self.adb, "-s", self.serie, "emu", "sms", "send", numero, texte], capture_output=True, text=True, timeout=30)
        if "OK" not in r.stdout:
            raise NonAbouti(f"SMS non injecté : {r.stdout} {r.stderr}")
        self.injectes.append(("sms", numero, texte, numero in CONNUS))
        time.sleep(1.2)

    def appel(self, numero, _duree=None, sens=1):
        self.n_appels += 1
        duree = self.base_duree + self.n_appels
        self.sh(f"content insert --uri content://call_log/calls --bind number:s:{numero} --bind type:i:{sens} "
                f"--bind date:l:{int(time.time() * 1000)} --bind duration:i:{duree}")
        self.injectes.append(("appel", numero, str(duree), numero in CONNUS))
        time.sleep(0.05)

    def lot(self, nom, sms_connus, sms_inconnus, appels_connus, appels_inconnus):
        for i in range(sms_connus):
            self.sms(CONNUS[i % 2], f"{self.serie_id}{nom}-connu-{i}")
        for i in range(sms_inconnus):
            self.sms(INCONNU, f"{self.serie_id}{nom}-inconnu-{i}")
        for i in range(appels_connus):
            self.appel(CONNUS[i % 2], sens=1 + i % 2)
        for i in range(appels_inconnus):
            self.appel(INCONNU)

    # ------------------------------------------------------------ mesures

    def base(self):
        dossier = self.travail / "base"
        shutil.rmtree(dossier, ignore_errors=True)
        dossier.mkdir()
        for suffixe in ("", "-wal", "-shm"):
            self.adb_("pull", f"/data/data/{PAQUET}/databases/telephonie.db{suffixe}", str(dossier / f"t.db{suffixe}"))
        if not (dossier / "t.db").exists():
            raise NonAbouti("base illisible (émulateur rooté ?)")
        c = sqlite3.connect(dossier / "t.db")
        kv = dict(c.execute("SELECT cle, valeur FROM kv"))
        r = {"file": c.execute("SELECT COUNT(*) FROM file").fetchone()[0], "synchro": c.execute("SELECT COUNT(*) FROM synchro").fetchone()[0],
             "televersements": c.execute("SELECT COUNT(*) FROM televersements").fetchone()[0],
             "curseurs": {k: v for k, v in kv.items() if k.startswith("curseur.")}, "crm_url": kv.get("crm.url"),
             "premiere_lecture": kv.get("premiere-lecture"), "idsynchro": sorted(f"{p}|{i}" for p, i in c.execute("SELECT pluriel, idSource FROM synchro"))}
        c.close()
        return r

    def etat(self):
        self.commande("etat")
        rc, _ = self.adb_("pull", f"{EXT}/etat.json", str(self.travail / "etat.json"))
        if rc:
            raise NonAbouti("etat.json illisible")
        return json.loads((self.travail / "etat.json").read_text())

    def photo(self, nom):
        e = self.etat()
        return {"nom": nom, "etat": e, "base": self.base(), "crm": self.crm_get("/etat"), "version": e["version"]}

    def attendre(self, condition, delai, quoi):
        fin = time.time() + delai
        while time.time() < fin:
            if condition():
                return
            time.sleep(2)
        raise NonAbouti(f"délai dépassé : {quoi}")

    def livres(self):
        """{texte ou durée: nombre de records au CRM} pour tout ce qui a été injecté."""
        r = self.crm_get("/records")
        sortie = {}
        for x in r["textMessages"]:
            sortie[x.get("texte")] = sortie.get(x.get("texte"), 0) + 1
        for x in r["appels"]:
            cle = str(x.get("dureeSecondes"))
            sortie[cle] = sortie.get(cle, 0) + 1
        return sortie


# ------------------------------------------------------------ comparaison

def comparer(banc, avant, apres, attendu_apres):
    """Liste des écarts. `attendu_apres` : {clé: nombre de records attendus au CRM} pour tout ce qui a été injecté."""
    p = []
    ea, ep = avant["etat"]["reglages"], apres["etat"]["reglages"]
    for champ in ("mode", "acces", "schema", "cle_sha256_12", "appareil", "transcription", "messagerie", "historique_depuis_ms"):
        if ea.get(champ) != ep.get(champ):
            p.append(f"réglage {champ} : {ea.get(champ)} → {ep.get(champ)}")
    if not ep.get("crm"):
        p.append("accès au CRM plus configuré")
    if ep.get("reconnexion") is not None:
        p.append(f"reconnexion demandée : {ep['reconnexion']}")
    if apres["version"] == avant["version"]:
        p.append("la version n'a pas changé")
    ba, bp = avant["base"], apres["base"]
    perdues = set(ba["idsynchro"]) - set(bp["idsynchro"])
    if perdues:
        p.append(f"{len(perdues)} empreinte(s) de synchro oubliée(s) (ex. {sorted(perdues)[:2]})")
    for flux, valeur in ba["curseurs"].items():
        if int(bp["curseurs"].get(flux, 0)) < int(valeur):
            p.append(f"curseur {flux} reculé : {valeur} → {bp['curseurs'].get(flux)}")
    if ba["crm_url"] not in (None, bp["crm_url"]):
        p.append(f"adresse du CRM notée : {ba['crm_url']} → {bp['crm_url']}")
    if ep.get("mode") == "miroir" and ea["mode"] != "miroir":
        p.append("repassée en mode essai : l'envoi est coupé")
    if apres["etat"]["preparation"] not in ("PRET", "INCONNU"):
        p.append(f"préparation du CRM : {apres['etat']['preparation']}")
    ca, cp = avant["crm"], apres["crm"]
    if cp["doublons"]:
        p.append(f"doublons au CRM : {cp['doublons']}")
    if cp["metadata"]:
        p.append(f"l'app a demandé une activation au CRM : {cp['metadata'][:1]}")
    for cle in ca["creations"]:
        if len(cp["creations"].get(cle, [])) != len(ca["creations"][cle]):
            p.append(f"{cle} recréé ou perdu après la mise à jour")
    livres = banc.livres()
    for cle, voulu in attendu_apres.items():
        if livres.get(cle, 0) != voulu:
            p.append(f"envoi {'perdu' if livres.get(cle, 0) < voulu else 'en double'} : « {cle} » au CRM {livres.get(cle, 0)} fois, attendu {voulu}")
    return p


def attendu(banc, apres_maj_inconnus_retenus):
    """Ce que le CRM doit porter pour tout ce qui a été injecté. Les SMS inconnus injectés après la mise à jour restent sur le téléphone."""
    r = {}
    for genre, numero, cle, connu in banc.injectes:
        retenu = genre == "sms" and not connu and cle in apres_maj_inconnus_retenus
        r[cle] = 0 if retenu else 1
    return r


def jouer(a):
    banc = Banc(a)
    banc.adb_("root")
    time.sleep(3)
    banc.crm_post("/reinit")
    banc.adb_("uninstall", PAQUET)
    rc, sortie = banc.adb_("install", "-r", "-g", a.ancien)
    if "Success" not in sortie:
        raise NonAbouti(f"installation de l'ancienne version : {sortie}")
    for permission in ("READ_CALL_LOG", "READ_SMS", "RECEIVE_SMS", "RECEIVE_MMS", "READ_CONTACTS", "READ_PHONE_STATE", "POST_NOTIFICATIONS", "WRITE_SECURE_SETTINGS"):
        banc.sh(f"pm grant {PAQUET} android.permission.{permission}")
    banc.sh(f"appops set {PAQUET} RUN_ANY_IN_BACKGROUND allow; appops set {PAQUET} RUN_IN_BACKGROUND allow; dumpsys deviceidle whitelist +{PAQUET}")
    # Réglages posés AVANT le premier lancement (comme ceux du Pixel de Robert) : sans eux, la première lecture bâtirait ses
    # événements avec l'appareil de l'émulateur (AUTRE) et le CRM en recevrait deux versions.
    uid = banc.sh(f"stat -c %u /data/data/{PAQUET}").strip()
    xml = ("<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n  <int name=\"schema\" value=\"3\" />\n"
           "  <string name=\"mode\">ecriture</string>\n  <string name=\"r.appareil\">PIXEL_8_PRO</string>\n</map>\n")
    banc.sh(f"mkdir -p /data/data/{PAQUET}/shared_prefs")
    subprocess.run([banc.adb, "-s", banc.serie, "shell", f"cat > /data/data/{PAQUET}/shared_prefs/reglages.xml"], input=xml.encode(), check=True)
    banc.sh(f"chown -R {uid}:{uid} /data/data/{PAQUET}/shared_prefs; chmod 660 /data/data/{PAQUET}/shared_prefs/reglages.xml; restorecon -R /data/data/{PAQUET}/shared_prefs")
    banc.commande("demarrer")
    time.sleep(3)
    banc.sh(f"mkdir -p {EXT}")
    subprocess.run([banc.adb, "-s", banc.serie, "shell", f"cat > {EXT}/acces.json"], input=json.dumps({"url": "https://10.0.2.2:8443", "cle": CLE}).encode(), check=True)
    print("configurer :", banc.commande("configurer"))

    banc.lot("hist", 6, 3, 3, 2)
    attendu_hist = attendu(banc, set())
    banc.attendre(lambda: all(banc.livres().get(k, 0) == v for k, v in attendu_hist.items()), 120, "livraison de l'historique par l'ancienne version")
    print(f"ancienne version : {len(attendu_hist)} événements livrés au faux CRM")

    banc.crm_post("/panne?code=503")
    banc.lot("panne", 4, 2, 2, 1)
    banc.attendre(lambda: banc.etat()["file"] >= 9, 60, "événements gardés en file pendant la panne")
    avant = banc.photo("avant")
    print(f"avant : version {avant['version']} mode={avant['etat']['reglages']['mode']} acces={avant['etat']['reglages']['acces']} "
          f"file={avant['base']['file']} synchro={avant['base']['synchro']} crm.url={avant['base']['crm_url']}")

    if a.scenario == "perte-file":
        banc.sh(f"am force-stop {PAQUET}")
        db = banc.travail / "sabotage"
        db.mkdir(exist_ok=True)
        for s in ("", "-wal", "-shm"):
            banc.adb_("pull", f"/data/data/{PAQUET}/databases/telephonie.db{s}", str(db / f"t.db{s}"))
        c = sqlite3.connect(db / "t.db")
        c.execute("DELETE FROM file")
        # sans cela, la relecture du téléphone (15 min de recouvrement) renverrait ce que la file a perdu : le curseur est avancé
        c.execute("UPDATE kv SET valeur = ? WHERE cle LIKE 'curseur.%'", (str(int(time.time() * 1000) + 3_600_000),))
        c.commit()
        c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        c.close()
        banc.sh(f"rm -f /data/data/{PAQUET}/databases/telephonie.db-wal /data/data/{PAQUET}/databases/telephonie.db-shm")
        banc.adb_("push", str(db / "t.db"), f"/data/data/{PAQUET}/databases/telephonie.db")
        banc.sh(f"chown {uid}:{uid} /data/data/{PAQUET}/databases/telephonie.db; chmod 660 /data/data/{PAQUET}/databases/telephonie.db; restorecon /data/data/{PAQUET}/databases/telephonie.db")
    if a.scenario == "effacement":
        rc, sortie = banc.adb_("uninstall", PAQUET)
        banc.adb_("install", "-g", a.nouveau)
    else:
        rc, sortie = banc.adb_("install", "-r", a.nouveau)
        if "Success" not in sortie:
            raise NonAbouti(f"installation de la nouvelle version : {sortie}")
    print("installation :", sortie.strip().splitlines()[-1])
    if a.scenario == "effacement":
        banc.sh(f"mkdir -p {EXT}")
        subprocess.run([banc.adb, "-s", banc.serie, "shell", f"cat > {EXT}/acces.json"], input=json.dumps({"url": "https://10.0.2.2:8443", "cle": CLE}).encode(), check=True)
        banc.sh(f"appops set {PAQUET} RUN_ANY_IN_BACKGROUND allow")
    banc.crm_post("/panne?code=0")
    # Android relance le service par MY_PACKAGE_REPLACED : aucune commande n'est envoyée avant de l'avoir constaté
    relance_seule = None
    if a.scenario == "normal":
        debut = time.time()
        while time.time() - debut < 90 and relance_seule is None:
            if banc.sh(f"pidof {PAQUET}").strip() and "ServiceSynchro" in banc.sh(f"dumpsys activity services {PAQUET}"):
                relance_seule = round(time.time() - debut, 1)
            else:
                time.sleep(1)
        print(f"service relancé seul par Android : {relance_seule if relance_seule is not None else 'NON'} s après l'installation")
    else:
        banc.commande("demarrer")
    banc.attendre(lambda: banc.etat()["version"] != avant["version"], 90, "service de la nouvelle version")
    sabotage = a.scenario != "normal"
    try:
        banc.attendre(lambda: banc.etat()["file"] == 0, 150, "file vidée après la mise à jour")
    except NonAbouti:
        if not sabotage:
            raise

    # après la mise à jour : un événement d'une personne connue part tout de suite, un inconnu reste sur le téléphone
    n_avant = len(banc.injectes)
    banc.sms(CONNUS[0], f"{banc.serie_id}apres-connu-0")
    banc.sms(INCONNU, f"{banc.serie_id}apres-inconnu-0")
    banc.appel(CONNUS[1])
    duree_apres = str(banc.base_duree + banc.n_appels)
    try:
        banc.attendre(lambda: banc.livres().get(f"{banc.serie_id}apres-connu-0", 0) == 1 and banc.livres().get(duree_apres, 0) == 1, 60, "livraison après la mise à jour")
    except NonAbouti:
        if not sabotage:
            raise
    time.sleep(6)
    apres = banc.photo("apres")
    retenus = {f"{banc.serie_id}{t}" for t in ("apres-inconnu-0", "panne-inconnu-0", "panne-inconnu-1")}
    ecarts = comparer(banc, avant, apres, attendu(banc, retenus))
    print(f"après : version {apres['version']} mode={apres['etat']['reglages']['mode']} acces={apres['etat']['reglages']['acces']} "
          f"file={apres['base']['file']} synchro={apres['base']['synchro']} crm.url={apres['base']['crm_url']} "
          f"canal={apres['etat']['reglages'].get('canal_maj')} préparation={apres['etat']['preparation']}")
    print("SMS d'un inconnu après la mise à jour : "
          + ("retenu sur le téléphone (politique « personnes du CRM »)" if banc.livres().get(f"{banc.serie_id}apres-inconnu-0", 0) == 0 else "envoyé"))
    if a.scenario == "normal" and relance_seule is None:
        ecarts.append("le service n'a pas été relancé seul après la mise à jour (MY_PACKAGE_REPLACED)")
    vivant = banc.sh(f"pidof {PAQUET}").strip()
    if not vivant:
        ecarts.append("processus de l'app absent")
    if "ServiceSynchro" not in banc.sh(f"dumpsys activity services {PAQUET}"):
        ecarts.append("ServiceSynchro absent")
    (banc.travail / "bilan.json").write_text(json.dumps({"avant": avant, "apres": apres, "ecarts": ecarts}, indent=1, default=str))
    print(f"détail : {banc.travail}/bilan.json")
    return ecarts


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--adb", required=True)
    p.add_argument("--serie", default="emulator-5554")
    p.add_argument("--ancien", required=True)
    p.add_argument("--nouveau", required=True)
    p.add_argument("--scenario", choices=("normal", "effacement", "perte-file"), default="normal")
    p.add_argument("--crm", default="8444")
    a = p.parse_args()
    if not a.serie.startswith("emulator-"):
        print("NON ABOUTI : cette épreuve ne vise qu'un émulateur (--serie emulator-NNNN)", file=sys.stderr)
        return 2
    try:
        ecarts = jouer(a)
    except (NonAbouti, subprocess.SubprocessError, OSError, KeyError, ValueError) as e:
        print(f"NON ABOUTI : {type(e).__name__} {e}", file=sys.stderr)
        return 2
    if ecarts:
        print("ECARTS :\n  " + "\n  ".join(ecarts))
        return 1
    print("TENU : rien perdu, rien en double, rien désactivé")
    return 0


if __name__ == "__main__":
    sys.exit(main())
