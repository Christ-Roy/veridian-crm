#!/usr/bin/env python3
"""Preuve qu'un espace neuf naît complet (Robert, 27/11) : apps de base (Liaisons, Dossiers, Téléphonie) et fonctions
natives allumées dès sa création par le Hub, IA, MCP tiers et Enterprise éteints.

  preuve-apps-de-base.py [--env staging|prod] [--attente 180]

Crée un espace jetable par la route signée du Hub (`/api/tenants/provision`, comme à la première ouverture), attend que
les apps de base y soient installées, lit ses drapeaux natifs, puis retire l'espace. Témoin : la clé de l'espace lit bien ses apps (l'absence se prouve à côté
d'une présence). Codes : 0 vrai, 1 faux, 2 non abouti.
"""
import argparse
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

APPS_DE_BASE = {
    "1a1ab23e-60e5-4eca-be1f-718c96055c79": "Liaisons",
    "dccc9944-ddb7-4019-a95d-ec27679f70ba": "Dossiers",
    "e3df4b02-559e-4624-b985-3fd49cfd1725": "Téléphonie",
}
NATIFS = {"IS_APP_PREFERENCES_ENABLED", "IS_CONFIGURABLE_SEARCH_FIELDS_ENABLED", "IS_GETTING_STARTED_ENABLED",
          "IS_CALENDAR_EVENT_SHARED_ACROSS_CHANNELS_ENABLED"}
ETEINTS = {"IS_AI_CHAT_INBOX_ENABLED", "IS_AI_CHAT_COMPONENT_BUILDER_ENABLED", "IS_MCP_SERVERS_ENABLED",
           "IS_RECORD_LEVEL_SHARING_ENABLED", "IS_RELATED_RECORD_PATHS_ENABLED",
           "IS_ROW_LEVEL_PERMISSION_RELATION_HOP_ENABLED"}


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
            if all((apps.get(u) or {}).get("version") for u in APPS_DE_BASE):
                break
            time.sleep(10)
        lues = len(apps)
        print(f"témoin : la clé de l'espace lit ses apps : {lues} app(s) installée(s)")
        if lues == 0:
            raise ta.Echec("aucune app lisible dans l'espace : lecture non prouvée", 2)
        ok = True
        for u, nom in APPS_DE_BASE.items():
            version = (apps.get(u) or {}).get("version")
            ok &= bool(version)
            print(("OK    " if version else "ECHEC ") + f"{nom} posée à la création : {version or 'absente'} (attente {a.attente} s)")
        lu = ta._gql_cle(c, v[f"{pf}_API_URL"], v[f"{pf}_API_KEY"], "{currentWorkspace{featureFlags{key value}}}")
        drapeaux = {d["key"]: d["value"] for d in (lu.get("currentWorkspace") or {}).get("featureFlags") or []}
        if not drapeaux:
            raise ta.Echec("aucun drapeau lisible dans l'espace : lecture non prouvée", 2)
        print(f"témoin : {len(drapeaux)} drapeau(x) lus, {sum(drapeaux.values())} allumé(s)")
        for cle in sorted(NATIFS):
            allume = drapeaux.get(cle) is True
            ok &= allume
            print(("OK    " if allume else "ECHEC ") + f"{cle} allumé à la naissance")
        for cle in sorted(ETEINTS):
            eteint = drapeaux.get(cle) is not True
            ok &= eteint
            print(("OK    " if eteint else "ECHEC ") + f"{cle} éteint")
        return 0 if ok else 1
    except ta.Echec as e:
        print(f"{'NON ABOUTI' if e.code == 2 else 'ECHEC'} {e}")
        return e.code
    finally:
        if espace:
            ta.cmd_jetable_retirer(argparse.Namespace(env=a.env, workspace=espace))


if __name__ == "__main__":
    sys.exit(main())
