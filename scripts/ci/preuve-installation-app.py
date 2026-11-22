#!/usr/bin/env python3
"""preuve-installation-app.py : la garde d'installation (VER-173) refuse ou laisse installer, sur l'instance réelle.

Appelle la mutation native `installApplication(universalIdentifier)` avec la clé Admin rangée de l'espace
(twenty-admin agent:grant ou jetable:creer), jamais affichée, puis compare à l'attendu :
  refus     : Twenty répond FORBIDDEN (la garde), et l'app n'apparaît pas dans l'espace ;
  installe  : la mutation répond l'app installée, ou « déjà installée » (la garde est passée).

Usage : preuve-installation-app.py [--env prod|staging] --attendu refus|installe <sous-domaine> <uid-app>
Sortie : 0 conforme à l'attendu · 1 contraire · 2 mesure non aboutie (clé absente, réponse illisible, autre erreur)
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude" / "skills" / "twenty-cli" / "bin"))
import twenty_admin as ta  # noqa: E402

INSTALLER = "mutation($u:String!){installApplication(universalIdentifier:$u){id universalIdentifier version}}"
LISTER = "{findManyApplications{universalIdentifier version}}"


def appeler(c, url, cle, requete, variables=None):
    code, texte, _ = c.http(url + "/metadata", json.dumps({"query": requete, "variables": variables or {}}).encode(),
                            {"Authorization": f"Bearer {cle}", "Content-Type": "application/json"})
    try:
        return code, json.loads(texte)
    except ValueError:
        return code, None


def installees(c, url, cle):
    code, d = appeler(c, url, cle, LISTER)
    if not d or d.get("errors"):
        return None
    return {a["universalIdentifier"]: a["version"] for a in d["data"]["findManyApplications"]}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--env", default="prod", choices=["prod", "staging"])
    p.add_argument("--attendu", required=True, choices=["refus", "installe"])
    p.add_argument("workspace")
    p.add_argument("uid")
    a = p.parse_args()
    try:
        url, cle = ta._cle(a.env, a.workspace)
    except ta.Echec as e:
        print(f"NON ABOUTI : {e}")
        return 2
    c = ta.Client(a.env)
    avant = installees(c, url, cle)
    if avant is None:
        print("NON ABOUTI : la clé ne lit pas les apps de l'espace")
        return 2
    code, d = appeler(c, url, cle, INSTALLER, {"u": a.uid})
    if d is None:
        print(f"NON ABOUTI : réponse illisible (HTTP {code})")
        return 2
    erreurs = d.get("errors") or []
    codes = {(e.get("extensions") or {}).get("code") for e in erreurs}
    message = (erreurs[0].get("message", "") if erreurs else "")[:200]
    apres = installees(c, url, cle) or {}
    trace = f"{a.env} {a.workspace} {a.uid} : avant {avant.get(a.uid) or 'absente'}, après {apres.get(a.uid) or 'absente'}"
    if not erreurs:
        verdict = "INSTALLÉE"
    elif "FORBIDDEN" in codes and "not allowed on workspace" in message:
        verdict = "REFUSÉE PAR LA GARDE"
    elif "APP_ALREADY_INSTALLED" in codes or "already installed" in message.lower():
        verdict = "DÉJÀ INSTALLÉE (garde passée)"
    else:
        print(f"NON ABOUTI : {trace} ; erreur {sorted(c for c in codes if c)} « {message} »")
        return 2
    print(f"{verdict} : {trace}" + (f" ; « {message} »" if message else ""))
    if a.attendu == "refus":
        return 0 if verdict == "REFUSÉE PAR LA GARDE" and avant.get(a.uid) == apres.get(a.uid) else 1
    return 0 if verdict != "REFUSÉE PAR LA GARDE" else 1


if __name__ == "__main__":
    sys.exit(main())
