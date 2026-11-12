#!/usr/bin/env python3
"""Fixtures du contrat : les sorties du code Python de référence (ingestion/), que le port Kotlin doit rendre à
l'identique (contrat/src/test). Données fictives uniquement : le dépôt est public.

    python3 outils/fixtures_contrat.py            # réécrit contrat/src/test/resources/fixtures.json
    python3 outils/fixtures_contrat.py --verifier # code 1 si le fichier n'est plus celui que le Python rend

Sans ffmpeg (runner de CI), la partie « silences » est reprise du fichier existant. Le fuseau est forcé à Europe/Paris, celui du téléphone.
"""
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

os.environ["TZ"] = "Europe/Paris"
time.tzset()
ICI = Path(__file__).resolve().parent
INGESTION = ICI.parent.parent / "ingestion"
SORTIE = ICI.parent / "contrat" / "src" / "test" / "resources" / "fixtures.json"
sys.path.insert(0, str(INGESTION))
import crm_telephonie as c  # noqa: E402
import telephone as t  # noqa: E402

NUMEROS = [None, "", 612345678, "06 12 34 56 78", " 06.12.34.56.78 ", " 06 12 34 56 78", "+33 6 12 34 56 78",
           "0033612345678", "+330612345678", "+3333612345678", "+33 (0)6 12 34 56 78", "CIC", "123", "+123",
           "+1234567", "+1 (415) 555-0100", "0612345678", "612345678", "+4930123456", "00 44 20 7946 0000", "Inconnu",
           "-2", "+33612345678901234"]
TEXTES = ["", "  bonjour  à\ttous\n", "Rendez-vous demain 9h ? OK", "x" * 89, "y" * 90, "z" * 91,
          "Mot " * 60, "😀" * 95, "abc def ghi", "fin avec espaces " + "a" * 80 + "   bcd",
          "ligne1\nligne2\r\nligne3", "émoji 👍🏽 et accents ÉÀÇ"]


def chemin_str(valeur):
    if isinstance(valeur, Path):
        return str(valeur)
    if isinstance(valeur, dict):
        return {k: chemin_str(v) for k, v in valeur.items()}
    if isinstance(valeur, (list, tuple)):
        return [chemin_str(v) for v in valeur]
    return valeur


def cas_planifier():
    """Scénarios : création, rattachement, complément sans écraser, rattachement manuel gardé, titre de l'outil
    ou retouché, transcription remplacée seulement si c'est la nôtre, source et moteur, fichiers, cle_seconde."""
    index = {"+33612345678": "p1", "+33698765432": "p2"}
    a1 = c.appel(1794485255200, "06 12 34 56 78", 125, "1", "Alice", "PIXEL_8_PRO")
    a2 = c.appel(1794485300000, "+33698765432", 0, "2", "", "PIXEL_8_PRO")
    a3 = c.appel(1794485400123, "0611111111", 42, "1", "", "PIXEL_8_PRO")
    a3["_fichiers"] = {"enregistrement": [Path("/sdcard/Recordings/JemRec/20261112_120000_in.ogg")]}
    a3["transcription"] = "[  0.0-  2.0] nouvelle"
    a3["sourceTranscription"], a3["moteurTranscription"] = "PARAKEET", "parakeet-tdt-0.6b-v3-q8_0 · x"
    a3["_remplace"] = {"transcription": ["[  0.0-  2.0] ancienne"]}
    a4 = c.appel(1794485500123, "+33612345678", 61, "2", "Alice", "PIXEL_8_PRO")
    a4["_fichiers"] = {"enregistrement": [Path("/x/20261112_121000_out.ogg")]}
    a4["transcription"] = "[  0.0-  1.0] même"
    a4["sourceTranscription"], a4["moteurTranscription"] = "PARAKEET", "m"
    a5 = c.appel(1794485600000, "+33612345678", 0, "3", "", "PIXEL_8_PRO")
    a6 = c.message_vocal(1794485700000, "+33698765432", "12", "PIXEL_8_PRO", "[  0.0-  1.0] allo", "GOOGLE",
                         "google-messagerie")
    a7 = c.appel(1794485800000, None, 10, "1", None, "PIXEL_8_PRO")
    a8 = c.appel(1794485900000, "+33612345678", 0, "2", "", "PIXEL_8_PRO")
    voulus = [a1, a2, a3, a4, a5, a6, a7, a8]
    existants = [
        # a2 par idSource, rattaché à la main à p9 : on ne touche pas au rattachement
        {"id": "e2", "idSource": a2["idSource"], "personId": "p9", "titre": "Sortant", "debutLe": a2["debutLe"],
         "numero": a2["numero"], "direction": "SORTANT", "nomSurTelephone": "", "enregistrement": []},
        # a3 par cle_seconde (Termux, idSource à la seconde) : transcription ancienne de l'outil → remplacée
        {"id": "e3", "idSource": "appel:1794485400000:+33611111111", "debutLe": c.iso_utc(1794485400000),
         "numero": "+33611111111", "direction": "ENTRANT", "titre": "Entrant · 42 s",
         "transcription": "[  0.0-  2.0] ancienne", "enregistrement": None, "personId": None},
        # a4 : transcription retouchée à la main → gardée ; fichier déjà là ; titre retouché
        {"id": "e4", "idSource": a4["idSource"], "debutLe": c.iso_utc(1794485500123).replace("123000Z", "123Z"), "numero": "+33612345678",
         "direction": "SORTANT", "titre": "Mon titre", "transcription": "[  0.0-  1.0] même",
         "enregistrement": [{"fileId": "f", "label": "x.ogg"}], "personId": ""},
        # a5 : titre ancien de l'outil → remis à la règle ; personne vide → rattachée
        {"id": "e5", "idSource": a5["idSource"], "titre": "Manqué", "debutLe": a5["debutLe"], "numero": a5["numero"],
         "direction": "MANQUE", "personId": None, "dureeSecondes": 0},
        # a8 : « Sortant » posé avant le 10/11 → « Sortant · sans réponse »
        {"id": "e8", "idSource": a8["idSource"], "titre": "Sortant", "debutLe": a8["debutLe"], "numero": a8["numero"],
         "direction": "SORTANT", "personId": "p1", "nomSurTelephone": {"a": "", "b": None}},
    ]
    sms1 = c.message(1794485255000, "+33612345678", "1", "Bonjour", "Alice", "PIXEL_8_PRO")
    sms2 = c.message(1794485256789, "+33698765432", "2", "Réponse", "", "PIXEL_8_PRO")
    mms = c.message(1794485257000, "+33612345678", None, "photo\n[1 pièce(s) jointe(s) : image/jpeg]", "",
                    "PIXEL_8_PRO", canal="MMS", sens="RECU")
    mms["_fichiers"] = {"piecesJointes": [Path("/etat/mms/mms3-piece7.jpg")]}
    existants_sms = [
        {"id": "s2", "idSource": "sms:1794485256000:+33698765432:ENVOYE:" + c.empreinte("Réponse"),
         "envoyeLe": c.iso_utc(1794485256000), "numero": "+33698765432", "sens": "ENVOYE", "texte": "Réponse",
         "personId": None, "nomSurTelephone": ""},
        {"id": "s3", "idSource": mms["idSource"], "envoyeLe": mms["envoyeLe"], "numero": mms["numero"], "sens": "RECU",
         "texte": mms["texte"], "piecesJointes": [], "personId": "p1"},
    ]
    resultats = []
    for pluriel, v, e in (("appels", voulus, existants), ("textMessages", [sms1, sms2, mms], existants_sms),
                          ("appels", voulus, [])):
        creations, complements, bilan = c.planifier(pluriel, v, e, index)
        resultats.append({"pluriel": pluriel, "voulus": chemin_str(v), "existants": e, "index": index,
                          "creations": chemin_str([[corps, f] for corps, f in creations]),
                          "complements": chemin_str([[i, ch, f] for i, ch, f in complements]),
                          "sans_personne": bilan["sans_personne"]})
    return resultats


def cas_silences():
    """silencedetect de ffmpeg sur un signal synthétique (bruit, silences courts et longs, fin muette)."""
    import random
    random.seed(7)
    taux, morceaux = 16000, []
    for duree, amplitude in ((0.7, 9000), (0.25, 100), (0.5, 7000), (0.31, 581), (0.4, 12000), (1.234, 300),
                             (0.05, 2000), (0.6, 0), (0.9, 5000), (0.8, 50)):
        morceaux += [int(random.uniform(-amplitude, amplitude)) for _ in range(int(duree * taux))]
    # échantillons aux bornes du seuil (582 parlé, 581 muet)
    morceaux[100:104] = [582, -582, 581, -581]
    with tempfile.TemporaryDirectory() as dossier:
        wav = Path(dossier) / "s.wav"
        with wave.open(str(wav), "wb") as w:
            w.setnchannels(1), w.setsampwidth(2), w.setframerate(taux)
            w.writeframes(b"".join(x.to_bytes(2, "little", signed=True) for x in morceaux))
        t.executer_suivi = lambda commande, delai, flux="stdout": subprocess.run(
            commande, capture_output=True, text=True, timeout=delai).stderr
        bornes = t.silences(wav)
    octets = b"".join(x.to_bytes(2, "little", signed=True) for x in morceaux)
    return {"pcm_s16le_base64": base64.b64encode(octets).decode(), "silences": bornes}


def main():
    jetons = [(0, 25, "▁Bon", True), (25, 40, "jour", False), (45, 90, "▁à", True), (95, 160, "▁tous.", True),
              (300, 335, "▁Oui", True), (336, 1500, "▁long", True), (1510, 1520, "▁", True), (1600, 1625, "▁fin?", True),
              (1625, 1650, "▁", True)]
    jetons2 = [(i * 15, i * 15 + 12, ("▁" if i % 3 == 0 else "") + f"m{i}", i % 3 == 0) for i in range(120)]
    resultat = {
        "normaliser": [[n, c.normaliser_numero(n)] for n in NUMEROS],
        "cle_numero": [[n, c.cle_numero(n)] for n in NUMEROS],
        "titres": [[d, s, c.titre_appel(d, s), c.titre_ancien(d, s)]
                   for d in ("ENTRANT", "SORTANT", "MANQUE", "MESSAGERIE", "REJETE", "BLOQUE", "AUTRE", "XYZ")
                   for s in (0, 5, 59, 60, 61, 3599, 3600, 3725, 86400)],
        "apercu": [[s, x, c.apercu_message(s, x)] for s in ("RECU", "ENVOYE", "BROUILLON", "ECHEC", "AUTRE") for x in TEXTES],
        "iso_utc": [[ms, c.iso_utc(ms)] for ms in (0, 1794485255200, 1794485255000, 1794485255999, 1794485255001,
                                                   1700000000123, 1774745999999)],
        "empreinte": [[x, c.empreinte(x)] for x in TEXTES],
        "appels": [[ms, n, d, ty, nom, c.appel(ms, n, d, ty, nom, "PIXEL_8_PRO")]
                   for ms, n, d, ty, nom in ((1794485255200, "0612345678", 125, "1", "Alice "),
                                            (1794485255000, None, 0, "3", None), (1794485255001, "CIC", 3, "7", ""),
                                            (1794485255002, " +33 6 98 76 54 32", 0, "2", "Bob"),
                                            (1794485255003, "", 10, "9", None), (1794485255004, "*123#", 0, "6", "x"))],
        "messages": [[ms, n, ty, x, nom, canal, sens, c.message(ms, n, ty, x, nom, "PIXEL_8_PRO", canal=canal, sens=sens)]
                     for ms, n, ty, x, nom, canal, sens in (
                         (1794485255200, "0612345678", "1", "Salut", "Alice", "SMS", None),
                         (1794485255000, "Telegram", "2", "Code 1234", "", "SMS", None),
                         (1794485255000, None, "5", None, None, "SMS", None),
                         (1794485255000, "+33612345678", None, "photo", "", "MMS", "ENVOYE"),
                         (1794485255000, "+33612345678", "4", "😀" * 100, "", "SMS", None),
                         (1794485255000, "+33612345678", "9", "x", "", "SMS", None))],
        "vocaux": [[ms, n, d, x, s, m, c.message_vocal(ms, n, d, "PIXEL_8_PRO", x, s, m)]
                   for ms, n, d, x, s, m in ((1794485255200, "+33612345678", "23", "[  0.0-  1.0] allo", "GOOGLE",
                                              "google-messagerie"), (1794485255000, "0698765432", "0", "", None, None),
                                             (1794485255000, None, "7", "texte", None, None))],
        "content_query": [],
        "personnes": [],
        "planifier": cas_planifier(),
        "lignes": [],
        "troncons": [],
        "jemrec": [],
        "nom_vocal": [[ms, t.nom_vocal(ms)] for ms in (1794485255200, 1774745999999, 1774746000000, 1792022400000)],
        "date_evenement": [[e, t.date_evenement(e)] for e in (
            {"debutLe": "2026-11-12T11:27:35.200000Z", "dureeSecondes": 125}, {"envoyeLe": "2026-11-12T11:27:35Z"},
            {"debutLe": "2026-11-12T11:27:35Z"}, {})],
        "silences": cas_silences() if shutil.which("ffmpeg") else json.loads(SORTIE.read_text(encoding="utf-8"))["silences"],
        "recette": [],
    }
    sorties = [
        ("Row: 0 _id=40, date=1794485255200, duration=2055, type=2\nRow: 1 _id=39, date=1794482586881, duration=0, type=3\n",
         ["_id", "date", "duration", "type"]),
        ("Row: 0 _id=3, number=+33612345678, date=1, duration=12, has_content=1, mime_type=audio/amr, transcription=Bonjour, "
         "c'est moi.\nRappelle-moi, merci\n\nRow: 1 _id=4, number=NULL, date=2, duration=0, has_content=0, mime_type=NULL, "
         "transcription=NULL\n", ["_id", "number", "date", "duration", "has_content", "mime_type", "transcription"]),
        ("No result found.\n", ["_id", "date"]),
        ("Row: 0 _id=1, body=a, b, c\r\nsuite\nRow: 1 _id=2\n", ["_id", "body"]),
        ("prefixe\nRow: 0 _id=1, date=5\nligne orpheline\n", ["_id", "date"]),
    ]
    resultat["content_query"] = [[s, k, c.parser_content_query(s, k)] for s, k in sorties]
    personnes = [
        {"id": "p1", "phones": {"primaryPhoneNumber": "612345678", "primaryPhoneCallingCode": "+33",
                                "additionalPhones": [{"number": "06 98 76 54 32", "callingCode": "+33"}]}},
        {"id": "p2", "phones": {"primaryPhoneNumber": "+33698765432", "primaryPhoneCallingCode": ""}},
        {"id": "p3", "phones": {"primaryPhoneNumber": "0611111111", "primaryPhoneCallingCode": None,
                                "additionalPhones": None}},
        {"id": "p4", "phones": {"primaryPhoneNumber": "", "primaryPhoneCallingCode": "+33"}},
        {"id": "p5", "phones": None},
        {"id": "p6", "phones": {"primaryPhoneNumber": "0033 6 22 22 22 22", "primaryPhoneCallingCode": "+33",
                                "additionalPhones": [{"number": "0611111111", "callingCode": "+33"}]}},
        {"id": "p6", "phones": {"primaryPhoneNumber": "0622222222"}},
    ]
    index, ambigus = c.index_telephones(personnes)
    resultat["personnes"] = {"personnes": personnes, "numeros": [sorted(c.numeros_personne(p)) for p in personnes],
                             "index": index, "ambigus": sorted(ambigus)}
    for j, decalage, a_partir_de in ((jetons, 0.0, None), (jetons, 30.25, None), (jetons, 30.0, 31.0),
                                     (jetons2, 61.35, None), ([], 0.0, None)):
        resultat["lignes"].append([[list(x) for x in j], decalage, a_partir_de, t.lignes_depuis_jetons(
            [(a / 100, b / 100, x, d) for a, b, x, d in j], decalage, a_partir_de=a_partir_de)])
    for duree, sil, cible, marge in ((10.0, [], 30.0, 7.5), (37.4, [], 30.0, 7.5), (37.6, [], 30.0, 7.5),
                                     (125.33, [(20.0, 21.0), (29.0, 30.5), (33.0, 34.0), (61.0, 61.4), (95.1, 95.6)], 30.0, 7.5),
                                     (300.0, [(x * 7.3, x * 7.3 + 0.4) for x in range(40)], 30.0, 7.5),
                                     (1931.237, [(x * 11.111, x * 11.111 + 0.35) for x in range(170)], 90.0, 30.0),
                                     (0.04, [], 30.0, 7.5)):
        resultat["troncons"].append([duree, sil, cible, marge, t.troncons(duree, sil, cible, marge)])
    with tempfile.TemporaryDirectory() as dossier:
        for nom in ("20261112_111656_out.ogg", "20261111_150805_in.ogg", "20260329_023000_in.ogg",
                    "20261025_023000_out.ogg", "20261025_013000_in.ogg", "note.ogg", "20261112_111656_out.txt",
                    "20261112_1116_in.ogg"):
            (Path(dossier) / nom).write_text("x")
        resultat["jemrec"] = [[Path(ch).stem, debut, sens] for debut, sens, ch, _ in c.lire_enregistrements(Path(dossier))]
    appels = [c.appel(ms, "+33612345678", 10, ty, "", "PIXEL_8_PRO") for ms, ty in (
        (1794485255200, "1"), (1794485300000, "1"), (1794485260000, "2"), (1794485500000, "1"))]
    enregistrements = [(1794485250000, "ENTRANT", Path("/j/a_in.ogg"), "texte a"),
                       (1794485290000, "ENTRANT", Path("/j/b_in.ogg"), ""),
                       (1794485262000, "SORTANT", Path("/j/c_out.ogg"), ""),
                       (1794485900000, "ENTRANT", Path("/j/d_in.ogg"), "orphelin")]
    orphelins = c.associer_enregistrements(appels, enregistrements)
    resultat["associer"] = {"appels_avant": [c.appel(ms, "+33612345678", 10, ty, "", "PIXEL_8_PRO") for ms, ty in (
        (1794485255200, "1"), (1794485300000, "1"), (1794485260000, "2"), (1794485500000, "1"))],
        "enregistrements": chemin_str([list(e) for e in enregistrements]), "appels": chemin_str(appels),
        "orphelins": orphelins}
    for troncon, chev in ((30, 0.0), (30.0, 1.5), (15, 0), (7.5, 0.25)):
        regl = {"parakeet": {"modele": Path("~/m/ggml-parakeet-tdt-0.6b-v3-q8_0.bin")}, "troncon_s": troncon,
                "chevauchement_s": chev}
        resultat["recette"].append([troncon, chev, t.id_modele("parakeet", regl), t.recette("parakeet", regl)])
    texte = json.dumps(resultat, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    if "--verifier" in sys.argv:
        if not SORTIE.exists() or SORTIE.read_text(encoding="utf-8") != texte:
            print(f"{SORTIE} n'est plus ce que rend le Python de référence : relancer sans --verifier", file=sys.stderr)
            return 1
        print("fixtures à jour")
        return 0
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_text(texte, encoding="utf-8")
    print(f"{SORTIE} : {len(texte)} octets")
    return 0


if __name__ == "__main__":
    sys.exit(main())
