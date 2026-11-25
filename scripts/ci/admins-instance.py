#!/usr/bin/env python3
"""Contrôle de l'administration d'instance avant toute bascule, par identités seules : chaque hub_user_id listé au job
existe au Hub, et les administrateurs en base sont exactement ces identités, personne d'autre. Aucune adresse lue ni affichée.

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

UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
RACINE = Path(__file__).resolve().parents[2]


def liste(texte, nom):
    m = re.search(rf"^{nom}=(.*)$", texte, re.M)
    return [x.strip().lower() for x in m.group(1).split(",") if x.strip()] if m else []


def identites_du_hub(env):
    """Les hub_user_id du Hub, par la liste des tenants (la seule vue du Hub qui les donne sans passer par une adresse)."""
    for essai in range(3):
        try:
            r = subprocess.run(["hub", "--env", env, "tenants"], capture_output=True, text=True, timeout=90)
            d = json.loads(r.stdout) if r.returncode == 0 else None
        except (subprocess.TimeoutExpired, json.JSONDecodeError):
            d = None
        if d and isinstance(d.get("tenants"), list):
            if d.get("total") != len(d["tenants"]):
                raise ta.Echec("la liste des tenants du Hub est tronquée", 2)
            return {str(t["user_id"]).lower() for t in d["tenants"] if t.get("user_id")}
        time.sleep(5 * (essai + 1))
    raise ta.Echec("le Hub ne répond pas", 2)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("env", choices=("prod", "staging"))
    p.add_argument("--sans-base", action="store_true")
    a = p.parse_args()
    job = (RACINE / f"deploy/crm-{a.env}.nomad.hcl").read_text()
    ids = liste(job, "HUB_SERVER_ADMIN_HUB_USER_IDS")
    if not ids:
        print("ADMINS_NON_ABOUTI liste absente du job")
        return 2
    if len(ids) != len(set(ids)) or not all(UUID.fullmatch(x) for x in ids):
        print("ADMINS_REFUS la liste d'identités est mal formée ou répète une identité")
        return 1
    try:
        connus = identites_du_hub(a.env)
    except ta.Echec as e:
        print(f"ADMINS_NON_ABOUTI {e}")
        return 2
    inconnus = [x for x in ids if x not in connus]
    comptes = []
    if not a.sans_base:
        try:
            comptes = ta.Client(a.env).utilisateurs()
        except (ta.Echec, json.JSONDecodeError) as e:
            print(f"ADMINS_NON_ABOUTI {e}")
            return 2
    # un compte du Hub sans tenant n'est dans aucune liste du Hub sans adresse : le CRM, qui ne reçoit ses identités que du Hub, le dit
    vus_du_crm = {str(u.get("hub_user_id")).lower() for u in comptes}
    inconnus = [x for x in inconnus if x not in vus_du_crm]
    if inconnus and a.sans_base:
        print(f"ADMINS_NON_ABOUTI {len(inconnus)} identité(s) sur {len(ids)} hors des tenants du Hub, base non lue : non vérifiable sans adresse")
        return 2
    if inconnus:
        print(f"ADMINS_REFUS {len(inconnus)} identité(s) sur {len(ids)} absente(s) du Hub et du CRM : pas de bascule")
        return 1
    if a.sans_base:
        print(f"ADMINS_OK {len(ids)} personne(s), toutes au Hub (base non lue)")
        return 0
    if any("server_admin" not in u for u in comptes):
        print("ADMINS_NON_ABOUTI l'image servie ne dit pas server_admin")
        return 2
    en_base = {str(u["hub_user_id"]).lower() for u in comptes if u["server_admin"]}
    attendus = set(ids) & {str(u["hub_user_id"]).lower() for u in comptes}
    if en_base != attendus:
        print(f"ADMINS_FAUX en base {len(en_base)}, attendus {len(attendus)} : {len(en_base - attendus)} de trop, {len(attendus - en_base)} manquant(s)")
        return 1
    print(f"ADMINS_OK {len(ids)} personne(s) listée(s), {len(en_base)} en base, ensembles égaux")
    return 0


if __name__ == "__main__":
    sys.exit(main())
