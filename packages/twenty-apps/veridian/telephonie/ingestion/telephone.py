#!/data/data/com.termux/files/usr/bin/python3
"""Agent du téléphone : le Pixel parle lui-même au CRM, sans serveur ni tâche planifiée entre les deux.

Tourne sous Termux, lancé au démarrage (Termux:Boot) et relancé s'il tombe (termux-services). Il part sur
l'événement, pas sur une minuterie :

    - fin d'un enregistrement JemRec          → inotify, réveil immédiat ;
    - appel qui commence ou finit, SMS reçu,
      avis de messagerie vocale (SMS visuel)  → sonde rapide toutes les 10 s (`dumpsys`, natif, sans Java) ;
    - SMS envoyé, MMS, message vocal arrivé   → sonde des fournisseurs toutes les 60 s, toutes les 15 s pendant
                                                 3 min après un événement ;
    - filet                                    → un passage complet toutes les 30 min.

Un passage lit le téléphone (journal d'appels, SMS, MMS, messagerie vocale, enregistrements) et ne parle au CRM
que si quelque chose a changé :

    1. nouvel appel, SMS ou message vocal → créé dans le CRM, rattaché par numéro, ligne de timeline à sa date ;
    2. nouvel enregistrement              → téléversé sur son appel tout de suite ;
    3. transcription faite ici            → Parakeet (whisper.cpp) sur le téléphone, ajoutée quand elle est prête.

Hors réseau, tout continue sur le téléphone (lecture, transcription) ; l'envoi reprend dès que le CRM répond.

Même logique que l'ingestion de `mail` (crm_telephonie.py, copié à côté) : idSource unique, rapprochement à la
seconde, compléter sans écraser, jamais de personne créée. La clé du rôle « Téléphone » (personnes en lecture,
appels et SMS en écriture) est dans ~/.config/crm-telephone/acces.json, droits 600. Réglages facultatifs (moteur et
modèle de transcription, cadences) : ~/.config/crm-telephone/reglages.json, voir REGLAGES_DEFAUT.

    python3 telephone.py            # boucle de l'agent
    python3 telephone.py --une-fois # un passage, pour éprouver
    python3 telephone.py --etat DOSSIER --acces FICHIER --jemrec DOSSIER   # copie d'essai isolée
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crm_telephonie as c  # noqa: E402

HOME = Path.home()
CONFIG = HOME / ".config" / "crm-telephone" / "acces.json"
REGLAGES = HOME / ".config" / "crm-telephone" / "reglages.json"
ETAT = HOME / ".local" / "state" / "crm-telephone"
JEMREC = Path("/sdcard/Recordings/JemRec")
APPAREIL = "PIXEL_8_PRO"
PERSONNES_VALIDES_S = 1800

# Modèles et cadences par défaut ; reglages.json les remplace clé par clé (un niveau de profondeur).
# Parakeet TDT 0.6B v3 q8_0 : 16 s par minute d'appel sur ce Pixel (whisper small : 93 s), meilleure qualité.
REGLAGES_DEFAUT = {
    "moteurs": ["parakeet", "whisper"],
    "parakeet": {"binaire": "~/whisper.cpp/build/bin/parakeet-cli",
                 "modele": "~/whisper.cpp/models/ggml-parakeet-tdt-0.6b-v3-q8_0.bin",
                 "fils": 4, "memoire_min_ko": 1_500_000},
    # whisper small occupe ~1 Go : sous ce seuil, Android tuerait Termux (et l'agent) pour reprendre la mémoire.
    "whisper": {"binaire": "~/whisper.cpp/build/bin/whisper-cli", "modele": "~/whisper.cpp/models/ggml-small.bin",
                "fils": 4, "memoire_min_ko": 2_000_000, "langue": "fr"},
    # Tronçons d'environ 30 s coupés sur un silence, passés par lots de 8 au même parakeet-cli (modèle chargé une
    # fois, 2,3 s). Banc du 12/11 sur ce Pixel, 5 min d'appel, q8_0 -t 4 : 15 s → 4,7x le temps réel, 30 s → 5,4x
    # (RSS 872 Mo), 60 s → 4,0x (1083 Mo), 90 s → 3,1x, 150 s → 2,3x (1687 Mo). Reprise au tronçon après un arrêt.
    "troncon_s": 30,
    "lot_troncons": 8,
    "sonde_rapide_s": 10,
    "sonde_sms_s": 15,
    "sonde_fournisseurs_s": 60,
    "rafale_s": 180,
    "rafale_pas_s": 15,
    "passage_filet_s": 1800,
    # Refaire les transcriptions d'un autre modèle que celui des réglages (whisper, ancien Parakeet) : seulement en
    # charge. Toute transcription se met en pause sous batterie_min_pct hors charge : la batterie de Robert d'abord.
    "ameliorer_anciennes": True,
    "batterie_min_pct": 30,
}

TYPES_TERMUX_APPEL = {"INCOMING": "1", "OUTGOING": "2", "MISSED": "3", "VOICEMAIL": "4", "REJECTED": "5",
                      "BLOCKED": "6", "ANSWERED_EXTERNALLY": "7"}
TYPES_TERMUX_SMS = {"inbox": "1", "sent": "2", "draft": "3", "outbox": "4", "failed": "5", "queued": "6"}
MESSAGERIE = "content://com.android.voicemail/voicemail"
SOURCES_MOTEUR = {"parakeet": "PARAKEET", "whisper": "WHISPER"}

ENFANTS = set()


def _arreter(signum, _frame):
    """runit n'envoie SIGTERM qu'à l'agent : ses enfants (parakeet, whisper, ffmpeg, inotifywait) s'arrêtent
    avec lui, sans orphelin."""
    for enfant in list(ENFANTS):
        enfant.kill()
    sys.exit(128 + signum)


def executer_suivi(commande, delai, flux="stdout"):
    """Commande suivie (tuée avec l'agent). `flux` : la sortie rendue, « stdout » ou « stderr »."""
    enfant = subprocess.Popen(commande, stdout=subprocess.PIPE if flux == "stdout" else subprocess.DEVNULL,
                              stderr=subprocess.PIPE if flux == "stderr" else subprocess.DEVNULL, text=True)
    ENFANTS.add(enfant)
    try:
        sortie, erreurs = enfant.communicate(timeout=delai)
    finally:
        ENFANTS.discard(enfant)
        if enfant.poll() is None:
            enfant.kill()
    if enfant.returncode != 0:
        raise subprocess.CalledProcessError(enfant.returncode, commande[0])
    return sortie if flux == "stdout" else erreurs


def log(message):
    print(f"[{dt.datetime.now():%F %T}] {message}", flush=True)


def reglages():
    valeurs = json.loads(json.dumps(REGLAGES_DEFAUT))
    if REGLAGES.exists():
        for cle, valeur in json.loads(REGLAGES.read_text()).items():
            if isinstance(valeur, dict) and isinstance(valeurs.get(cle), dict):
                valeurs[cle].update(valeur)
            else:
                valeurs[cle] = valeur
    for moteur in ("parakeet", "whisper"):
        for cle in ("binaire", "modele"):
            valeurs[moteur][cle] = Path(valeurs[moteur][cle]).expanduser()
    return valeurs


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
                    TYPES_TERMUX_APPEL.get(a.get("type"), "0"), a.get("name"), APPAREIL)
            for a in termux_json("termux-call-log", "-l", "100000")]


def sms_locaux():
    messages = []
    for sms in termux_json("termux-sms-list", "-l", "100000", "-t", "all"):
        nom = sms.get("sender") if sms.get("sender") not in (None, "You") else ""
        messages.append(c.message(millisecondes_locales(sms["received"]), sms.get("number") or sms.get("address"),
                                  TYPES_TERMUX_SMS.get(sms.get("type"), "1"), sms.get("body"), nom, APPAREIL))
    return messages


ADB_LOCAL = ["adb", "-s", "127.0.0.1:5555"]


def adb_local(*commande, binaire=False, delai=60):
    """Le shell adb du téléphone vers lui-même (uid 2000) : seul à lire les MMS et la messagerie vocale."""
    try:
        resultat = subprocess.run(ADB_LOCAL + ["exec-out" if binaire else "shell", *commande], capture_output=True,
                                  text=not binaire, timeout=delai)
    except (subprocess.SubprocessError, OSError) as erreur:
        raise c.NonAbouti(f"adb local : {erreur}") from erreur
    if resultat.returncode != 0:
        raise c.NonAbouti(f"adb local : code {resultat.returncode}")
    return resultat.stdout


def connecter_adb():
    try:
        subprocess.run(["adb", "connect", "127.0.0.1:5555"], capture_output=True, timeout=30)
    except (subprocess.SubprocessError, OSError):
        pass


# ---------------------------------------------------------------- sondes (déclenchement par événement)

# Sonde rapide : deux `dumpsys`, natifs (aucune machine Java lancée). mCallState passe à 1 ou 2 pendant un appel
# et revient à 0 à la fin, quand le journal d'appels est écrit. Le journal de l'InboundSmsHandler (`dumpsys
# isms`) prend une ligne à chaque SMS reçu, avis de messagerie visuelle compris.
SONDE_RAPIDE = ("dumpsys telephony.registry 2>/dev/null | grep mCallState; "
                "dumpsys isms 2>/dev/null | grep -E 'rec\\[|^ +20[0-9][0-9]-[0-9][0-9]-|total records'")
# Sondes des fournisseurs : le dernier identifiant (SMS envoyés, MMS, messages vocaux et l'arrivée de leur audio).
# Une machine Java chacune (0,35 s de CPU) : SMS toutes les 15 s, MMS et messagerie toutes les 60 s (15 s en rafale).
def _dernier(uri, projection):
    return f"content query --uri {uri} --projection {projection} --sort '_id DESC LIMIT 1'"


SONDE_SMS = _dernier("content://sms", "_id:date")
SONDE_MMS = _dernier("content://mms", "_id:date")
SONDE_MESSAGERIE = _dernier(MESSAGERIE, "_id:has_content")


def empreinte_sonde(sortie):
    """Empreinte d'une sortie de sonde ; None si la sonde n'a rien rendu (non abouti, pas « rien de neuf »)."""
    lignes = [l.strip() for l in (sortie or "").splitlines() if l.strip() and "Broken pipe" not in l]
    return hashlib.sha1("\n".join(lignes).encode()).hexdigest() if lignes else None


def sonder(script):
    try:
        return empreinte_sonde(adb_local(script, delai=30))
    except c.NonAbouti:
        return None


# ---------------------------------------------------------------- MMS et messagerie vocale


def mms_locaux():
    """MMS du Pixel, texte et pièces jointes. Un MMS déjà lu en entier est gardé en cache : seule la liste passe
    par adb à chaque passage (24 MMS relus un par un prenaient 98 s le 12/11). Au mieux : sans adb (port 5555
    fermé après un redémarrage), aucun MMS lu, et les appels et SMS passent quand même."""
    cache_fichier = ETAT / "mms" / "lus.json"
    cache = json.loads(cache_fichier.read_text()) if cache_fichier.exists() else {}
    try:
        liste = c.parser_content_query(adb_local("content", "query", "--uri", "content://mms", "--projection",
                                                 "_id:date:msg_box"), ["_id", "date", "msg_box"])
    except c.NonAbouti as erreur:
        log(f"MMS non lus : {erreur}")
        return []
    messages, change = [], False
    for mms in liste:
        cle = f"{mms['_id']}:{mms['date']}:{mms['msg_box']}"
        if cle not in cache:
            try:
                message = lire_un_mms(mms)
            except (c.NonAbouti, OSError) as erreur:
                log(f"MMS {mms['_id']} non lu : {erreur}")
                continue
            # Boîte d'envoi (4) ou MMS sans contenu (pas encore téléchargé) : relu au prochain passage.
            if mms["msg_box"] != "4" and (message["texte"] or message.get("_fichiers")):
                cache[cle] = dict(message, _fichiers={k: [str(p) for p in v]
                                                      for k, v in (message.get("_fichiers") or {}).items()})
                change = True
            messages.append(message)
            continue
        message = dict(cache[cle])
        if message.get("_fichiers"):
            message["_fichiers"] = {k: [Path(p) for p in v] for k, v in message["_fichiers"].items()}
        messages.append(message)
    if change:
        cache_fichier.parent.mkdir(parents=True, exist_ok=True)
        cache_fichier.write_text(json.dumps(cache))
    return messages


def lire_un_mms(mms):
    sens = "RECU" if mms["msg_box"] == "1" else "ENVOYE"
    voulu = "137" if sens == "RECU" else "151"
    adresses = [a["address"] for a in c.parser_content_query(
        adb_local("content", "query", "--uri", f"content://mms/{int(mms['_id'])}/addr", "--projection",
                  "address:type"), ["address", "type"]) if a["type"] == voulu]
    parties = c.parser_content_query(adb_local("content", "query", "--uri", "content://mms/part", "--where",
                                               f"mid={int(mms['_id'])}", "--projection", "_id:ct:name"),
                                     ["_id", "ct", "name"])
    textes, fichiers, types = [], [], []
    for partie in parties:
        if partie["ct"] == "application/smil":
            continue
        if partie["ct"] == "text/plain":
            sortie = adb_local("content", "query", "--uri", "content://mms/part", "--where",
                               f"_id={int(partie['_id'])}", "--projection", "text")
            if "text=" in sortie:
                textes.append(sortie.split("text=", 1)[1].rstrip("\n"))
            continue
        extension = (partie.get("name") or "").rsplit(".", 1)[-1] if "." in (partie.get("name") or "") else \
            partie["ct"].split("/")[-1]
        chemin = ETAT / "mms" / f"mms{mms['_id']}-piece{partie['_id']}.{extension}"
        if not chemin.exists():
            ecrire_atomique(chemin, adb_local("content", "read", "--uri", f"content://mms/part/{int(partie['_id'])}",
                                              binaire=True, delai=300))
        fichiers.append(chemin)
        types.append(partie["ct"])
    texte = "\n".join(t for t in textes if t)
    if types:
        texte = (texte + "\n" if texte else "") + f"[{len(types)} pièce(s) jointe(s) : {', '.join(sorted(set(types)))}]"
    numero = next((a for a in adresses if c.normaliser_numero(a)), adresses[0] if adresses else None)
    message = c.message(int(mms["date"]) * 1000, numero, None, texte, "", APPAREIL, canal="MMS", sens=sens)
    if fichiers:
        message["_fichiers"] = {"piecesJointes": fichiers[:c.MAX_PIECES_JOINTES]}
    return message


def ecrire_atomique(chemin, octets):
    chemin.parent.mkdir(parents=True, exist_ok=True)
    provisoire = chemin.with_name(chemin.name + ".part")
    provisoire.write_bytes(octets)
    provisoire.replace(chemin)


def nom_vocal(millisecondes):
    """« 20261112_093015_messagerie » : heure locale du téléphone, comme les noms JemRec."""
    return time.strftime("%Y%m%d_%H%M%S", time.localtime(int(millisecondes) / 1000)) + "_messagerie"


def messages_vocaux_locaux():
    """Messages de la messagerie vocale (fournisseur Voicemail, lu en uid 2000), en appels de direction
    MESSAGERIE. L'audio AMR est copié une fois dans l'état de l'agent. La transcription de Google fait foi
    quand elle existe ; sinon celle faite ici (Parakeet). Sans adb : aucun message lu, le reste passe."""
    cles = ["_id", "number", "date", "duration", "has_content", "mime_type", "transcription"]
    try:
        liste = c.parser_content_query(adb_local("content", "query", "--uri", MESSAGERIE, "--projection",
                                                 ":".join(cles)), cles)
    except c.NonAbouti as erreur:
        log(f"messagerie vocale non lue : {erreur}")
        return [], []
    vocaux, a_transcrire = [], []
    for vocal in liste:
        extension = (vocal.get("mime_type") or "audio/amr").split("/")[-1].replace("x-", "") or "amr"
        audio = ETAT / "messagerie" / f"{nom_vocal(vocal['date'])}.{extension}"
        if vocal.get("has_content") == "1" and not audio.exists():
            try:
                ecrire_atomique(audio, adb_local("content", "read", "--uri", f"{MESSAGERIE}/{int(vocal['_id'])}",
                                                 binaire=True, delai=120))
            except (c.NonAbouti, OSError) as erreur:
                log(f"audio du message vocal {vocal['_id']} non lu : {erreur}")
        google = (vocal.get("transcription") or "").strip()
        if google:
            texte, infos = google, {"sourceTranscription": "GOOGLE", "moteurTranscription": "google-messagerie"}
        else:
            texte, infos = transcription(audio), infos_transcription(audio)
            if audio.exists() and a_transcrire_fichier(audio):
                a_transcrire.append(audio)
        appel = c.message_vocal(int(vocal["date"]), vocal.get("number"), vocal.get("duration"), APPAREIL, texte,
                                infos.get("sourceTranscription"), infos.get("moteurTranscription"))
        if audio.exists():
            appel["_fichiers"] = {"enregistrement": [audio]}
        appel["_remplace"] = remplacements(audio)
        vocaux.append(appel)
    return vocaux, a_transcrire


# ---------------------------------------------------------------- transcription


def fichier_transcription(chemin, suffixe=".txt"):
    return ETAT / "transcriptions" / f"{chemin.stem}{suffixe}"


def transcription(chemin):
    fichier = fichier_transcription(chemin)
    return fichier.read_text(encoding="utf-8").strip() if fichier.exists() else ""


def id_modele(moteur, regl_ou_chemin):
    """« parakeet-tdt-0.6b-v3-q8_0 », « whisper-small » : le nom du modèle, tel que le CRM l'affiche."""
    chemin = regl_ou_chemin[moteur]["modele"] if isinstance(regl_ou_chemin, dict) else Path(regl_ou_chemin)
    nom = chemin.name.removeprefix("ggml-").removesuffix(".bin")
    return nom if nom.startswith(moteur) else f"{moteur}-{nom}"


def moteur_de(chemin):
    """« parakeet:parakeet-tdt-0.6b-v3-q8_0 », « whisper:whisper-small » ; vide pour une transcription d'avant le
    12/11 (whisper small sur ce téléphone, ou reprise du CRM)."""
    fichier = fichier_transcription(chemin, ".moteur")
    if not fichier.exists():
        return ""
    famille, _, modele = fichier.read_text().strip().partition(":")
    if famille in SOURCES_MOTEUR and modele.endswith(".bin"):  # marqueur du 12/11 au matin : nom de fichier
        modele = id_modele(famille, modele)
    return f"{famille}:{modele}"


def infos_transcription(chemin):
    """Champs du CRM qui disent qui a écrit la transcription, pour la refaire plus tard avec un meilleur modèle."""
    if not transcription(chemin):
        return {}
    famille, _, modele = moteur_de(chemin).partition(":")
    infos = {"sourceTranscription": SOURCES_MOTEUR.get(famille)} if famille in SOURCES_MOTEUR else {}
    if famille in SOURCES_MOTEUR and modele:
        infos["moteurTranscription"] = modele
    return infos


def source_transcription(chemin):
    return infos_transcription(chemin).get("sourceTranscription")


def anciennes(chemin):
    fichier = fichier_transcription(chemin, ".anciennes.json")
    liste = json.loads(fichier.read_text(encoding="utf-8")) if fichier.exists() else []
    vieille = fichier_transcription(chemin, ".ancienne.txt")  # forme du 12/11 au matin
    if vieille.exists():
        liste.append(vieille.read_text(encoding="utf-8"))
    return liste


def remplacements(chemin):
    """Une transcription refaite par un autre modèle ne remplace celle du CRM que si le CRM porte encore une de
    celles que l'outil avait écrites (planifier, `_remplace`) : une retouche à la main reste."""
    liste = anciennes(chemin)
    return {"transcription": liste} if liste else {}


def a_transcrire_fichier(chemin):
    """Pas encore tenté. Un fichier vide marque un échec réel : on ne relance pas le moteur en boucle dessus."""
    return not fichier_transcription(chemin).exists()


def a_ameliorer(chemin, regl):
    """Transcription d'un autre modèle que celui des réglages (whisper, ancien Parakeet), pas encore refaite."""
    voulu = id_modele("parakeet", regl)
    return fichier_transcription(chemin).exists() and moteur_de(chemin) not in (f"parakeet:{voulu}",
                                                                                 f"echec-parakeet:{voulu}")


JETON = re.compile(r't0=\s*(\d+) t1=\s*(\d+) word_start=(true|false) "(.*)"\s*$')


def jetons_parakeet(sortie):
    """Jetons de `parakeet-cli -ps` : [(début s, fin s, texte, début de mot)]. t0 et t1 sont en centièmes de
    seconde ; « ▁ » marque le début d'un mot (SentencePiece)."""
    jetons = []
    for ligne in sortie.splitlines():
        m = JETON.search(ligne)
        if m:
            jetons.append((int(m.group(1)) / 100, int(m.group(2)) / 100, m.group(4), m.group(3) == "true"))
    return jetons


def lignes_depuis_jetons(jetons, decalage=0.0, phrase_min_s=2.0, silence_s=1.2, ligne_max_s=12.0):
    """Lignes « [  0.0-  2.0] texte », comme pixel-appels et whisper : une phrase par ligne, coupée aussi sur un
    silence ou au-delà de ligne_max_s."""
    mots = []
    for debut, fin, texte, debut_mot in jetons:
        if debut_mot or not mots:
            mots.append([debut, fin, texte.replace("▁", "")])
        else:
            mots[-1][1], mots[-1][2] = max(mots[-1][1], fin), mots[-1][2] + texte
    lignes, courante = [], []
    for i, (debut, fin, texte) in enumerate(mots):
        if not texte:
            continue
        courante.append((debut, fin, texte))
        suivant = mots[i + 1][0] if i + 1 < len(mots) else None
        duree = fin - courante[0][0]
        if suivant is None or (texte[-1] in ".?!…" and duree >= phrase_min_s) or suivant - fin > silence_s \
                or duree >= ligne_max_s:
            lignes.append(f"[{courante[0][0] + decalage:5.1f}-{max(fin, courante[0][0]) + decalage:5.1f}] "
                          + " ".join(m[2] for m in courante))
            courante = []
    return lignes


SILENCE = re.compile(r"silence_(start|end): (-?[\d.]+)")


def silences(wav):
    sortie = executer_suivi(["ffmpeg", "-hide_banner", "-nostats", "-i", str(wav), "-af",
                             "silencedetect=noise=-35dB:d=0.3", "-f", "null", "-"], 600, flux="stderr")
    bornes, debut = [], None
    for genre, valeur in SILENCE.findall(sortie):
        if genre == "start":
            debut = float(valeur)
        elif debut is not None:
            bornes.append((max(0.0, debut), float(valeur)))
            debut = None
    return bornes


def troncons(duree, silences_, cible=90.0, marge=30.0):
    """[(début, fin)] d'environ `cible` secondes, coupés au milieu du silence le plus proche de la cible
    (à ±marge), sinon net. Le dernier tronçon absorbe un reste court."""
    coupes = [0.0]
    while duree - coupes[-1] > cible + marge / 2:
        voulu = coupes[-1] + cible
        milieux = [(a + b) / 2 for a, b in silences_ if voulu - marge <= (a + b) / 2 <= voulu + marge]
        coupes.append(min(milieux, key=lambda m: abs(m - voulu)) if milieux else voulu)
    coupes.append(duree)
    return [(round(a, 2), round(b, 2)) for a, b in zip(coupes, coupes[1:]) if b - a > 0.05]


AUCUNE_PAROLE = "(aucune parole détectée)"


class Preempte(Exception):
    """Un enregistrement neuf attend : l'amélioration d'une ancienne transcription cède la place."""


def sorties_par_fichier(sortie):
    """`parakeet-cli` sur plusieurs fichiers : la sortie de chacun commence par « reading audio data from 'x' »."""
    parts, courant = {}, None
    for ligne in sortie.splitlines():
        m = re.search(r"reading audio data from '(.*)'", ligne)
        if m:
            courant = Path(m.group(1)).name
            parts[courant] = []
        elif courant:
            parts[courant].append(ligne)
    return {nom: "\n".join(lignes) for nom, lignes in parts.items()}


def transcrire_parakeet(wav, regl, cede=lambda: False):
    """Tronçons coupés sur les silences, passés par lots à un seul parakeet-cli : le modèle n'est chargé qu'une
    fois par lot, et l'encodeur ne voit jamais un bloc long (son coût croît plus vite que la durée : 16 s pour
    60 s d'audio, 271 s pour 5 min, mesuré le 12/11). Chaque tronçon fait est gardé : reprise après un arrêt."""
    moteur = regl["parakeet"]
    duree = max(0.0, (wav.stat().st_size - 44) / 32_000)
    travail = wav.with_name(f"{wav.stem}.{moteur['modele'].stem}.troncons")
    travail.mkdir(exist_ok=True)
    plan = travail / "plan.json"
    if plan.exists():
        morceaux = json.loads(plan.read_text())
    else:
        cible = float(regl["troncon_s"])
        morceaux = troncons(duree, silences(wav), cible, marge=cible / 4)
        plan.write_text(json.dumps(morceaux))
    restants = [i for i in range(len(morceaux)) if not (travail / f"{i:04d}.json").exists()]
    debut_run, audio_run = time.time(), sum(morceaux[i][1] - morceaux[i][0] for i in restants)
    lot = max(1, int(regl.get("lot_troncons", 8)))
    for depart in range(0, len(restants), lot):
        if cede():
            raise Preempte(wav.stem)
        indices = restants[depart:depart + lot]
        fichiers = []
        try:
            for i in indices:
                debut, fin = morceaux[i]
                morceau = travail / f"{i:04d}.wav"
                executer_suivi(["ffmpeg", "-v", "error", "-y", "-ss", str(debut), "-t", f"{fin - debut:.2f}", "-i",
                                str(wav), "-c", "copy", str(morceau)], 600)
                fichiers.append(morceau)
            audio = sum(morceaux[i][1] - morceaux[i][0] for i in indices)
            sortie = executer_suivi(["nice", "-n", "15", str(moteur["binaire"]), "-m", str(moteur["modele"]),
                                     "-t", str(moteur["fils"]), "-np", "-ps", *map(str, fichiers)],
                                    max(600, int(audio * 10)), flux="stderr")
        finally:
            for morceau in fichiers:
                morceau.unlink(missing_ok=True)
        par_fichier = sorties_par_fichier(sortie)
        for i in indices:
            texte = par_fichier.get(f"{i:04d}.wav")
            if texte is None:
                raise ValueError(f"parakeet-cli n'a rien rendu pour le tronçon {i} de {wav.name}")
            (travail / f"{i:04d}.json").write_text(json.dumps(lignes_depuis_jetons(jetons_parakeet(texte),
                                                                                  morceaux[i][0])))
    if restants:
        log(f"parakeet : {len(restants)} tronçons, {audio_run / 60:.1f} min d'audio en {time.time() - debut_run:.0f} s "
            f"({(time.time() - debut_run) / max(audio_run, 1) * 60:.0f} s par minute)")
    lignes = []
    for i in range(len(morceaux)):
        lignes += json.loads((travail / f"{i:04d}.json").read_text())
    for reste in travail.iterdir():
        reste.unlink()
    travail.rmdir()
    return lignes


def transcrire_whisper(wav, regl):
    moteur = regl["whisper"]
    duree_s = wav.stat().st_size / 32_000
    # Délai à la mesure de l'appel : une heure fixe tuait whisper sur les appels de 30 min et plus (11/11).
    sortie_whisper = executer_suivi(["nice", "-n", "15", str(moteur["binaire"]), "-m", str(moteur["modele"]), "-l",
                                     moteur.get("langue", "fr"), "-t", str(moteur["fils"]), "-np", "-f", str(wav)],
                                    max(3600, int(duree_s * 6)))
    lignes = []
    for ligne in sortie_whisper.splitlines():
        if ligne.startswith("[") and "-->" in ligne and "]" in ligne:
            horodatage, texte = ligne[1:].split("]", 1)
            debut, fin = (secondes(x.strip().split(".")[0]) + float("0." + x.strip().split(".")[1])
                          for x in horodatage.split("-->"))
            lignes.append(f"[{debut:5.1f}-{fin:5.1f}] {texte.strip()}")
    return lignes


def moteurs_prets(regl):
    """Moteurs utilisables maintenant, dans l'ordre des réglages : binaire et modèle présents, mémoire libre."""
    libre = memoire_libre_ko()
    return [m for m in regl["moteurs"] if m in ("parakeet", "whisper") and regl[m]["binaire"].exists()
            and regl[m]["modele"].exists() and libre >= regl[m]["memoire_min_ko"]]


def transcrire_un(chemin, regl, moteurs, cede=lambda: False):
    """Le premier moteur qui aboutit écrit la transcription et son marqueur. Un moteur tué par un signal (mémoire
    reprise par Android) ou trop long fait remonter l'erreur : on retentera plus tard, sans descendre au suivant."""
    sortie = fichier_transcription(chemin)
    sortie.parent.mkdir(parents=True, exist_ok=True)
    wav = fichier_transcription(chemin, ".wav")
    if not wav.exists():
        executer_suivi(["ffmpeg", "-v", "error", "-y", "-i", str(chemin), "-ac", "1", "-ar", "16000", str(wav)], 1800)
    derniere = None
    try:
        for moteur in moteurs:
            debut = time.time()
            try:
                lignes = transcrire_parakeet(wav, regl, cede) if moteur == "parakeet" else transcrire_whisper(wav, regl)
            except subprocess.CalledProcessError as erreur:
                if erreur.returncode < 0:
                    raise
                derniere = erreur
                log(f"{moteur} a échoué sur {chemin.name} (code {erreur.returncode}), moteur suivant")
                continue
            # Un message vide (raccroché sans parler, -47 dB mesuré le 12/11) : on le dit, ce n'est pas un échec.
            lignes = lignes or [AUCUNE_PAROLE]
            if sortie.exists() and sortie.read_text(encoding="utf-8").strip():
                liste = anciennes(chemin) + [sortie.read_text(encoding="utf-8")]
                fichier_transcription(chemin, ".anciennes.json").write_text(json.dumps(liste), encoding="utf-8")
                fichier_transcription(chemin, ".ancienne.txt").unlink(missing_ok=True)
            sortie.write_text("\n".join(lignes) + "\n", encoding="utf-8")
            fichier_transcription(chemin, ".moteur").write_text(f"{moteur}:{id_modele(moteur, regl)}\n")
            log(f"transcription {moteur} de {chemin.name} prête ({time.time() - debut:.0f} s)")
            wav.unlink(missing_ok=True)
            return True
    except Preempte:
        raise
    except BaseException:
        wav.unlink(missing_ok=True)
        raise
    wav.unlink(missing_ok=True)
    if derniere:
        raise derniere
    return False


def reprendre_transcriptions(appels, existants):
    """Un appel déjà transcrit dans le CRM (par pixel-appels, ou avant une perte de l'état) ne repasse pas par un
    moteur."""
    par_source = {e.get("idSource"): e for e in existants}
    par_seconde = {c.cle_seconde("appels", e): e for e in existants}
    for appel in appels:
        fichiers = (appel.get("_fichiers") or {}).get("enregistrement")
        if not fichiers:
            continue
        existant = par_source.get(appel["idSource"]) or par_seconde.get(c.cle_seconde("appels", appel))
        cache = fichier_transcription(fichiers[0])
        if existant and existant.get("transcription") and not (cache.exists() and cache.read_text(encoding="utf-8").strip()):
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(existant["transcription"], encoding="utf-8")
            famille = (existant.get("sourceTranscription") or "").lower()
            if famille in SOURCES_MOTEUR and existant.get("moteurTranscription"):
                fichier_transcription(fichiers[0], ".moteur").write_text(f"{famille}:{existant['moteurTranscription']}\n")


def memoire_libre_ko():
    for ligne in Path("/proc/meminfo").read_text().splitlines():
        if ligne.startswith("MemAvailable:"):
            return int(ligne.split()[1])
    return 0


_BATTERIE = {"le": 0.0, "niveau": None, "en_charge": False}


def batterie():
    """(niveau en %, en charge), lu par `dumpsys battery` (le sysfs est fermé à Termux), sinon par Termux:API ;
    une fois par minute au plus. Illisible : (None, False)."""
    if time.time() - _BATTERIE["le"] > 60:
        niveau, charge = None, False
        try:
            sortie = adb_local("dumpsys battery", delai=20)
            etat, valeur = re.search(r"^\s*status: (\d+)", sortie, re.M), re.search(r"^\s*level: (\d+)", sortie, re.M)
            niveau, charge = (int(valeur.group(1)) if valeur else None), bool(etat) and etat.group(1) in ("2", "5")
        except c.NonAbouti:
            try:
                etat = json.loads(c.executer(["termux-battery-status"], delai=30))
                niveau, charge = etat.get("percentage"), etat.get("status") in ("CHARGING", "FULL")
            except (c.NonAbouti, ValueError):
                pass
        _BATTERIE.update(le=time.time(), niveau=niveau, en_charge=charge)
    return _BATTERIE["niveau"], _BATTERIE["en_charge"]


def en_charge():
    return batterie()[1]


def transcription_permise(regl):
    """En charge, ou batterie au-dessus du seuil. Batterie illisible : pas de transcription (prudence)."""
    niveau, charge = batterie()
    return charge or (niveau is not None and niveau >= regl["batterie_min_pct"])


def enregistrements_locaux():
    enregistrements = []
    for debut, direction, chemin, _ in c.lire_enregistrements(JEMREC):
        enregistrements.append((debut, direction, chemin, transcription(chemin)))
    return enregistrements


# ---------------------------------------------------------------- l'agent : un fil par type, le brut d'abord


ECHECS = (c.NonAbouti, RuntimeError, OSError, ValueError)


def date_evenement(enregistrement):
    """Moment où l'événement a eu lieu sur le téléphone : fin de l'appel (début + durée), envoi du message."""
    texte = enregistrement.get("debutLe") or enregistrement.get("envoyeLe")
    if not texte:
        return None
    moment = dt.datetime.fromisoformat(texte.replace("Z", "+00:00")).timestamp()
    return moment + float(enregistrement.get("dureeSecondes") or 0)


def noter_delai(nom, secondes):
    """Délai mesuré entre l'événement et son arrivée au CRM, par type, sans donnée personnelle."""
    with (ETAT / "delais.tsv").open("a") as fichier:
        fichier.write(f"{dt.datetime.now():%F %T}\t{nom}\t{secondes:.1f}\n")


# Changer les règles du plan (un champ nouveau à compléter) change toutes les empreintes : le premier cycle après
# un déploiement repasse tout au CRM au lieu de se croire à jour.
VERSION_PLAN = "2026-11-12-moteur"


class Flux:
    """Un type (appels, sms, mms, messagerie) : son fil, son réveil, son empreinte. Les types ne s'attendent pas :
    un SMS ne patiente jamais derrière un audio à téléverser ni derrière une transcription. Un cycle écrit d'abord
    le brut (le record et ses métadonnées, en un lot) ; les fichiers partent ensuite par la file de téléversement,
    puis le cycle suivant constate qu'ils sont portés."""

    def __init__(self, agent, nom, pluriel, lire):
        self.agent, self.nom, self.pluriel, self.lire = agent, nom, pluriel, lire
        self.reveil = threading.Event()
        self.fichier_empreinte = ETAT / f"empreinte-{nom}"
        self.empreinte_envoyee = self.fichier_empreinte.read_text() if self.fichier_empreinte.exists() else ""
        self.en_attente, self.echecs, self.reessai_le, self.dernier = False, 0, 0.0, 0.0
        self.signale_le = None

    def signaler(self):
        self.signale_le = self.signale_le or time.time()
        self.reveil.set()

    def attendre(self, reseau):
        """Réseau absent : on retente dès que le CRM répond (30 s au plus tôt). Refus du CRM : 30 s, 1, 2… 5 min."""
        self.en_attente, self.echecs = True, self.echecs + 1
        self.reessai_le = time.time() + (30 if reseau else min(300, 30 * 2 ** (self.echecs - 1)))

    def boucle(self, regl):
        while True:
            filet = regl["passage_filet_s"] if self.agent.sondes_ok else 120
            self.reveil.wait(10 if self.en_attente else max(1.0, filet - (time.time() - self.dernier)))
            maintenant = time.time()
            if not self.reveil.is_set():
                if self.en_attente and not (maintenant >= self.reessai_le and self.agent.crm_joignable()):
                    continue
                if not self.en_attente and maintenant - self.dernier < filet:
                    continue
            self.reveil.clear()
            signale, self.signale_le = self.signale_le, None
            try:
                self.cycle(signale)
            except ECHECS as erreur:
                log(f"{self.nom} : cycle non abouti : {erreur}")
                self.attendre(reseau=True)
            self.dernier = time.time()

    def cycle(self, signale=None):
        """0 rien à faire ou fait, 1 une écriture refusée, 2 CRM injoignable (on retentera)."""
        debut = time.time()
        voulus = self.lire()
        empreinte = hashlib.sha1(json.dumps([VERSION_PLAN] + sorted(
            v["idSource"] + hashlib.sha1((v.get("transcription") or "").encode()).hexdigest()[:8]
            + str(sorted((k, len(f)) for k, f in (v.get("_fichiers") or {}).items())) for v in voulus)).encode()).hexdigest()
        if empreinte == self.empreinte_envoyee:
            self.en_attente, self.echecs = False, 0
            return 0
        try:
            index = self.agent.personnes()
            existants = self.agent.twenty.tout_lister(self.pluriel, f"appareil[eq]:{APPAREIL}")
            if self.pluriel == "appels":
                reprendre_transcriptions(voulus, existants)
            creations, complements, _ = c.planifier(self.pluriel, voulus, existants, index)
            brut = [(corps, None) for corps, _ in creations]
            champs = [(ident, ch, None) for ident, ch, _ in complements if ch]
            erreurs = c.ecrire(self.agent.twenty, self.pluriel, brut, champs) if (brut or champs) else 0
        except (c.NonAbouti, OSError) as erreur:
            self.attendre(reseau=True)
            log(f"{self.nom} : CRM injoignable, envoi au retour du réseau : {erreur}")
            return 2
        except RuntimeError as erreur:
            self.attendre(reseau=False)
            log(f"{self.nom} : refusé par le CRM : {erreur}")
            return 1
        fin = time.time()
        for corps, _ in creations:
            moment = date_evenement(corps)
            if moment and fin - moment < 3600:
                noter_delai(self.nom, fin - moment)
                log(f"{self.nom} : créé {fin - moment:.0f} s après l'événement (détecté il y a "
                    f"{fin - (signale or debut):.0f} s, cycle {fin - debut:.1f} s)")
        if brut or champs:
            log(f"{self.nom} : {len(brut)} créés, {len(champs)} complétés en {fin - debut:.1f} s")
        fichiers = [(ident, f) for ident, _, f in complements if f]
        for ident, f in fichiers:
            self.agent.televerser(self, ident, f)
        if erreurs:
            self.attendre(reseau=False)
            return 1
        self.en_attente, self.echecs = False, 0
        if any(f for _, f in creations):
            # Records neufs avec fichiers : le cycle suivant les trouve au CRM et met leurs fichiers en file.
            self.signaler()
        elif not (creations or champs or fichiers):
            self.empreinte_envoyee = empreinte
            self.fichier_empreinte.write_text(empreinte)
            (ETAT / "dernier-succes").write_text(dt.datetime.now().isoformat())
        return 0


class FileDeTeleversement:
    """Une file et un fil : compression et envoi des fichiers après la création du record, sans jamais retarder
    un autre type. L'audio et les pièces jointes ont chacun la leur (un audio de 72 Mo, 128 s de compression,
    ne retient pas la photo d'un MMS)."""

    def __init__(self, agent, nom):
        self.agent, self.nom = agent, nom
        self.file, self.en_cours, self.verrou = [], set(), threading.Condition()
        threading.Thread(target=self.boucle, daemon=True).start()

    def ajouter(self, flux, ident, fichiers):
        cle = (flux.pluriel, ident)
        with self.verrou:
            if cle in self.en_cours:
                return
            self.en_cours.add(cle)
            self.file.append((flux, ident, fichiers))
            self.verrou.notify()

    def boucle(self):
        while True:
            with self.verrou:
                while not self.file:
                    self.verrou.wait()
                flux, ident, fichiers = self.file.pop(0)
            debut = time.time()
            try:
                self.agent.twenty.modifier(flux.pluriel, ident, c.avec_fichiers(self.agent.twenty, {}, fichiers))
                log(f"{flux.nom} : {sum(len(v) for v in fichiers.values())} fichier(s) porté(s) en "
                    f"{time.time() - debut:.1f} s")
            except c.ECHECS as erreur:
                log(f"{flux.nom} : fichier remis à plus tard : {erreur}")
                time.sleep(30)
            finally:
                with self.verrou:
                    self.en_cours.discard((flux.pluriel, ident))
                flux.signaler()


class Agent:
    def __init__(self, twenty, regl=None):
        self.twenty, self.regl = twenty, regl or reglages()
        self.index, self.index_le, self.verrou_index = {}, 0.0, threading.Lock()
        self.transcripteur = None
        self.vocaux_a_transcrire = []
        self.sondes_ok = True
        self.flux = {nom: Flux(self, nom, pluriel, lire) for nom, pluriel, lire in (
            ("appels", "appels", self.lire_appels), ("sms", "textMessages", sms_locaux),
            ("mms", "textMessages", mms_locaux), ("messagerie", "appels", self.lire_messagerie))}
        self.files = {}

    def televerser(self, flux, ident, fichiers):
        nom = "audio" if "enregistrement" in fichiers else "pieces"
        if nom not in self.files:
            self.files[nom] = FileDeTeleversement(self, nom)
        self.files[nom].ajouter(flux, ident, fichiers)

    def personnes(self):
        with self.verrou_index:
            if time.time() - self.index_le > PERSONNES_VALIDES_S:
                self.index, _ = c.index_telephones(self.twenty.tout_lister("people"))
                self.index_le = time.time()
            return self.index

    def lire_appels(self):
        appels = appels_locaux()
        c.associer_enregistrements(appels, enregistrements_locaux())
        for appel in appels:
            fichiers = (appel.get("_fichiers") or {}).get("enregistrement")
            if fichiers:
                appel["_remplace"] = remplacements(fichiers[0])
                if appel.get("transcription"):
                    appel.update(infos_transcription(fichiers[0]))
        return appels

    def lire_messagerie(self):
        vocaux, self.vocaux_a_transcrire = messages_vocaux_locaux()
        return vocaux

    def crm_joignable(self):
        """Une connexion TCP au CRM, 3 s au plus : savoir que le réseau est revenu sans relire le téléphone."""
        adresse = urllib.parse.urlsplit(self.twenty.url)
        try:
            socket.create_connection((adresse.hostname, adresse.port or (443 if adresse.scheme == "https" else 80)),
                                     timeout=3).close()
            return True
        except OSError:
            return False

    # -- transcription, en dernier, à côté de tout le reste

    def a_faire(self, regl):
        """(nouveaux, à refaire), du plus récent au plus ancien : un appel qui vient de finir passe d'abord."""
        fichiers = [chemin for _, _, chemin, _ in enregistrements_locaux()] + list(self.vocaux_a_transcrire)
        fichiers.sort(key=lambda p: p.stem, reverse=True)
        nouveaux = [f for f in fichiers if a_transcrire_fichier(f)]
        refaire = []
        if regl.get("ameliorer_anciennes") and "parakeet" in regl["moteurs"] and en_charge():
            refaire = [f for f in fichiers if a_ameliorer(f, regl)]
        return nouveaux, refaire

    def transcrire_en_fond(self, regl):
        if self.transcripteur and self.transcripteur.is_alive():
            return
        if not transcription_permise(regl):
            return
        nouveaux, refaire = self.a_faire(regl)
        if not (nouveaux or refaire):
            return

        def tache():
            try:
                if self.transcrire_en_attente(regl, nouveaux, refaire):
                    self.flux["appels"].signaler()
                    self.flux["messagerie"].signaler()
            except ECHECS as erreur:
                log(f"transcription remise à plus tard : {erreur}")
        self.transcripteur = threading.Thread(target=tache, daemon=True)
        self.transcripteur.start()

    def transcrire_en_attente(self, regl, nouveaux, refaire):
        """Un fichier à la fois ; rend True si une transcription est prête (les fils la portent au CRM)."""
        if nouveaux:
            # Avant le moteur, le CRM : l'appel a peut-être déjà sa transcription. Hors réseau, on transcrit quand même.
            try:
                appels = appels_locaux()
                c.associer_enregistrements(appels, enregistrements_locaux())
                reprendre_transcriptions(appels, self.twenty.tout_lister("appels", f'appareil[eq]:{APPAREIL}'))
            except ECHECS:
                pass
            nouveaux = [f for f in nouveaux if a_transcrire_fichier(f)]
        cible, moteurs = None, moteurs_prets(regl)
        if nouveaux:
            cible = nouveaux[0]
        elif refaire:
            cible, moteurs = refaire[0], [m for m in moteurs if m == "parakeet"]
        if cible is None or not moteurs:
            return False
        neuf = cible in nouveaux
        log(f"transcription de {cible.name}" + ("" if neuf else f" (refaite en {id_modele('parakeet', regl)})"))
        if neuf:
            cede = lambda: not transcription_permise(regl)  # noqa: E731
        else:
            cede = lambda: bool(self.a_faire(regl)[0]) or not en_charge()  # noqa: E731
        try:
            return transcrire_un(cible, regl, moteurs, cede)
        except Preempte:
            log(f"transcription de {cible.name} en pause (batterie, ou un enregistrement neuf passe d'abord)")
            return False
        except (subprocess.SubprocessError, OSError, ValueError) as erreur:
            log(f"transcription de {cible.name} impossible : {erreur}")
            # Tué par un signal (mémoire reprise par Android) ou délai dépassé : on retentera.
            reessayable = isinstance(erreur, subprocess.TimeoutExpired) or (
                isinstance(erreur, subprocess.CalledProcessError) and erreur.returncode < 0)
            if not reessayable and neuf:
                fichier_transcription(cible).write_text("", encoding="utf-8")
                fichier_transcription(cible, ".moteur").write_text("echec:\n")
            elif not reessayable:
                # Refaite sans succès : l'ancienne reste, on ne retente plus avec ce modèle.
                fichier_transcription(cible, ".moteur").write_text(f"echec-parakeet:{id_modele('parakeet', regl)}\n")
            return False

    # -- les sondes : elles réveillent les fils concernés, rien d'autre

    def boucle(self, regl):
        connecter_adb()
        for flux in self.flux.values():
            threading.Thread(target=flux.boucle, args=(regl,), daemon=True).start()
            flux.signaler()
        sondes = {"rapide": (SONDE_RAPIDE, ("appels", "sms", "messagerie"), regl["sonde_rapide_s"]),
                  "sms": (SONDE_SMS, ("sms",), regl["sonde_sms_s"]),
                  "mms": (SONDE_MMS, ("mms",), regl["sonde_fournisseurs_s"]),
                  "messagerie": (SONDE_MESSAGERIE, ("messagerie",), regl["sonde_fournisseurs_s"])}
        dernieres, prochaines, rafale_jusqua, reconnexion = {}, {nom: 0.0 for nom in sondes}, 0.0, 0.0
        while True:
            maintenant = time.time()
            for nom, (script, cibles, pas) in sondes.items():
                if maintenant < prochaines[nom]:
                    continue
                empreinte = sonder(script)
                prochaines[nom] = maintenant + (regl["rafale_pas_s"] if nom != "rapide" and maintenant < rafale_jusqua
                                                else pas)
                if empreinte is None:
                    if nom == "rapide":
                        # Sonde muette (adb fermé après un redémarrage) : les fils reviennent au filet de 2 min.
                        self.sondes_ok = False
                        if maintenant - reconnexion > 60:
                            connecter_adb()
                            reconnexion = maintenant
                    continue
                if nom == "rapide":
                    self.sondes_ok = True
                if nom in dernieres and empreinte != dernieres[nom]:
                    if nom == "rapide":
                        # Un appel ou un SMS reçu : les fournisseurs sont sondés toutes les 15 s pendant 3 min.
                        rafale_jusqua = maintenant + regl["rafale_s"]
                        prochaines.update({n: maintenant for n in sondes if n != "rapide"})
                    for cible in cibles:
                        self.flux[cible].signaler()
                dernieres[nom] = empreinte
            self.transcrire_en_fond(regl)
            self.attendre_tour(regl["sonde_rapide_s"])

    def attendre_tour(self, secondes):
        time.sleep(secondes)


def surveiller_enregistrements(flux):
    """inotify sur JemRec : la fin d'un enregistrement réveille le fil des appels tout de suite."""
    while True:
        try:
            enfant = subprocess.Popen(["inotifywait", "-m", "-q", "-e", "close_write", "-e", "moved_to", str(JEMREC)],
                                      stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        except OSError as erreur:
            log(f"inotify indisponible : {erreur}")
            return
        ENFANTS.add(enfant)
        for ligne in enfant.stdout:
            if ".ogg" in ligne:
                flux.signaler()
        ENFANTS.discard(enfant)
        time.sleep(30)


def main(argv=None):
    global ETAT, JEMREC, CONFIG
    parseur = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parseur.add_argument("--une-fois", action="store_true", help="un cycle de chaque type, sans fichiers ni transcription")
    parseur.add_argument("--etat", type=Path, help="dossier d'état (copie d'essai)")
    parseur.add_argument("--acces", type=Path, help="fichier d'accès au CRM (copie d'essai)")
    parseur.add_argument("--jemrec", type=Path, help="dossier des enregistrements (copie d'essai)")
    arguments = parseur.parse_args(argv)
    ETAT, CONFIG, JEMREC = arguments.etat or ETAT, arguments.acces or CONFIG, arguments.jemrec or JEMREC
    signal.signal(signal.SIGTERM, _arreter)
    ETAT.mkdir(parents=True, exist_ok=True)
    # Fichiers de travail (Opus à téléverser) : jamais /tmp, interdit sous Termux.
    (ETAT / "tmp").mkdir(exist_ok=True)
    tempfile.tempdir = str(ETAT / "tmp")
    for reste in list((ETAT / "tmp").iterdir()) + list((ETAT / "transcriptions").glob("*.wav")):
        reste.unlink()  # laissé par un arrêt brutal
    acces = json.loads(CONFIG.read_text())
    regl = reglages()
    agent = Agent(c.Twenty(acces["url"].rstrip("/"), acces["cle"], essais=2), regl)
    log(f"agent prêt : moteurs {', '.join(regl['moteurs'])}, modèle {id_modele('parakeet', regl)}, "
        f"transcription en pause sous {regl['batterie_min_pct']} % hors charge")
    if arguments.une_fois:
        connecter_adb()
        return max(flux.cycle() for flux in agent.flux.values())
    threading.Thread(target=surveiller_enregistrements, args=(agent.flux["appels"],), daemon=True).start()
    agent.boucle(regl)


if __name__ == "__main__":
    sys.exit(main())
