#!/usr/bin/env python3
"""Preuve de la CSP du front (VER-265) sur un espace jetable : connexion par le Hub (lien magique signé), liste des
sociétés, panneau Liaisons « Chercher dans Prospection » (composant front dans son bac à sable), personnes, tâches,
réglages, puis contrôle positif (un `onerror` injecté). Chromium sur node02 ; les rapports reçus par le serveur sont
relus dans Loki (`csp_violation`).

  preuve-csp.py <espace jetable> [--env staging|prod] [--attendu report|enforce] [--captures <dossier>]

report : en-tête Report-Only avec empreintes, panneau affiché, contrôle exécuté ET signalé au navigateur et au serveur ;
toute autre violation est listée et fait sortir en 1 (pas prêt pour enforce).
enforce : en-tête appliqué, panneau affiché, contrôle BLOQUÉ et signalé, aucune autre violation.
Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import json
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

ICI = Path(__file__).parent
VENV = "$HOME/.cache/veridian-parcours-venv"


def navigateur(origine, lien, captures):
    prep = subprocess.run(["ssh", "-o", "ConnectTimeout=10", "node02",
                           f"[ -x {VENV}/bin/python ] || python3 -m venv {VENV}; "
                           f"{VENV}/bin/python -c 'import playwright' 2>/dev/null || nice -n 19 {VENV}/bin/pip install -q playwright==1.62.0"],
                          capture_output=True, text=True, timeout=600)
    if prep.returncode != 0:
        raise ta.Echec(f"node02 injoignable ou venv impossible : {prep.stderr[-200:]}", 2)
    if subprocess.run(["scp", "-q", str(ICI / "preuve-csp-navigateur.py"), "node02:/tmp/preuve-csp-navigateur.py"]).returncode:
        raise ta.Echec("copie vers node02 impossible", 2)
    r = subprocess.run(["ssh", "node02", f"rm -rf /tmp/preuve-csp-out; nice -n 10 {VENV}/bin/python -u /tmp/preuve-csp-navigateur.py "
                        f"{origine} /tmp/preuve-csp-out"], input=lien + "\n", capture_output=True, text=True, timeout=900)
    captures.mkdir(parents=True, exist_ok=True)
    subprocess.run(["scp", "-q", "node02:/tmp/preuve-csp-out/*.png", str(captures)])
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise ta.Echec(f"navigateur sans résultat : {(r.stderr or r.stdout)[-300:]}", 2)


def rapports_serveur(env, depuis):
    time.sleep(20)
    r = subprocess.run(["obs", "search", "csp_violation", "--since", "15m", "--env", env, "-n", "300", "-f", "ndjson"],
                       capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise ta.Echec(f"Loki illisible : {r.stderr[-200:]}", 2)
    vus = []
    for ligne in r.stdout.splitlines():
        try:
            d = json.loads(ligne)
        except ValueError:
            continue
        texte = str(d.get("line", ""))
        if "csp_violation {" in texte and "crm-server" in str(d.get("container", "")):
            vus.append(json.loads(texte[texte.index("csp_violation {") + len("csp_violation "):].split("\x1b")[0]))
    return vus


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--env", default="staging", choices=("staging", "prod"))
    p.add_argument("--attendu", default="report", choices=("report", "enforce"))
    p.add_argument("--captures", default="/tmp/preuve-csp")
    a = p.parse_args()
    echecs = []

    def controle(nom, ok, detail=""):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:260], flush=True)
        if not ok:
            echecs.append(nom)

    try:
        creds, pre = ta.lire_creds(), ta.prefixe(a.env, a.espace)
        if not creds.get(f"{pre}_JETABLE_TENANT_ID"):
            raise ta.Echec(f"{a.espace} n'est pas un espace jetable", 2)
        c = ta.Client(a.env)
        origine, _, _ = c.session(creds[f"{pre}_EMAIL"], a.espace)
        code, texte, _ = c.signe("/api/sso/issue-magic-link", {"hub_user_id": creds[f"{pre}_JETABLE_HUB_USER_ID"],
                                                               "email": creds[f"{pre}_EMAIL"], "email_proven": True})
        lien = json.loads(texte).get("magic_link_url") if code == 200 else None
        if not lien:
            raise ta.Echec(f"lien magique refusé : {code}", 2)
        debut = time.time()
        n = navigateur(origine, lien, Path(a.captures))
        serveur = rapports_serveur(a.env, debut)
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code

    doc = [e for e in n["entetes"] if e["politique"] and "script-src" in (e["politique"] or "")]
    controle("connexion par le Hub jusqu'à l'application", len(n["pages"]) >= 5 and not n["pages"][0].startswith("/welcome"), str(n["pages"]))
    attendu_entete = "enforce" if a.attendu == "enforce" else "report"
    controle(f"en-tête Veridian « {attendu_entete} » sur chaque document", bool(doc) and all(e["veridian"] == attendu_entete for e in doc),
             str([(e["chemin"], e["veridian"]) for e in n["entetes"]])[:200])
    controle("script-src sans 'unsafe-inline'", bool(doc) and all("unsafe-inline" not in e["politique"].split("script-src")[1].split(";")[0] for e in doc))
    controle("panneau Liaisons affiché (composant front dans son bac à sable)", n["panneau"], n.get("panneau_erreur", ""))
    controle("contrôle positif signalé au navigateur", n["controle"].get("signale") is True)
    if a.attendu == "enforce":
        controle("contrôle positif BLOQUÉ", n["controle"].get("execute") is False)
    else:
        controle("contrôle positif exécuté (Report-Only n'applique rien)", n["controle"].get("execute") is True)
    controle("contrôle positif reçu par le serveur (Loki)", any(v.get("directive") == "script-src-attr" for v in serveur),
             f"{len(serveur)} rapport(s) en 15 min")
    autres = Counter((v["page"], v["cadre"], v["directive"], v["bloque"], v["source"]) for v in n["violations"])
    autres_serveur = Counter((v.get("page"), v.get("directive"), v.get("blocked"), v.get("source")) for v in serveur
                             if v.get("directive") != "script-src-attr")
    controle("aucune autre violation au navigateur", not autres, "; ".join(f"{k} ×{x}" for k, x in autres.most_common(8)))
    controle("aucune autre violation reçue par le serveur", not autres_serveur,
             "; ".join(f"{k} ×{x}" for k, x in autres_serveur.most_common(8)))
    if n["console"]:
        print("console :", " | ".join(sorted(set(n["console"])))[:600])
    print(f"captures : {a.captures}")
    print("VERDICT :", "conforme" if not echecs else f"ÉCHEC {echecs}")
    return 0 if not echecs else 1


if __name__ == "__main__":
    sys.exit(main())
