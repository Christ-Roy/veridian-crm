#!/usr/bin/env python3
"""Preuve qu'un espace neuf reçoit les apps de base (Liaisons) dès sa création par le Hub, sans couple listé à la main.

  preuve-apps-de-base.py [--env staging|prod] [--attente 180]

Crée un espace jetable par la route signée du Hub (`/api/tenants/provision`, comme à la première ouverture), attend que
Liaisons y soit installée, puis retire l'espace. Témoin : la clé de l'espace lit bien ses apps (l'absence se prouve à côté
d'une présence). Codes : 0 vrai, 1 faux, 2 non abouti.
"""
import argparse
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

LIAISONS = "1a1ab23e-60e5-4eca-be1f-718c96055c79"


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--env", default="staging", choices=("staging", "prod"))
    p.add_argument("--attente", type=int, default=180)
    a = p.parse_args()
    espace = None
    try:
        avant = set(ta.lire_creds())
        args = argparse.Namespace(env=a.env, motif=f"apps de base {datetime.now():%H%M}")
        ta.cmd_jetable_creer(args)
        espace = args.workspace
        v = ta.lire_creds()
        pf = ta.prefixe(a.env, espace)
        if f"{pf}_API_KEY" in avant or not v.get(f"{pf}_JETABLE_TENANT_ID"):
            raise ta.Echec("jetable non rangé", 2)
        c = ta.Client(a.env)
        fin, apps = time.time() + a.attente, {}
        while time.time() < fin:
            apps = ta._installees(c, v[f"{pf}_API_URL"], v[f"{pf}_API_KEY"])
            if (apps.get(LIAISONS) or {}).get("version"):
                break
            time.sleep(10)
        lues = len(apps)
        print(f"témoin : la clé de l'espace lit ses apps : {lues} app(s) installée(s)")
        if lues == 0:
            raise ta.Echec("aucune app lisible dans l'espace : lecture non prouvée", 2)
        version = (apps.get(LIAISONS) or {}).get("version")
        print(("OK    " if version else "ECHEC ") + f"Liaisons posée à la création : {version or 'absente'} (attente {a.attente} s)")
        return 0 if version else 1
    except ta.Echec as e:
        print(f"{'NON ABOUTI' if e.code == 2 else 'ECHEC'} {e}")
        return e.code
    finally:
        if espace:
            ta.cmd_jetable_retirer(argparse.Namespace(env=a.env, workspace=espace))


if __name__ == "__main__":
    sys.exit(main())
