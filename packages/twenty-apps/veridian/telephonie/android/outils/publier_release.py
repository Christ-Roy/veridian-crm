#!/usr/bin/env python3
"""Publie l'APK en release GitHub, sans dépendance (API REST, jeton GH_TOKEN) :
  - `telephonie-v<version>` : la version datée, gardée ;
  - `telephonie-android` : le lien stable, dont les fichiers sont remplacés à chaque construction.
Le lien stable ne dépend pas de « latest » du dépôt (le CRM peut publier ses propres releases).

    publier_release.py <owner/dépôt> <version> <commit> <apk> <sha256>
Codes : 0 publié, 1 refusé par GitHub, 2 non abouti (réseau)."""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEPOT, VERSION, COMMIT, APK, SOMME = sys.argv[1:6]
JETON = os.environ["GH_TOKEN"]
API = f"https://api.github.com/repos/{DEPOT}"
STABLE = "telephonie-android"


def appel(methode, url, corps=None, type_contenu="application/json", attendu=(200, 201, 204)):
    donnees = corps if isinstance(corps, (bytes, type(None))) else json.dumps(corps).encode()
    requete = urllib.request.Request(url, donnees, method=methode, headers={
        "Authorization": f"Bearer {JETON}", "Accept": "application/vnd.github+json", "Content-Type": type_contenu,
        "X-GitHub-Api-Version": "2022-11-28"})
    try:
        with urllib.request.urlopen(requete, timeout=300) as r:
            texte = r.read().decode()
            return r.status, (json.loads(texte) if texte else None)
    except urllib.error.HTTPError as e:
        if e.code in attendu:
            return e.code, None
        texte = e.read().decode()[:300]
        if methode == "GET" and e.code == 404:
            return 404, None
        print(f"ÉCHEC : {methode} {url} : HTTP {e.code} {texte}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"NON ABOUTI : {e}", file=sys.stderr)
        sys.exit(2)


def release(tag, nom, notes, prerelease):
    code, r = appel("GET", f"{API}/releases/tags/{tag}")
    if code == 404:
        _, r = appel("POST", f"{API}/releases", {"tag_name": tag, "target_commitish": COMMIT, "name": nom, "body": notes,
                                                  "prerelease": prerelease, "make_latest": "false"})
    else:
        _, r = appel("PATCH", f"{API}/releases/{r['id']}", {"name": nom, "body": notes, "make_latest": "false"})
        # Le tag stable suit le dernier commit construit.
        appel("PATCH", f"{API}/git/refs/tags/{tag}", {"sha": COMMIT, "force": True})
    return r


def televerser(r, chemin):
    nom = os.path.basename(chemin)
    for a in r.get("assets", []):
        if a["name"] == nom:
            appel("DELETE", f"{API}/releases/assets/{a['id']}")
    base = r["upload_url"].split("{")[0]
    with open(chemin, "rb") as f:
        contenu = f.read()
    type_contenu = "application/vnd.android.package-archive" if nom.endswith(".apk") else "text/plain"
    appel("POST", f"{base}?name={urllib.parse.quote(nom)}", contenu, type_contenu)


somme = open(SOMME).read().split()[0]
notes = (f"Téléphonie CRM {VERSION} (commit {COMMIT[:10]}).\n\nSHA-256 de l'APK : `{somme}`\n\n"
         "Installation et réglages : packages/twenty-apps/veridian/telephonie/android/LISEZMOI.md")
for tag, nom, pre in ((f"telephonie-v{VERSION}", f"Téléphonie CRM {VERSION}", True),
                      (STABLE, "Téléphonie CRM (dernière version)", False)):
    r = release(tag, nom, notes, pre)
    televerser(r, APK)
    televerser(r, SOMME)
    print(f"publié : {r['html_url']}")
print(f"lien stable : https://github.com/{DEPOT}/releases/download/{STABLE}/telephonie-crm.apk")
