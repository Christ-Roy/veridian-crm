#!/usr/bin/env python3
"""Publie l'APK en release GitHub, sans dépendance (API REST, jeton GH_TOKEN) :
  - `telephonie-v<version>` : la version datée, gardée ;
  - `telephonie-android` : le lien stable, dont les fichiers sont remplacés à chaque construction.
Une release neuve naît en BROUILLON (dépôt public : la publier est une décision de Robert). `telephonie-android`
est PUBLIÉE depuis le 12/11/2026 (accord de Robert, lien de https://veridian.site/telephonie) : elle le reste, ses
fichiers sont remplacés sans trou (nouveaux fichiers téléversés sous un nom provisoire, puis échange de noms), pour
que le lien public ne rende jamais 404 ni une somme qui ne correspond pas à l'APK pendant un téléversement.
Le lien stable ne dépend pas de « latest » du dépôt (le CRM peut publier ses propres releases).

    publier_release.py <owner/dépôt> <version> <commit> <fichier>...   (l'APK, sa somme .sha256, l'archive de l'app Twenty)
Codes : 0 publié, 1 refusé par GitHub, 2 non abouti (réseau)."""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEPOT, VERSION, COMMIT = sys.argv[1:4]
FICHIERS = sys.argv[4:]
SOMME = next(f for f in FICHIERS if f.endswith(".apk.sha256"))
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
    """Release en BROUILLON (dépôt public : la publier est une décision de Robert). Un brouillon n'a pas de tag
    tant qu'il n'est pas publié : il se retrouve par son tag_name dans la liste (visible avec le jeton)."""
    _, liste = appel("GET", f"{API}/releases?per_page=100")
    # Un brouillon modifié peut perdre son tag (GitHub le montre « untagged-… », vu le 12/11) : retrouvé aussi par son nom.
    r = next((x for x in liste or [] if x["tag_name"] == tag), None) or \
        next((x for x in liste or [] if x.get("draft") and x["name"] == nom), None)
    if r is None:
        _, r = appel("POST", f"{API}/releases", {"tag_name": tag, "target_commitish": COMMIT, "name": nom, "body": notes,
                                                  "prerelease": prerelease, "draft": True, "make_latest": "false"})
    elif r.get("draft"):
        _, r = appel("PATCH", f"{API}/releases/{r['id']}", {"tag_name": tag, "name": nom, "body": notes, "target_commitish": COMMIT})
    else:
        # Publiée par Robert : on met à jour ses fichiers et son tag suit le dernier commit construit.
        _, r = appel("PATCH", f"{API}/releases/{r['id']}", {"name": nom, "body": notes, "make_latest": "false"})
        appel("PATCH", f"{API}/git/refs/tags/{tag}", {"sha": COMMIT, "force": True})
    return r


PROVISOIRE = "nouveau-"


def remplacer(r, chemins):
    """Téléverse tous les fichiers sous un nom provisoire, puis seulement ensuite supprime chaque ancien et renomme le
    nouveau : le lien public ne manque l'APK que le temps d'un DELETE suivi d'un PATCH, et l'APK et sa somme changent
    ensemble au lieu d'être décalés de la durée d'un téléversement de 13 Mo (vu le 12/11 : ancien code DELETE puis POST)."""
    noms = {os.path.basename(c) for c in chemins}
    anciens = {a["name"]: a["id"] for a in r.get("assets", [])}
    for nom, ident in anciens.items():  # restes d'une construction interrompue
        if nom.startswith(PROVISOIRE) and nom[len(PROVISOIRE):] in noms:
            appel("DELETE", f"{API}/releases/assets/{ident}")
    base = r["upload_url"].split("{")[0]
    nouveaux = {}
    for chemin in chemins:
        nom = os.path.basename(chemin)
        with open(chemin, "rb") as f:
            contenu = f.read()
        type_contenu = ("application/vnd.android.package-archive" if nom.endswith(".apk") else
                        "application/gzip" if nom.endswith(".tgz") else "text/plain")
        _, a = appel("POST", f"{base}?name={urllib.parse.quote(PROVISOIRE + nom)}", contenu, type_contenu)
        nouveaux[nom] = a["id"]
    for nom, ident in nouveaux.items():
        if nom in anciens:
            appel("DELETE", f"{API}/releases/assets/{anciens[nom]}")
        appel("PATCH", f"{API}/releases/assets/{ident}", {"name": nom})


somme = open(SOMME).read().split()[0]
notes = (f"Téléphonie CRM {VERSION} (commit {COMMIT[:10]}).\n\nSHA-256 de l'APK : `{somme}`\n\n"
         f"Installation : https://github.com/{DEPOT}/blob/staging/packages/twenty-apps/veridian/telephonie/LISEZMOI.md\n"
         "telephonie-twenty-app.tgz : l'app Twenty (objets Appels et SMS, rôle Téléphone), à installer dans votre Twenty.")
for tag, nom, pre in ((f"telephonie-v{VERSION}", f"Téléphonie CRM {VERSION}", True),
                      (STABLE, "Téléphonie CRM (dernière version)", False)):
    r = release(tag, nom, notes, pre)
    remplacer(r, FICHIERS)
    print(f"{'brouillon' if r.get('draft') else 'publié'} : {r['html_url']}")
print(f"lien stable : https://github.com/{DEPOT}/releases/download/{STABLE}/telephonie-crm.apk")
