#!/usr/bin/env python3
"""Preuve qu'un espace ne livre, sans session, que son nom : ni identifiant interne, ni lien signé de son logo.

  preuve-espace-public.py <sous-domaine connu> [--env staging|prod]

Interroge `getPublicWorkspaceDataByDomain` sans aucune session sur l'espace donné. Témoin : le nom revient (la requête
répond bien). Lecture seule, aucune donnée affichée hors du nom. Codes : 0 vrai, 1 faux, 2 non abouti.
"""
import argparse
import json
import re
import sys
import urllib.error
import urllib.request

DOMAINES = {"prod": "crm.app.veridian.site", "staging": "crm.staging.veridian.site"}
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--env", default="staging", choices=tuple(DOMAINES))
    a = p.parse_args()
    hote = f"https://{a.espace}.{DOMAINES[a.env]}"
    requete = {"query": "query($o:String!){getPublicWorkspaceDataByDomain(origin:$o){id displayName logo}}",
               "variables": {"o": hote}}
    req = urllib.request.Request(hote + "/metadata", data=json.dumps(requete).encode(),
                                 headers={"Content-Type": "application/json", "Origin": hote})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.loads(r.read())
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        print(f"NON ABOUTI {hote} : {e}")
        return 2
    w = (d.get("data") or {}).get("getPublicWorkspaceDataByDomain")
    if not w or not w.get("displayName"):
        print(f"NON ABOUTI : pas de nom pour {a.espace} ({json.dumps(d)[:120]})")
        return 2
    echecs = []
    for nom, ok in (("témoin : le nom revient", bool(w["displayName"])),
                    ("aucun identifiant interne", not UUID.match(str(w.get("id") or ""))),
                    ("aucun lien de logo", not w.get("logo"))):
        print(("OK    " if ok else "ECHEC ") + nom)
        if not ok:
            echecs.append(nom)
    print("VRAI : sans session, rien de plus que le nom" if not echecs else f"FAUX : {', '.join(echecs)}")
    return 0 if not echecs else 1


if __name__ == "__main__":
    sys.exit(main())
