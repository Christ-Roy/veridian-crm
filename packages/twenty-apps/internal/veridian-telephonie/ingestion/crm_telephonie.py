#!/usr/bin/env python3
"""crm-telephonie : appels et SMS de Robert dans le CRM Veridian (app Twenty « Téléphonie Veridian »).

Lancement manuel, rejouable, aucune tâche planifiée. Tourne sur la station `mail`, qui voit le Pixel
(`pixel shell`, `ssh pixel`) et les sauvegardes. La clé API du workspace reste sur le bastion : elle est lue
par ssh à chaque lancement, jamais écrite ni affichée.

    crm-telephonie app plan  --env staging --workspace cheerful-yellow-zebra
    crm-telephonie app apply --env prod    --workspace veridian-4
    crm-telephonie ingerer   --env prod    --workspace veridian-4 [--sources pixel,enregistrements,s10e] [--essai]
    crm-telephonie dossier   --env prod    --workspace veridian-4 [--champ etiquette] [--essai]
    crm-telephonie telephone cle|installer --env prod --workspace veridian-4   # agent du Pixel (telephone.py)

Idempotence : chaque appel ou message porte un `idSource` unique calculé depuis la source (date à la
milliseconde, numéro, sens, empreinte du texte), identique quel que soit le téléphone qui l'a gardé. Un rejeu
ne crée rien ; il complète seulement les champs vides (personne trouvée depuis, enregistrement arrivé après).
Il n'écrase jamais une valeur posée, ni un rattachement fait à la main.

Rattachement : par numéro E.164, contre les téléphones des personnes lus dans le workspace lui-même. Un numéro
inconnu ou porté par deux personnes reste sans lien ; aucune personne n'est jamais créée.

Codes de sortie : 0 tout est fait, 1 une écriture a échoué, 2 une source ou l'API n'a pas répondu.
"""
import argparse
import datetime as dt
import hashlib
import json
import mimetypes
import os
import re
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    PARIS = ZoneInfo("Europe/Paris")
except Exception:  # noqa: BLE001 — Termux : Python sans base des fuseaux, l'heure locale du téléphone fait foi
    PARIS = None

# Lancé en script, ce module est __main__ : les modules voisins qui l'importent doivent retrouver le même
# (mêmes classes d'exception), pas une seconde copie.
sys.modules.setdefault("crm_telephonie", sys.modules[__name__])
APP_DIR = Path(__file__).resolve().parent.parent
BASTION = os.environ.get("CRM_TELEPHONIE_BASTION", "contabo-storage")
ENREGISTREMENTS = Path.home() / "sauvegardes" / "appels-pixel"
S10E = Path.home() / "sauvegardes" / "telephone-s10e" / "2026-11-04_0104"
SOURCES = ("pixel", "enregistrements", "s10e")

# Identifiant universel du champ FILES `enregistrement` (src/identifiants.ts) : l'upload s'y adresse
# directement, sans chercher l'identifiant propre à l'installation.
ENREGISTREMENT_FIELD_UNIVERSAL_IDENTIFIER = "c01c8436-0ce4-4d41-b142-e067326f3236"
PIECES_JOINTES_FIELD_UNIVERSAL_IDENTIFIER = "5ba4ce60-1e5b-4abc-86c8-e5fa019a077c"
CHAMPS_FICHIERS = {"enregistrement": ENREGISTREMENT_FIELD_UNIVERSAL_IDENTIFIER,
                   "piecesJointes": PIECES_JOINTES_FIELD_UNIVERSAL_IDENTIFIER}
MAX_PIECES_JOINTES = 10

TYPES_APPEL = {"1": "ENTRANT", "2": "SORTANT", "3": "MANQUE", "4": "MESSAGERIE", "5": "REJETE", "6": "BLOQUE",
               "7": "ENTRANT"}
TYPES_SMS = {"1": "RECU", "2": "ENVOYE", "3": "BROUILLON", "4": "ENVOYE", "5": "ECHEC", "6": "ENVOYE"}
LIBELLES_DIRECTION = {"ENTRANT": "Entrant", "SORTANT": "Sortant", "MANQUE": "Manqué", "MESSAGERIE": "Messagerie",
                      "REJETE": "Rejeté", "BLOQUE": "Bloqué", "AUTRE": "Appel"}
LIBELLES_SENS = {"RECU": "Reçu", "ENVOYE": "Envoyé", "BROUILLON": "Brouillon", "ECHEC": "Échec"}
# Écart toléré entre l'heure du nom de fichier JemRec et le début noté au journal d'appels.
TOLERANCE_ENREGISTREMENT_S = 90
LOT = 50
PAUSE_ENTRE_LOTS_S = 0.3


class NonAbouti(Exception):
    """Une source ou l'API n'a pas répondu : la mesure n'est ni vraie ni fausse."""


# ---------------------------------------------------------------- normalisation


def normaliser_numero(brut):
    """E.164 pour un numéro de téléphone, None pour un code court, un nom (« CIC ») ou un numéro masqué."""
    if brut is None:
        return None
    texte = re.sub(r"[\s.\-()/]", "", str(brut))
    if texte.startswith("00"):
        texte = "+" + texte[2:]
    if texte.startswith("+"):
        chiffres = texte[1:]
        if chiffres.isdigit() and 8 <= len(chiffres) <= 15:
            # +330612… : le zéro national recopié après l'indicatif français.
            if chiffres.startswith("330") and len(chiffres) == 12:
                chiffres = "33" + chiffres[3:]
            # +33 33 6… : indicatif saisi deux fois dans le carnet ; Twenty le range sans le doublon.
            if chiffres.startswith("3333") and len(chiffres) == 13:
                chiffres = chiffres[2:]
            return "+" + chiffres
        return None
    if texte.isdigit() and len(texte) == 10 and texte.startswith("0"):
        return "+33" + texte[1:]
    return None


def numeros_personne(personne):
    """Numéros E.164 d'une personne Twenty (champ PHONES : principal et additionnels)."""
    phones = personne.get("phones") or {}
    entrees = [(phones.get("primaryPhoneNumber"), phones.get("primaryPhoneCallingCode"))]
    for autre in phones.get("additionalPhones") or []:
        entrees.append((autre.get("number"), autre.get("callingCode")))
    numeros = set()
    for numero, indicatif in entrees:
        if not numero:
            continue
        numero = re.sub(r"[\s.\-()/]", "", str(numero))
        if numero.startswith("+") or numero.startswith("00") or not indicatif:
            e164 = normaliser_numero(numero)
        else:
            e164 = normaliser_numero(indicatif + numero.lstrip("0"))
        if e164:
            numeros.add(e164)
    return numeros


def index_telephones(personnes):
    """{E.164: id} ; un numéro porté par deux personnes est mis à part, jamais attribué au hasard."""
    index, ambigus = {}, set()
    for personne in personnes:
        for numero in numeros_personne(personne):
            if numero in index and index[numero] != personne["id"]:
                ambigus.add(numero)
            index.setdefault(numero, personne["id"])
    for numero in ambigus:
        index.pop(numero, None)
    return index, ambigus


def iso_utc(millisecondes):
    return dt.datetime.fromtimestamp(int(millisecondes) / 1000, dt.timezone.utc).isoformat().replace("+00:00", "Z")


def empreinte(*morceaux):
    return hashlib.sha1("\x1f".join(str(m) for m in morceaux).encode()).hexdigest()[:12]


def cle_numero(brut):
    return normaliser_numero(brut) or (str(brut).strip() if brut else "masque")


def duree_lisible(secondes):
    secondes = int(secondes or 0)
    if secondes < 60:
        return f"{secondes} s"
    if secondes < 3600:
        return f"{secondes // 60} min {secondes % 60:02d} s"
    return f"{secondes // 3600} h {secondes % 3600 // 60:02d} min"


def titre_appel(direction, duree):
    libelle = LIBELLES_DIRECTION.get(direction, "Appel")
    if direction in ("MANQUE", "REJETE", "BLOQUE") or not duree:
        return libelle
    return f"{libelle} · {duree_lisible(duree)}"


def apercu_message(sens, texte, longueur=90):
    ligne = " ".join((texte or "").split())
    if len(ligne) > longueur:
        ligne = ligne[: longueur - 1].rstrip() + "…"
    return f"{LIBELLES_SENS.get(sens, 'SMS')} · {ligne}" if ligne else LIBELLES_SENS.get(sens, "SMS")


def appel(millisecondes, numero, duree, type_android, nom, appareil):
    direction = TYPES_APPEL.get(str(type_android), "AUTRE")
    duree = int(duree or 0)
    e164 = normaliser_numero(numero)
    return {
        "idSource": f"appel:{int(millisecondes)}:{cle_numero(numero)}",
        "titre": titre_appel(direction, duree),
        "direction": direction,
        "canal": "TELEPHONE",
        "debutLe": iso_utc(millisecondes),
        "dureeSecondes": duree,
        "numero": e164 or (str(numero).strip() if numero else ""),
        "nomSurTelephone": (nom or "").strip(),
        "appareil": appareil,
        "_e164": e164,
        "_ms": int(millisecondes),
    }


def message(millisecondes, numero, type_android, texte, nom, appareil, canal="SMS", sens=None):
    sens = sens or TYPES_SMS.get(str(type_android), "RECU")
    texte = texte or ""
    e164 = normaliser_numero(numero)
    return {
        "idSource": f"{canal.lower()}:{int(millisecondes)}:{cle_numero(numero)}:{sens}:{empreinte(texte)}",
        "apercu": apercu_message(sens, texte),
        "texte": texte,
        "sens": sens,
        "canal": canal,
        "envoyeLe": iso_utc(millisecondes),
        "numero": e164 or (str(numero).strip() if numero else ""),
        "nomSurTelephone": (nom or "").strip(),
        "appareil": appareil,
        "_e164": e164,
    }


# ---------------------------------------------------------------- sources


def parser_content_query(sortie, cles):
    """Lignes « Row: N k=v, k=v » de `content query`, la dernière clé absorbant les virgules du texte."""
    lignes = []
    for ligne in sortie.splitlines():
        m = re.match(r"Row: \d+ (.*)$", ligne)
        if not m:
            continue
        reste, valeurs = m.group(1), {}
        for i, cle in enumerate(cles):
            if not reste.startswith(cle + "="):
                break
            reste = reste[len(cle) + 1:]
            if i + 1 < len(cles):
                fin = reste.find(f", {cles[i + 1]}=")
                if fin < 0:
                    break
                valeurs[cle], reste = reste[:fin], reste[fin + 2:]
            else:
                valeurs[cle] = reste
        if len(valeurs) == len(cles):
            lignes.append({k: (None if v == "NULL" else v) for k, v in valeurs.items()})
    return lignes


def executer(commande, delai=120):
    try:
        resultat = subprocess.run(commande, capture_output=True, text=True, timeout=delai)
    except (subprocess.TimeoutExpired, FileNotFoundError) as erreur:
        raise NonAbouti(f"{' '.join(commande[:3])} : {erreur}") from erreur
    if resultat.returncode != 0:
        raise NonAbouti(f"{' '.join(commande[:3])} : code {resultat.returncode} {resultat.stderr.strip()[:200]}")
    return resultat.stdout


def lire_pixel():
    """Journal d'appels et SMS du Pixel, par le shell seul (l'écran n'est jamais touché)."""
    cles_appels = ["_id", "date", "duration", "type", "number", "name"]
    sortie = executer(["pixel", "shell", "content query --uri content://call_log/calls --projection "
                       + ":".join(cles_appels)])
    appels = [appel(l["date"], l["number"], l["duration"], l["type"], l["name"], "PIXEL_8_PRO")
              for l in parser_content_query(sortie, cles_appels)]
    cles_sms = ["_id", "date", "type", "address"]
    dates = {l["_id"]: l for l in parser_content_query(
        executer(["pixel", "shell", "content query --uri content://sms --projection " + ":".join(cles_sms)]),
        cles_sms)}
    # Le texte vient de Termux en JSON : `content query` ne sait pas rendre un corps sur plusieurs lignes.
    corps = {str(sms.get("_id")): sms
             for sms in json.loads(executer(["ssh", "pixel", "termux-sms-list -l 100000 -t all"]) or "[]")}
    messages = []
    for identifiant, ligne in dates.items():
        sms = corps.get(identifiant)
        if sms is None:
            # Termux ignore certains expéditeurs alphanumériques (« Telegram ») : une requête par message,
            # dont le corps est tout ce qui suit `body=`, retours à la ligne compris.
            sortie = executer(["pixel", "shell", "content query --uri content://sms --projection _id:body "
                               f"--where '_id={int(identifiant)}'"])
            sms = {"body": sortie.split("body=", 1)[1].rstrip("\n") if "body=" in sortie else None}
        nom = sms.get("sender") if sms.get("sender") not in (None, "You") else ""
        messages.append(message(ligne["date"], ligne["address"], ligne["type"], sms.get("body"), nom,
                                "PIXEL_8_PRO"))
    return appels, messages


def lire_s10e(dossier=S10E):
    def jsonl(nom):
        with open(dossier / nom, encoding="utf-8") as fichier:
            return [json.loads(ligne) for ligne in fichier if ligne.strip()]

    appels = [appel(a["date"], a["number"], a["duration"], a["type"], a.get("name"), "GALAXY_S10E")
              for a in jsonl("appels.jsonl")]
    messages = [message(s["date"], s["address"], s["type"], s.get("body"), "", "GALAXY_S10E")
                for s in jsonl("sms.jsonl")]
    correspondants, pieces = {}, {}
    for c in jsonl("mms-correspondants.jsonl"):
        correspondants.setdefault(c["msg_id"], []).append(c)
    for p in jsonl("mms-pieces.jsonl"):
        pieces.setdefault(p["mid"], []).append(p)
    for mms in jsonl("mms.jsonl"):
        sens = "RECU" if mms.get("msg_box") == "1" else "ENVOYE"
        # 137 = expéditeur, 151 = destinataire (PduHeaders) ; l'autre partie dépend du sens.
        voulu = "137" if sens == "RECU" else "151"
        adresses = [c["address"] for c in correspondants.get(mms["_id"], []) if c["type"] == voulu]
        textes = [p.get("text") or "" for p in pieces.get(mms["_id"], []) if p.get("ct") == "text/plain"]
        jointes = [p["ct"] for p in pieces.get(mms["_id"], []) if p.get("ct") not in ("text/plain", "application/smil")]
        fichiers = [f for p in pieces.get(mms["_id"], []) if p.get("ct") not in ("text/plain", "application/smil")
                    for f in sorted((dossier / "mms-pieces-jointes").glob(f"mms{mms['_id']}-piece{p['_id']}.*"))]
        texte = "\n".join(t for t in textes if t)
        if jointes:
            texte = (texte + "\n" if texte else "") + f"[{len(jointes)} pièce(s) jointe(s) : {', '.join(sorted(set(jointes)))}]"
        numero = next((a for a in adresses if normaliser_numero(a)), adresses[0] if adresses else None)
        mms_message = message(mms["date"], numero, None, texte, "", "GALAXY_S10E", canal="MMS", sens=sens)
        if fichiers:
            mms_message["_fichiers"] = {"piecesJointes": fichiers[:MAX_PIECES_JOINTES]}
        messages.append(mms_message)
    return appels, messages


def lire_enregistrements(dossier=ENREGISTREMENTS):
    """[(début en ms, direction, chemin .ogg, transcription)] depuis les noms JemRec AAAAMMJJ_HHMMSS_in|out."""
    resultat = []
    for chemin in sorted(dossier.glob("*.ogg")):
        m = re.fullmatch(r"(\d{8})_(\d{6})_(in|out)", chemin.stem)
        if not m:
            continue
        debut = dt.datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S")
        debut = debut.replace(tzinfo=PARIS) if PARIS else debut.astimezone()
        texte = chemin.with_suffix(".txt")
        resultat.append((int(debut.timestamp() * 1000), "ENTRANT" if m.group(3) == "in" else "SORTANT", chemin,
                         texte.read_text(encoding="utf-8").strip() if texte.exists() else ""))
    return resultat


def associer_enregistrements(appels, enregistrements):
    """Pose `_fichiers` (enregistrement) et `transcription` sur l'appel du même sens le plus proche dans le temps."""
    orphelins = []
    for debut, direction, chemin, transcription in enregistrements:
        candidats = [a for a in appels if a["direction"] == direction
                     and abs(a["_ms"] - debut) <= TOLERANCE_ENREGISTREMENT_S * 1000 and "_fichiers" not in a]
        if not candidats:
            orphelins.append(chemin.name)
            continue
        choisi = min(candidats, key=lambda a: abs(a["_ms"] - debut))
        choisi["_fichiers"] = {"enregistrement": [chemin]}
        if transcription:
            choisi["transcription"] = transcription
    return orphelins


def dedoublonner(enregistrements):
    """Un même idSource vu par deux sources (Pixel restauré depuis le S10e) ne compte qu'une fois."""
    vus = {}
    for e in enregistrements:
        vus.setdefault(e["idSource"], e)
    return list(vus.values())


# ---------------------------------------------------------------- Twenty


def charger_acces(env, workspace, suffixe=""):
    """Clé du workspace sur le bastion ; suffixe « TELEPHONE_ » pour celle du rôle Téléphone."""
    if not suffixe and os.environ.get("TWENTY_API_URL") and os.environ.get("TWENTY_API_KEY"):
        return os.environ["TWENTY_API_URL"].rstrip("/"), os.environ["TWENTY_API_KEY"]
    prefixe = f"TWENTY_{env.upper()}_{workspace.upper().replace('-', '_')}_{suffixe}"
    lecteur = ("import sys,json\nv={}\nfor l in open('/home/brunon5/credentials/.all-creds.env'):\n"
               " k,_,x=l.rstrip('\\n').partition('=')\n if k in sys.argv[1:]: v[k]=x.strip().strip('\"').strip(\"'\")\n"
               "print(json.dumps(v))")
    noms = [prefixe + "API_URL", prefixe + "API_KEY"]
    distante = "sudo -u brunon5 python3 -c " + shlex.quote(lecteur) + " " + " ".join(noms)
    valeurs = json.loads(executer(["ssh", BASTION, distante], delai=60) or "{}")
    if not all(valeurs.get(n) for n in noms):
        raise NonAbouti(f"clé absente sur {BASTION} : {noms[1]} (twenty-admin --env {env} agent:grant {workspace})")
    return valeurs[noms[0]].rstrip("/"), valeurs[noms[1]]


class Twenty:
    def __init__(self, url, cle):
        self.url, self.cle = url, cle

    def requete(self, methode, chemin, corps=None, donnees=None, entetes=None, essais=6):
        for essai in range(essais):
            requete = urllib.request.Request(
                self.url + chemin, method=methode,
                data=donnees if donnees is not None else (json.dumps(corps).encode() if corps is not None else None),
                headers={"Authorization": f"Bearer {self.cle}", "Content-Type": "application/json",
                         **(entetes or {})})
            try:
                with urllib.request.urlopen(requete, timeout=120) as reponse:
                    return json.loads(reponse.read() or b"{}")
            except urllib.error.HTTPError as erreur:
                texte = erreur.read().decode(errors="replace")[:400]
                if erreur.code in (429, 502, 503, 504) and essai + 1 < essais:
                    time.sleep(min(60, 2 ** essai * 3))
                    continue
                raise RuntimeError(f"{methode} {chemin} : HTTP {erreur.code} {texte}") from erreur
            except (urllib.error.URLError, TimeoutError) as erreur:
                if essai + 1 < essais:
                    time.sleep(min(60, 2 ** essai * 3))
                    continue
                raise NonAbouti(f"{methode} {chemin} : {erreur}") from erreur

    def tout_lister(self, pluriel, filtre=None):
        enregistrements, curseur = [], None
        while True:
            chemin = f"/rest/{pluriel}?limit=200&depth=0"
            if filtre:
                chemin += "&filter=" + urllib.request.quote(filtre)
            if curseur:
                chemin += "&starting_after=" + urllib.request.quote(curseur)
            reponse = self.requete("GET", chemin)
            enregistrements += reponse["data"][pluriel]
            page = reponse.get("pageInfo") or {}
            if not page.get("hasNextPage"):
                return enregistrements
            curseur = page["endCursor"]

    def creer_lot(self, pluriel, lot):
        return self.requete("POST", f"/rest/batch/{pluriel}", lot)

    def modifier(self, pluriel, identifiant, champs):
        return self.requete("PATCH", f"/rest/{pluriel}/{identifiant}", champs)

    def televerser(self, chemin, champ_uid):
        """Upload GraphQL multipart vers un champ FILES ; le fichier reste temporaire tant qu'aucun record ne le porte."""
        operations = {
            "query": "mutation($file: Upload!, $uid: String!) { uploadFilesFieldFileByUniversalIdentifier("
                     "file: $file, fieldMetadataUniversalIdentifier: $uid) { id path } }",
            "variables": {"file": None, "uid": champ_uid},
        }
        frontiere = uuid.uuid4().hex
        parties = []
        for nom, valeur in (("operations", json.dumps(operations)), ("map", json.dumps({"0": ["variables.file"]}))):
            parties.append(f'--{frontiere}\r\nContent-Disposition: form-data; name="{nom}"\r\n\r\n{valeur}\r\n'.encode())
        parties.append(f'--{frontiere}\r\nContent-Disposition: form-data; name="0"; filename="{chemin.name}"\r\n'
                       f"Content-Type: {mimetypes.guess_type(chemin.name)[0] or 'application/octet-stream'}\r\n\r\n".encode()
                       + chemin.read_bytes() + b"\r\n")
        parties.append(f"--{frontiere}--\r\n".encode())
        reponse = self.requete("POST", "/metadata", donnees=b"".join(parties),
                               entetes={"Content-Type": f"multipart/form-data; boundary={frontiere}",
                                        "apollo-require-preflight": "true"})
        if reponse.get("errors"):
            raise RuntimeError(f"upload {chemin.name} : {reponse['errors'][0].get('message')}")
        return reponse["data"]["uploadFilesFieldFileByUniversalIdentifier"]["id"]


# ---------------------------------------------------------------- plan et écriture

CHAMPS = {
    "appels": ("titre", "direction", "canal", "debutLe", "dureeSecondes", "numero", "nomSurTelephone",
               "transcription", "appareil", "idSource"),
    "textMessages": ("apercu", "texte", "sens", "canal", "envoyeLe", "numero", "nomSurTelephone", "appareil",
                     "idSource"),
}


def vide(valeur):
    return valeur in (None, "", [], {}) or (isinstance(valeur, dict) and not any(valeur.values()))


def cle_seconde(pluriel, enregistrement):
    """Même numéro, même seconde, même sens (et même texte pour un SMS) : le même événement, quelle que soit
    la source. Le journal d'appels lu par adb est à la milliseconde, celui de Termux à la seconde."""
    if pluriel == "appels":
        return (enregistrement.get("numero"), (enregistrement.get("debutLe") or "")[:19], enregistrement.get("direction"))
    return (enregistrement.get("numero"), (enregistrement.get("envoyeLe") or "")[:19], enregistrement.get("sens"),
            empreinte(enregistrement.get("texte") or ""))


def planifier(pluriel, voulus, existants, index):
    """Créations et compléments. Un champ déjà rempli dans le CRM n'est jamais réécrit."""
    par_source = {e.get("idSource"): e for e in existants if e.get("idSource")}
    par_seconde = {cle_seconde(pluriel, e): e for e in existants}
    creations, complements, bilan = [], [], {"sans_personne": 0}
    for voulu in voulus:
        personne = index.get(voulu["_e164"]) if voulu["_e164"] else None
        if not personne:
            bilan["sans_personne"] += 1
        existant = par_source.get(voulu["idSource"]) or par_seconde.get(cle_seconde(pluriel, voulu))
        if existant is None:
            corps = {k: voulu[k] for k in CHAMPS[pluriel] if k in voulu}
            if personne:
                corps["personId"] = personne
            creations.append((corps, voulu.get("_fichiers")))
            continue
        champs = {k: voulu[k] for k in CHAMPS[pluriel] if k in voulu and not vide(voulu[k]) and vide(existant.get(k))}
        if personne and vide(existant.get("personId")):
            champs["personId"] = personne
        fichiers = {k: v for k, v in (voulu.get("_fichiers") or {}).items() if vide(existant.get(k))} or None
        if champs or fichiers:
            complements.append((existant["id"], champs, fichiers))
    return creations, complements, bilan


def avec_fichiers(twenty, corps, fichiers):
    """Téléverse les fichiers de chaque champ FILES puis les porte sur le record, dans la même écriture."""
    for champ, chemins in (fichiers or {}).items():
        corps = dict(corps, **{champ: [{"fileId": twenty.televerser(chemin, CHAMPS_FICHIERS[champ]),
                                        "label": chemin.name} for chemin in chemins]})
    return corps


def ecrire(twenty, pluriel, creations, complements):
    erreurs = 0
    # Un record avec fichiers passe seul : le fichier téléversé doit être porté dans la foulée.
    simples = [c for c, f in creations if not f]
    for debut in range(0, len(simples), LOT):
        try:
            twenty.creer_lot(pluriel, simples[debut:debut + LOT])
            # Chaque création rattachée réveille le worker (ligne de timeline) : on laisse respirer la base.
            time.sleep(PAUSE_ENTRE_LOTS_S)
        except RuntimeError as erreur:
            erreurs += 1
            print(f"  ✗ lot {pluriel} {debut} : {erreur}", file=sys.stderr)
    for corps, fichier in [(c, f) for c, f in creations if f]:
        try:
            twenty.creer_lot(pluriel, [avec_fichiers(twenty, corps, fichier)])
        except RuntimeError as erreur:
            erreurs += 1
            print(f"  ✗ {corps['idSource']} : {erreur}", file=sys.stderr)
    for identifiant, champs, fichier in complements:
        try:
            twenty.modifier(pluriel, identifiant, avec_fichiers(twenty, champs, fichier))
        except RuntimeError as erreur:
            erreurs += 1
            print(f"  ✗ {identifiant} : {erreur}", file=sys.stderr)
    return erreurs


def collecter(sources):
    appels, messages, non_abouties, orphelins = [], [], [], []
    if "pixel" in sources:
        try:
            a, m = lire_pixel()
            appels += a
            messages += m
            print(f"  Pixel : {len(a)} appels, {len(m)} SMS")
        except NonAbouti as erreur:
            non_abouties.append(f"pixel ({erreur})")
    if "s10e" in sources:
        try:
            a, m = lire_s10e()
            appels += a
            messages += m
            print(f"  Galaxy S10e : {len(a)} appels, {len(m)} SMS et MMS")
        except OSError as erreur:
            non_abouties.append(f"s10e ({erreur})")
    if "enregistrements" in sources:
        enregistrements = lire_enregistrements()
        orphelins = associer_enregistrements([a for a in appels if a["appareil"] == "PIXEL_8_PRO"], enregistrements)
        print(f"  Enregistrements : {len(enregistrements)}, {len(enregistrements) - len(orphelins)} associés à un appel")
    return dedoublonner(appels), dedoublonner(messages), non_abouties, orphelins


def commande_ingerer(arguments):
    sources = [s.strip() for s in arguments.sources.split(",") if s.strip()]
    inconnues = set(sources) - set(SOURCES)
    if inconnues:
        sys.exit(f"sources inconnues : {', '.join(sorted(inconnues))} (attendu : {', '.join(SOURCES)})")
    if "enregistrements" in sources and "pixel" not in sources:
        sys.exit("enregistrements : il faut aussi la source pixel, à qui ils se rattachent")
    print("Sources")
    appels, messages, non_abouties, orphelins = collecter(sources)
    try:
        twenty = Twenty(*charger_acces(arguments.env, arguments.workspace))
        personnes = twenty.tout_lister("people")
        index, ambigus = index_telephones(personnes)
        print(f"CRM : {len(personnes)} personnes, {len(index)} numéros, {len(ambigus)} portés par plusieurs")
        erreurs = 0
        for pluriel, voulus in (("appels", appels), ("textMessages", messages)):
            existants = twenty.tout_lister(pluriel)
            creations, complements, bilan = planifier(pluriel, voulus, existants, index)
            rattaches = sum(1 for c, _ in creations if "personId" in c)
            fichiers = sum(len(v) for _, f in creations if f for v in f.values()) + \
                sum(len(v) for *_, f in complements if f for v in f.values())
            print(f"{pluriel} : {len(voulus)} lus, {len(existants)} déjà au CRM → {len(creations)} à créer "
                  f"({rattaches} rattachés), {len(complements)} à compléter, {fichiers} fichiers à téléverser, "
                  f"{bilan['sans_personne']} sans personne connue")
            if not arguments.essai:
                erreurs += ecrire(twenty, pluriel, creations, complements)
    except NonAbouti as erreur:
        print(f"NON ABOUTI : {erreur}", file=sys.stderr)
        return 2
    except RuntimeError as erreur:
        if "not found" in str(erreur):
            print(f"ÉCHEC : objets de l'app absents du workspace ; installer d'abord : crm-telephonie app apply "
                  f"--env {arguments.env} --workspace {arguments.workspace}", file=sys.stderr)
        else:
            print(f"ÉCHEC : {erreur}", file=sys.stderr)
        return 1
    if orphelins:
        print(f"⚠ enregistrements sans appel du même sens à ±{TOLERANCE_ENREGISTREMENT_S} s : {', '.join(orphelins)}")
    if arguments.essai:
        print("Essai : rien n'a été écrit.")
    if erreurs:
        return 1
    if non_abouties:
        print(f"NON ABOUTI : {'; '.join(non_abouties)}", file=sys.stderr)
        return 2
    return 0


def commande_app(arguments):
    """`twenty app plan|apply` de l'app, avec la clé du workspace visé ; jamais de suppression implicite."""
    url, cle = charger_acces(arguments.env, arguments.workspace)
    # --no-prune par défaut : un retrait du source ne supprime rien. --prune retire ce qui a quitté le source ;
    # sans --yes ni saisie possible, Twenty refuse toujours de supprimer un objet ou un champ (donc des données).
    commande = ["yarn", "twenty", "app", arguments.action, "--prune" if arguments.prune else "--no-prune", "--no-input"]
    if arguments.action == "apply":
        commande.append("--create")
    environnement = dict(os.environ, TWENTY_API_URL=url, TWENTY_API_KEY=cle)
    return subprocess.run(commande, cwd=APP_DIR, env=environnement).returncode


def commande_dossier(arguments):
    """Dossier de la barre latérale par valeur d'un champ SELECT (voir barre_laterale.py)."""
    import barre_laterale

    try:
        return barre_laterale.organiser(Twenty(*charger_acces(arguments.env, arguments.workspace)), arguments.objet,
                                        arguments.champ, arguments.nom, arguments.essai)
    except NonAbouti as erreur:
        print(f"NON ABOUTI : {erreur}", file=sys.stderr)
        return 2
    except RuntimeError as erreur:
        print(f"ÉCHEC : {erreur}", file=sys.stderr)
        return 1


def main(argv=None):
    parseur = argparse.ArgumentParser(prog="crm-telephonie", description=__doc__.split("\n")[0])
    sous = parseur.add_subparsers(dest="commande", required=True)
    for nom in ("ingerer", "app", "dossier", "telephone"):
        p = sous.add_parser(nom)
        if nom == "telephone":
            p.add_argument("action", choices=("cle", "installer"))
        if nom == "app":
            p.add_argument("action", choices=("plan", "apply"))
            p.add_argument("--prune", action="store_true",
                           help="retire ce qui a quitté le source (jamais un objet ni un champ sans confirmation)")
        if nom == "dossier":
            p.add_argument("--objet", default="person")
            p.add_argument("--champ", default="etiquette")
            p.add_argument("--nom", default="People")
            p.add_argument("--essai", action="store_true")
        p.add_argument("--env", choices=("staging", "prod"), required=True)
        p.add_argument("--workspace", required=True, help="sous-domaine du workspace (twenty-admin workspaces)")
        if nom == "ingerer":
            p.add_argument("--sources", default=",".join(SOURCES))
            p.add_argument("--essai", action="store_true", help="lit tout, calcule le plan, n'écrit rien")
    arguments = parseur.parse_args(argv)
    if arguments.commande == "dossier":
        return commande_dossier(arguments)
    if arguments.commande == "telephone":
        import installation_telephone

        try:
            action = installation_telephone.creer_cle if arguments.action == "cle" else installation_telephone.installer
            return action(arguments.env, arguments.workspace)
        except NonAbouti as erreur:
            print(f"NON ABOUTI : {erreur}", file=sys.stderr)
            return 2
    return commande_ingerer(arguments) if arguments.commande == "ingerer" else commande_app(arguments)


if __name__ == "__main__":
    sys.exit(main())
