#!/usr/bin/env python3
"""Contrôle de l'administration d'instance avant toute bascule : chaque adresse listée au job a son identité au Hub, la liste
d'identités est exactement celle-là, et les administrateurs en base sont exactement ces personnes. Ne nomme personne.

  admins-instance.py prod|staging [--sans-base]   (--sans-base : une image antérieure ne dit pas server_admin)

Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

RACINE = Path(__file__).resolve().parents[2]


def liste(texte, nom):
    m = re.search(rf"^{nom}=(.*)$", texte, re.M)
    return [x.strip().lower() for x in m.group(1).split(",") if x.strip()] if m else []


def identite(env, adresse):
    for essai in range(3):
        try:
            r = subprocess.run(["hub", "--env", env, "user", adresse], capture_output=True, text=True, timeout=60)
        except subprocess.TimeoutExpired:
            continue
        if r.returncode == 3 and '"not_found"' in r.stdout + r.stderr:
            return None
        if r.returncode == 0 and '"user"' in r.stdout:
            trouve = re.search(r'"supabase_user_id":\s*"([0-9a-f-]{36})"', r.stdout)
            return trouve.group(1) if trouve else None
        time.sleep(5 * (essai + 1))
    raise ta.Echec("le Hub ne répond pas", 2)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("env", choices=("prod", "staging"))
    p.add_argument("--sans-base", action="store_true")
    a = p.parse_args()
    job = (RACINE / f"deploy/crm-{a.env}.nomad.hcl").read_text()
    adresses, ids = liste(job, "HUB_SERVER_ADMIN_EMAILS"), liste(job, "HUB_SERVER_ADMIN_HUB_USER_IDS")
    if not adresses or not ids:
        print("ADMINS_NON_ABOUTI liste absente du job")
        return 2
    try:
        trouves = [identite(a.env, x) for x in adresses]
    except ta.Echec as e:
        print(f"ADMINS_NON_ABOUTI {e}")
        return 2
    sans = trouves.count(None)
    if sans:
        print(f"ADMINS_REFUS {sans} adresse(s) sur {len(adresses)} sans identité reliée au Hub : pas de bascule")
        return 1
    if set(trouves) != set(ids) or len(ids) != len(set(ids)):
        print(f"ADMINS_REFUS les deux listes ne désignent pas les mêmes personnes ({len(set(trouves))} et {len(ids)})")
        return 1
    if a.sans_base:
        print(f"ADMINS_OK {len(ids)} personne(s), mêmes listes (base non lue)")
        return 0
    try:
        comptes = ta.Client(a.env).utilisateurs()
    except (ta.Echec, json.JSONDecodeError) as e:
        print(f"ADMINS_NON_ABOUTI {e}")
        return 2
    if any("server_admin" not in u for u in comptes):
        print("ADMINS_NON_ABOUTI l'image servie ne dit pas server_admin")
        return 2
    en_base = {u["hub_user_id"] for u in comptes if u["server_admin"]}
    attendus = set(ids) & {u["hub_user_id"] for u in comptes}
    if en_base != attendus:
        print(f"ADMINS_FAUX en base {len(en_base)}, attendus {len(attendus)} : {len(en_base - attendus)} de trop, {len(attendus - en_base)} manquant(s)")
        return 1
    print(f"ADMINS_OK {len(ids)} personne(s) listée(s), {len(en_base)} en base, ensembles égaux")
    return 0


if __name__ == "__main__":
    sys.exit(main())
