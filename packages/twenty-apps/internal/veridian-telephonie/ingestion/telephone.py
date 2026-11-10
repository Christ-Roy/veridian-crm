#!/data/data/com.termux/files/usr/bin/python3
"""Agent du téléphone : le Pixel parle lui-même au CRM, sans serveur ni tâche planifiée entre les deux.

Tourne sous Termux, lancé au démarrage (Termux:Boot) et relancé s'il tombe (termux-services). Il attend un
nouvel enregistrement JemRec (inotify) et regarde le journal d'appels et les SMS à chaque réveil, au plus tard
toutes les 2 minutes. Il ne parle au CRM que si quelque chose a changé sur le téléphone :

    1. nouvel appel ou SMS        → créé dans le CRM, rattaché par numéro, ligne de timeline à sa date ;
    2. nouvel enregistrement       → téléversé sur son appel tout de suite ;
    3. transcription faite ici     → whisper.cpp sur le téléphone, ajoutée à l'appel quand elle est prête.

Même logique que l'ingestion de `mail` (crm_telephonie.py, copié à côté) : idSource unique, rapprochement à la
seconde, compléter sans écraser, jamais de personne créée. La clé du rôle « Téléphone » (personnes en lecture,
appels et SMS en écriture) est dans ~/.config/crm-telephone/acces.json, droits 600.

    python3 telephone.py            # boucle de l'agent
    python3 telephone.py --une-fois # un passage, pour éprouver
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crm_telephonie as c  # noqa: E402

HOME = Path.home()
CONFIG = HOME / ".config" / "crm-telephone" / "acces.json"
ETAT = HOME / ".local" / "state" / "crm-telephone"
JEMREC = Path("/sdcard/Recordings/JemRec")
WHISPER = HOME / "whisper.cpp" / "build" / "bin" / "whisper-cli"
MODELE = HOME / "whisper.cpp" / "models" / "ggml-small.bin"
ATTENTE_MAX_S = 120
# whisper small occupe ~1 Go : sous ce seuil de mémoire libre, Android tuerait Termux (et l'agent) pour la reprendre.
MEMOIRE_MIN_TRANSCRIPTION_KO = 2_000_000
PERSONNES_VALIDES_S = 1800

TYPES_TERMUX_APPEL = {"INCOMING": "1", "OUTGOING": "2", "MISSED": "3", "VOICEMAIL": "4", "REJECTED": "5",
                      "BLOCKED": "6", "ANSWERED_EXTERNALLY": "7"}
TYPES_TERMUX_SMS = {"inbox": "1", "sent": "2", "draft": "3", "outbox": "4", "failed": "5", "queued": "6"}


ENFANTS = set()


def _arreter(signum, _frame):
    """runit n'envoie SIGTERM qu'à l'agent : ses enfants (whisper, ffmpeg) s'arrêtent avec lui, sans orphelin."""
    for enfant in list(ENFANTS):
        enfant.kill()
    sys.exit(128 + signum)


def executer_suivi(commande, delai):
    enfant = subprocess.Popen(commande, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    ENFANTS.add(enfant)
    try:
        sortie, _ = enfant.communicate(timeout=delai)
    finally:
        ENFANTS.discard(enfant)
        if enfant.poll() is None:
            enfant.kill()
    if enfant.returncode != 0:
        raise subprocess.CalledProcessError(enfant.returncode, commande[0])
    return sortie


def log(message):
    print(f"[{dt.datetime.now():%F %T}] {message}", flush=True)


def millisecondes_locales(texte):
    """« 2026-11-10 15:51:21 », heure du téléphone, en millisecondes depuis l'époque."""
    return int(time.mktime(time.strptime(texte, "%Y-%m-%d %H:%M:%S")) * 1000)


def secondes(duree):
    total = 0
    for morceau in str(duree or "0").split(":"):
        total = total * 60 + int(morceau or 0)
    return total


def termux_json(*commande):
    return json.loads(c.executer(list(commande), delai=120) or "[]")


def appels_locaux():
    return [c.appel(millisecondes_locales(a["date"]), a.get("phone_number"), secondes(a.get("duration")),
                    TYPES_TERMUX_APPEL.get(a.get("type"), "0"), a.get("name"), "PIXEL_8_PRO")
            for a in termux_json("termux-call-log", "-l", "100000")]


def sms_locaux():
    messages = []
    for sms in termux_json("termux-sms-list", "-l", "100000", "-t", "all"):
        nom = sms.get("sender") if sms.get("sender") not in (None, "You") else ""
        messages.append(c.message(millisecondes_locales(sms["received"]), sms.get("number") or sms.get("address"),
                                  TYPES_TERMUX_SMS.get(sms.get("type"), "1"), sms.get("body"), nom, "PIXEL_8_PRO"))
    return messages


def transcription(chemin):
    fichier = ETAT / "transcriptions" / f"{chemin.stem}.txt"
    return fichier.read_text(encoding="utf-8").strip() if fichier.exists() else ""


def a_transcrire(chemin):
    """Pas encore tenté. Un fichier vide marque un échec réel : on ne relance pas whisper en boucle dessus."""
    return not (ETAT / "transcriptions" / f"{chemin.stem}.txt").exists()


def transcrire_un(chemin):
    """whisper.cpp sur le téléphone, priorité basse. Sortie au format de pixel-appels : « [  0.0-  2.0] texte »."""
    sortie = ETAT / "transcriptions" / f"{chemin.stem}.txt"
    sortie.parent.mkdir(parents=True, exist_ok=True)
    wav = ETAT / "transcriptions" / f"{chemin.stem}.wav"
    executer_suivi(["ffmpeg", "-v", "error", "-y", "-i", str(chemin), "-ac", "1", "-ar", "16000", str(wav)], 600)
    try:
        sortie_whisper = executer_suivi(["nice", "-n", "15", str(WHISPER), "-m", str(MODELE), "-l", "fr", "-t", "4",
                                         "-np", "-f", str(wav)], 3600)
    finally:
        wav.unlink(missing_ok=True)
    lignes = []
    for ligne in sortie_whisper.splitlines():
        if ligne.startswith("[") and "-->" in ligne and "]" in ligne:
            horodatage, texte = ligne[1:].split("]", 1)
            debut, fin = (secondes(x.strip().split(".")[0]) + float("0." + x.strip().split(".")[1])
                          for x in horodatage.split("-->"))
            lignes.append(f"[{debut:5.1f}-{fin:5.1f}] {texte.strip()}")
    sortie.write_text("\n".join(lignes) + "\n", encoding="utf-8")


def reprendre_transcriptions(appels, existants):
    """Un appel déjà transcrit dans le CRM (par pixel-appels, ou avant un redémarrage) ne repasse pas par whisper."""
    par_source = {e.get("idSource"): e for e in existants}
    par_seconde = {c.cle_seconde("appels", e): e for e in existants}
    for appel in appels:
        fichiers = (appel.get("_fichiers") or {}).get("enregistrement")
        if not fichiers:
            continue
        existant = par_source.get(appel["idSource"]) or par_seconde.get(c.cle_seconde("appels", appel))
        cache = ETAT / "transcriptions" / f"{fichiers[0].stem}.txt"
        if existant and existant.get("transcription") and not (cache.exists() and cache.read_text(encoding="utf-8").strip()):
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(existant["transcription"], encoding="utf-8")


def memoire_libre_ko():
    for ligne in Path("/proc/meminfo").read_text().splitlines():
        if ligne.startswith("MemAvailable:"):
            return int(ligne.split()[1])
    return 0


def enregistrements_locaux():
    enregistrements = []
    for debut, direction, chemin, _ in c.lire_enregistrements(JEMREC):
        enregistrements.append((debut, direction, chemin, transcription(chemin)))
    return enregistrements


class Agent:
    def __init__(self, twenty):
        self.twenty = twenty
        self.index, self.index_le = {}, 0.0
        self.empreinte_envoyee = (ETAT / "derniere-empreinte").read_text() if (ETAT / "derniere-empreinte").exists() else ""

    def personnes(self):
        if time.time() - self.index_le > PERSONNES_VALIDES_S:
            self.index, _ = c.index_telephones(self.twenty.tout_lister("people"))
            self.index_le = time.time()
        return self.index

    def passage(self):
        appels, messages = appels_locaux(), sms_locaux()
        enregistrements = enregistrements_locaux()
        c.associer_enregistrements(appels, enregistrements)
        empreinte = hashlib.sha1(json.dumps(
            [sorted(a["idSource"] + a.get("transcription", "")[:1] + str(bool(a.get("_fichiers"))) for a in appels),
             sorted(m["idSource"] for m in messages)]).encode()).hexdigest()
        if empreinte == self.empreinte_envoyee:
            return 0
        index = self.personnes()
        erreurs = 0
        for pluriel, voulus in (("appels", appels), ("textMessages", messages)):
            existants = self.twenty.tout_lister(pluriel, 'appareil[eq]:PIXEL_8_PRO')
            if pluriel == "appels":
                reprendre_transcriptions(appels, existants)
            creations, complements, _ = c.planifier(pluriel, voulus, existants, index)
            if creations or complements:
                log(f"{pluriel} : {len(creations)} à créer, {len(complements)} à compléter")
                erreurs += c.ecrire(self.twenty, pluriel, creations, complements)
        if erreurs == 0:
            self.empreinte_envoyee = empreinte
            (ETAT / "derniere-empreinte").write_text(empreinte)
            (ETAT / "dernier-succes").write_text(dt.datetime.now().isoformat())
        return 1 if erreurs else 0

    def transcrire_en_attente(self):
        """Un enregistrement à la fois : le passage suivant porte la transcription sur l'appel."""
        if not (WHISPER.exists() and MODELE.exists()) or memoire_libre_ko() < MEMOIRE_MIN_TRANSCRIPTION_KO:
            return False
        if not any(a_transcrire(chemin) for _, _, chemin, _ in enregistrements_locaux()):
            return False
        # Avant whisper, le CRM : l'appel a peut-être déjà sa transcription (pixel-appels, instance précédente).
        appels = appels_locaux()
        c.associer_enregistrements(appels, enregistrements_locaux())
        reprendre_transcriptions(appels, self.twenty.tout_lister("appels", 'appareil[eq]:PIXEL_8_PRO'))
        for _, _, chemin, _ in enregistrements_locaux():
            if a_transcrire(chemin):
                log(f"transcription de {chemin.name}")
                try:
                    transcrire_un(chemin)
                except (subprocess.SubprocessError, OSError, ValueError) as erreur:
                    log(f"transcription de {chemin.name} impossible : {erreur}")
                    # Tué par un signal (mémoire reprise par Android) : on retentera. Sinon, échec réel, on le note.
                    if not (isinstance(erreur, subprocess.CalledProcessError) and erreur.returncode < 0):
                        (ETAT / "transcriptions" / f"{chemin.stem}.txt").write_text("", encoding="utf-8")
                return True
        return False


def attendre_un_enregistrement():
    """Réveil au premier enregistrement fini, sinon au bout de ATTENTE_MAX_S (journal d'appels, SMS)."""
    subprocess.run(["inotifywait", "-q", "-t", str(ATTENTE_MAX_S), "-e", "close_write", "-e", "moved_to", str(JEMREC)],
                   capture_output=True)


def main(argv=None):
    parseur = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parseur.add_argument("--une-fois", action="store_true")
    arguments = parseur.parse_args(argv)
    signal.signal(signal.SIGTERM, _arreter)
    ETAT.mkdir(parents=True, exist_ok=True)
    for reste in (ETAT / "transcriptions").glob("*.wav"):
        reste.unlink()  # laissé par un arrêt brutal pendant une transcription
    acces = json.loads(CONFIG.read_text())
    agent = Agent(c.Twenty(acces["url"].rstrip("/"), acces["cle"]))
    while True:
        try:
            code = agent.passage()
        except (c.NonAbouti, RuntimeError, OSError, ValueError) as erreur:
            # Réseau coupé, CRM en redémarrage : on retentera au prochain réveil, rien n'est perdu.
            log(f"passage non abouti : {erreur}")
            code = 2
        if arguments.une_fois:
            return code
        try:
            transcrit = agent.transcrire_en_attente()
        except (c.NonAbouti, RuntimeError, OSError, ValueError) as erreur:
            log(f"transcription remise à plus tard : {erreur}")
            transcrit = False
        if not transcrit:
            attendre_un_enregistrement()


if __name__ == "__main__":
    sys.exit(main())
