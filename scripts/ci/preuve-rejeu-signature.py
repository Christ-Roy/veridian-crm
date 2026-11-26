#!/usr/bin/env python3
"""Preuve qu'une requête signée par le Hub ne se rejoue pas, ni sur sa route ni sur une autre. Lecture seule.

  preuve-rejeu-signature.py [--env staging|prod]

Une signature fraîche de `GET /api/hub/users` (sans corps) est jouée une fois (témoin : 200), rejouée telle quelle
(attendu : 401 signature_already_used), puis rejouée sur `GET /api/users/by-email` (autre route sans corps, attendu 401).
Témoin : une signature neuve sur cette autre route passe. Puis la v2 (méthode, chemin, requête, corps) : liée à sa route,
acceptée une fois. Aucune écriture. Codes : 0 vrai, 1 faux, 2 non abouti.
"""
import argparse
import hashlib
import hmac
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--env", default="staging", choices=("staging", "prod"))
    a = p.parse_args()
    echecs = []

    def controle(nom, ok, detail=""):
        print(("OK    " if ok else "ECHEC ") + nom + (f" : {detail}" if detail else ""), flush=True)
        if not ok:
            echecs.append(nom)

    try:
        c = ta.Client(a.env)

        def entetes(ts=None):
            ts = ts or str(int(time.time() * 1000))
            return {"X-Veridian-Timestamp": ts, "X-Veridian-Hub-Signature": hmac.new(c.secret.encode(), f"{ts}.".encode(), hashlib.sha256).hexdigest()}

        h = entetes()
        autre = c.base + "/api/users/by-email?email=" + "personne-inexistante%40example.invalid"
        code, texte, _ = c.http(c.base + "/api/hub/users", None, h, "GET")
        if code != 200:
            raise ta.Echec(f"témoin refusé : {code} {texte[:80]}", 2)
        controle("témoin : la signature fraîche passe une fois", True, f"HTTP {code}")
        code, texte, _ = c.http(c.base + "/api/hub/users", None, h, "GET")
        controle("rejeu sur la même route refusé", code == 401, f"HTTP {code} {texte[:60]}")
        code, texte, _ = c.http(autre, None, h, "GET")
        controle("rejeu sur une autre route refusé", code == 401, f"HTTP {code} {texte[:60]}")
        code, texte, _ = c.http(autre, None, entetes(), "GET")
        controle("témoin : une signature neuve sur l'autre route passe", code in (200, 404), f"HTTP {code}")

        def v2(methode, url):
            ts = str(int(time.time() * 1000))
            u = urlsplit(url)
            canon = "\n".join([ts, methode, u.path, u.query, hashlib.sha256(b"").hexdigest()])
            return {"X-Veridian-Timestamp": ts, "X-Veridian-Sig-Version": "2",
                    "X-Veridian-Hub-Signature": hmac.new(c.secret.encode(), canon.encode(), hashlib.sha256).hexdigest()}

        h2 = v2("GET", c.base + "/api/hub/users")
        code, _, _ = c.http(autre, None, h2, "GET")
        controle("v2 : la signature d'une route ne vaut pas pour une autre", code == 401, f"HTTP {code}")
        code, _, _ = c.http(c.base + "/api/hub/users", None, h2, "GET")
        controle("v2 : témoin, la signature passe sur sa route", code == 200, f"HTTP {code}")
        code, _, _ = c.http(c.base + "/api/hub/users", None, h2, "GET")
        controle("v2 : rejeu refusé", code == 401, f"HTTP {code}")
        h3 = v2("GET", c.base + "/api/users/by-email?email=a%40example.invalid")
        code, _, _ = c.http(c.base + "/api/users/by-email?email=b%40example.invalid", None, h3, "GET")
        controle("v2 : une autre query refusée", code == 401, f"HTTP {code}")
        code, _, _ = c.http(c.base + "/api/users/by-email?email=a%40example.invalid", None, h3, "GET")
        controle("v2 : témoin, la même query passe", code == 200, f"HTTP {code}")
    except ta.Echec as e:
        print(f"{'NON ABOUTI' if e.code == 2 else 'ECHEC'} {e}")
        return e.code
    print("VRAI : une signature du Hub ne sert qu'une fois" if not echecs else f"FAUX : {', '.join(echecs)}")
    return 0 if not echecs else 1


if __name__ == "__main__":
    sys.exit(main())
