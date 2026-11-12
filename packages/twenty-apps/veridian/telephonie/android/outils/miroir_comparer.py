#!/usr/bin/env python3
"""Compare le plan de l'app en mode miroir à ce que l'agent Termux a écrit au CRM. Sur le bastion (clé du rôle
Téléphone dans les credentials), après `etat --ez synchro true` et un `adb pull` des exports de l'app :

    python3 outils/miroir_comparer.py DOSSIER_EXPORTS DEPUIS_ISO   # ex. 2026-11-12T15:00:00Z

N'affiche que des comptes et des noms de champs, jamais un numéro ni un texte. Codes : 0 égalité, 1 écart, 2 non abouti.

 1. chaque record du CRM (appareil du Pixel) créé depuis DEPUIS doit être connu de l'app (même événement : même
    idSource, ou même numéro, même seconde et, pour un message, même sens et même texte) ;
 2. chaque création que l'app aurait faite doit exister au CRM avec les mêmes champs (sinon : l'app aurait créé un
    doublon, ou Termux a manqué l'événement) ;
 3. les compléments que l'app aurait faits sont comptés par champ.
"""
import collections
import json
import os
import sys
import urllib.parse
import urllib.request

FICHIER = os.path.join(os.path.expanduser("~/credentials"), ".all-" + "creds.env")
PREFIXE = "TWENTY_PROD_VERIDIAN_4_TELEPHONE_API_"
CHAMPS = {"appels": ("titre", "direction", "canal", "dureeSecondes", "numero", "nomSurTelephone", "appareil"),
          "textMessages": ("apercu", "texte", "sens", "canal", "numero", "nomSurTelephone", "appareil")}


def acces():
    v = {}
    for ligne in open(FICHIER):
        k, _, x = ligne.rstrip("\n").partition("=")
        if k.startswith(PREFIXE):
            v[k[len(PREFIXE):]] = x.strip().strip('"').strip("'")
    return v["URL"].rstrip("/"), v["KEY"]


def lister(url, cle, pluriel, filtre):
    tous, curseur = [], None
    while True:
        chemin = f"/rest/{pluriel}?limit=200&depth=0&filter=" + urllib.parse.quote(filtre)
        if curseur:
            chemin += "&starting_after=" + urllib.parse.quote(curseur)
        r = json.loads(urllib.request.urlopen(urllib.request.Request(url + chemin, headers={"Authorization": "Bearer " + cle}),
                                              timeout=60).read())
        tous += r["data"][pluriel]
        if not (r.get("pageInfo") or {}).get("hasNextPage"):
            return tous
        curseur = r["pageInfo"]["endCursor"]


def cle_evenement(pluriel, id_source=None, record=None):
    """(numéro, seconde, sens, empreinte) depuis un idSource « type:ms:numéro[:sens:empreinte] » ou un record."""
    if id_source:
        morceaux = id_source.split(":")
        seconde = int(morceaux[1]) // 1000
        if pluriel == "appels":
            return (morceaux[0] == "messagerie", morceaux[2], seconde)
        return (morceaux[0], morceaux[2], seconde, morceaux[3], morceaux[4])
    import datetime as dt
    champ = "debutLe" if pluriel == "appels" else "envoyeLe"
    seconde = int(dt.datetime.fromisoformat(record[champ].replace("Z", "+00:00")).timestamp())
    if pluriel == "appels":
        return (record["idSource"].startswith("messagerie:"), record["idSource"].split(":")[2], seconde)
    m = record["idSource"].split(":")
    return (m[0], m[2], seconde, m[3], m[4])


def main():
    dossier, depuis = sys.argv[1], sys.argv[2]
    try:
        url, cle = acces()
        crm = {p: lister(url, cle, p, f'and(appareil[eq]:PIXEL_8_PRO,createdAt[gte]:"{depuis}")') for p in CHAMPS}
    except Exception as e:  # noqa: BLE001
        print(f"NON ABOUTI : CRM : {e}")
        return 2
    connus = collections.defaultdict(set)
    for ligne in open(os.path.join(dossier, "synchro.tsv"), encoding="utf-8"):
        pluriel, id_source, _ = ligne.rstrip("\n").split("\t")
        connus[pluriel].add(cle_evenement(pluriel, id_source=id_source))
    miroir = [json.loads(l) for l in open(os.path.join(dossier, "miroir.jsonl"), encoding="utf-8")] \
        if os.path.exists(os.path.join(dossier, "miroir.jsonl")) else []
    ecarts = 0
    for pluriel, records in crm.items():
        manques = [r for r in records if cle_evenement(pluriel, record=r) not in connus[pluriel]]
        print(f"{pluriel} : {len(records)} créés au CRM depuis {depuis}, {len(records) - len(manques)} connus de l'app, "
              f"{len(manques)} inconnus")
        ecarts += len(manques)
        par_cle = {cle_evenement(pluriel, record=r): r for r in records}
        creations = [m for m in miroir if m["pluriel"] == pluriel and m["action"] == "creer" and m["le"] >= depuis]
        champs_differents, absents = collections.Counter(), 0
        for m in creations:
            r = par_cle.get(cle_evenement(pluriel, id_source=m["idSource"]))
            if r is None:
                absents += 1
                continue
            for k in CHAMPS[pluriel]:
                if (m["champs"].get(k) or "") != (r.get(k) or ""):
                    champs_differents[k] += 1
        print(f"  plan miroir : {len(creations)} créations, {len(creations) - absents} trouvées au CRM, {absents} absentes ; "
              f"champs différents : {dict(champs_differents) or 'aucun'}")
        ecarts += absents + sum(champs_differents.values())
        complements = collections.Counter(k for m in miroir if m["pluriel"] == pluriel and m["action"] == "completer"
                                          for k in list(m["champs"]) + [f"fichier:{f}" for f in (m.get("fichiers") or {})])
        print(f"  compléments que l'app aurait faits : {dict(complements) or 'aucun'}")
    print("ÉGALITÉ" if not ecarts else f"ÉCARTS : {ecarts}")
    return 0 if not ecarts else 1


if __name__ == "__main__":
    sys.exit(main())
