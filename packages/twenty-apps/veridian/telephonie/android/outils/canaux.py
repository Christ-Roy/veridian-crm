#!/usr/bin/env python3
"""Les deux canaux de l'app Android, sans dépendance (API REST de GitHub, jeton GH_TOKEN, jamais affiché).

  essai   release `telephonie-android-essai` : chaque construction de staging, tout de suite à 100 %.
  stable  release `telephonie-android` : ce que reçoivent les clients. N'avance QUE par `promouvoir`, d'une version déjà
          publiée en essai : mêmes octets, même empreinte, rien n'est reconstruit.

Chaque release porte `manifeste.json` (lu par l'app, contrat/MiseAJour.kt), `telephonie-crm-<code>.apk` (jamais remplacé)
et sa fiche `telephonie-crm-<code>.json`. Le manifeste est toujours écrit en dernier.

    canaux.py essai <dépôt> --code N --version V --commit SHA APK ARCHIVE
    canaux.py promouvoir <dépôt> --code N [--pourcentage 10]
    canaux.py pourcentage <dépôt> --canal stable --pourcentage 50    le lien public suit à 100 %
    canaux.py suspendre <dépôt> --canal stable --raison "…"          coupe-circuit : plus aucune installation
    canaux.py reprendre <dépôt> --canal stable
    canaux.py minimale <dépôt> --canal stable --code N               sous N, le pourcentage ne retient plus
    canaux.py etat <dépôt>                                           lecture seule, sans jeton sur un dépôt public

`--a-blanc` : montre les écritures sans en faire une seule. Une release neuve naît en BROUILLON (dépôt public : la
publier est une décision de Robert) ; tant qu'elle l'est, les téléphones ne voient pas ce canal.
Retour arrière : README, « Revenir à une version d'avant ».
Codes : 0 fait, 1 refusé (règle ou GitHub), 2 non abouti (réseau)."""
import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

TAGS = {"stable": "telephonie-android", "essai": "telephonie-android-essai"}
NOMS = {"stable": "Téléphonie CRM (dernière version)", "essai": "Téléphonie CRM (versions d'essai)"}
FORMAT, MIN_SDK, GARDEES = 1, 31, 8
CODE_MAX = 2_100_000_000
PROVISOIRE = "nouveau-"
LIEN = "telephonie-crm.apk"


class Refus(Exception):
    """Une règle l'interdit, ou GitHub refuse : code 1."""


class NonAbouti(Exception):
    """Réseau : ni vrai ni faux, code 2."""


# ---------------------------------------------------------------- règles, sans réseau (tests)

def nom_apk(code):
    return f"telephonie-crm-{code}.apk"


def nom_fiche(code):
    return f"telephonie-crm-{code}.json"


def nom_archive(code):
    return f"telephonie-twenty-app-{code}.tgz"


def sha256(octets):
    return hashlib.sha256(octets).hexdigest()


def faire_fiche(code, version, commit, apk, archive):
    if not 0 < code <= CODE_MAX:
        raise Refus(f"versionCode {code} hors limites")
    if not version.strip() or len(commit) < 10 or not apk:
        raise Refus("version, commit ou APK absent")
    return {"versionCode": code, "versionName": version, "commit": commit, "sha256": sha256(apk), "taille": len(apk),
            "minSdk": MIN_SDK, "archiveSha256": sha256(archive)}


def faire_manifeste(depot, canal, fiche, pourcentage, minimale, suspendu=False, raison=""):
    """Le contrat de contrat/MiseAJour.kt : tout champ est obligatoire, l'app refuse le reste."""
    code = fiche["versionCode"]
    if not 0 <= pourcentage <= 100:
        raise Refus(f"pourcentage {pourcentage}")
    if not 0 <= minimale <= code:
        raise Refus(f"version minimale {minimale} au-dessus de la version publiée {code}")
    return {"format": FORMAT, "canal": canal, "suspendu": bool(suspendu), "raison": raison[:200], "versionCode": code,
            "versionName": fiche["versionName"], "taille": fiche["taille"], "sha256": fiche["sha256"],
            "url": f"https://github.com/{depot}/releases/download/{TAGS[canal]}/{nom_apk(code)}",
            "versionMinimale": minimale, "pourcentage": pourcentage, "minSdk": fiche["minSdk"]}


def verifier_avance(code, manifestes):
    """Une version ne se publie que si elle dépasse tout ce que les canaux donnés portent déjà."""
    for canal, m in manifestes.items():
        if m and code <= m["versionCode"]:
            raise Refus(f"versionCode {code} pas au-dessus du canal {canal} ({m['versionCode']})")


def verifier_promotion(code, fiche, apk, archive, stable):
    """Mêmes octets que l'essai, version plus haute, canal non suspendu."""
    if fiche is None:
        raise Refus(f"version {code} jamais publiée en essai")
    if fiche["versionCode"] != code:
        raise Refus(f"fiche de la version {fiche['versionCode']}, pas {code}")
    if apk is None or len(apk) != fiche["taille"] or sha256(apk) != fiche["sha256"]:
        raise Refus(f"l'APK {code} du canal d'essai n'est pas celui de sa fiche")
    if archive is None or sha256(archive) != fiche["archiveSha256"]:
        raise Refus(f"l'archive {code} du canal d'essai n'est pas celle de sa fiche")
    if stable and stable["suspendu"]:
        raise Refus("canal stable suspendu : `reprendre` d'abord, en connaissance de cause")
    verifier_avance(code, {"stable": stable})


def a_retirer(noms, code_manifeste, gardees=GARDEES):
    """Les anciens fichiers versionnés d'une release, sauf les `gardees` plus récents et celui du manifeste."""
    codes = sorted({int(n[len("telephonie-crm-"):-len(".apk")]) for n in noms
                    if n.startswith("telephonie-crm-") and n.endswith(".apk") and n[len("telephonie-crm-"):-len(".apk")].isdigit()}, reverse=True)
    vieux = [c for c in codes[gardees:] if c != code_manifeste]
    return [n for c in vieux for n in (nom_apk(c), nom_fiche(c), nom_archive(c)) if n in noms]


def notes(canal, fiche, depot):
    # La page veridian.site/telephonie lit « Téléphonie CRM <version> (commit … » : ne pas changer cette forme.
    return (f"Téléphonie CRM {fiche['versionName']} (commit {fiche['commit'][:10]}).\n\nSHA-256 de l'APK : `{fiche['sha256']}`\n\n" +
            ("Versions d'essai, une par construction de staging : pour nos téléphones, pas pour les clients.\n" if canal == "essai" else
             "Installation : LISEZMOI.md dans l'archive telephonie-twenty-app.tgz de cette release\n"
             "telephonie-twenty-app.tgz : l'app Twenty (objets Appels et SMS, rôle Téléphone), à installer dans votre Twenty."))


# ---------------------------------------------------------------- GitHub

class _SansRedirection(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **b):
        return None


class GitHub:
    def __init__(self, depot, jeton, a_blanc=False):
        self.api, self.jeton, self.a_blanc = f"https://api.github.com/repos/{depot}", jeton, a_blanc
        self.ouvrir = urllib.request.build_opener(_SansRedirection).open

    def _appel(self, methode, url, corps=None, type_contenu="application/json", accepte="application/vnd.github+json"):
        if methode != "GET" and self.a_blanc:
            print(f"  à blanc : {methode} {url.split('?')[0].split('/repos/')[-1]} {urllib.parse.unquote(url.split('name=')[-1]) if 'name=' in url else ''}")
            return {"id": 0, "upload_url": "https://uploads.github.com/a-blanc{?name}", "assets": [], "draft": True, "html_url": "(à blanc)"}
        donnees = corps if isinstance(corps, (bytes, type(None))) else json.dumps(corps).encode()
        entetes = {"Accept": accepte, "Content-Type": type_contenu, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "canaux.py"}
        if self.jeton:
            entetes["Authorization"] = f"Bearer {self.jeton}"
        try:
            with self.ouvrir(urllib.request.Request(url, donnees, method=methode, headers=entetes), timeout=300) as r:
                octets = r.read()
        except urllib.error.HTTPError as e:
            if methode == "GET" and e.code in (301, 302, 303, 307, 308):
                # Un fichier de release se lit ailleurs, par une adresse signée : sans notre jeton.
                try:
                    with self.ouvrir(urllib.request.Request(e.headers["Location"], headers={"User-Agent": "canaux.py"}), timeout=300) as r:
                        return r.read()
                except (urllib.error.URLError, TimeoutError, ConnectionError) as e2:
                    raise NonAbouti(str(e2)) from e2
            if methode == "GET" and e.code == 404:
                return None
            raise Refus(f"{methode} {url.split('?')[0]} : HTTP {e.code} {e.read().decode(errors='replace')[:300]}") from e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            raise NonAbouti(str(e)) from e
        if accepte != "application/vnd.github+json":
            return octets
        return json.loads(octets) if octets else None

    def release(self, canal):
        """La release d'un canal, brouillon compris (il n'a pas de tag tant qu'il n'est pas publié), ou None."""
        liste = self._appel("GET", f"{self.api}/releases?per_page=100") or []
        return next((x for x in liste if x["tag_name"] == TAGS[canal]), None) or \
            next((x for x in liste if x.get("draft") and x["name"] == NOMS[canal]), None)

    def creer(self, canal, corps, commit):
        return self._appel("POST", f"{self.api}/releases", {"tag_name": TAGS[canal], "target_commitish": commit, "name": NOMS[canal],
                           "body": corps, "prerelease": canal == "essai", "draft": True, "make_latest": "false"})

    def annoter(self, r, canal, corps, commit):
        self._appel("PATCH", f"{self.api}/releases/{r['id']}", {"name": NOMS[canal], "body": corps, "make_latest": "false"} if not r.get("draft")
                    else {"tag_name": TAGS[canal], "name": NOMS[canal], "body": corps, "target_commitish": commit})
        if not r.get("draft"):
            self._appel("PATCH", f"{self.api}/git/refs/tags/{TAGS[canal]}", {"sha": commit, "force": True})

    def lire(self, r, nom):
        a = next((x for x in (r or {}).get("assets", []) if x["name"] == nom), None)
        return None if a is None else self._appel("GET", f"{self.api}/releases/assets/{a['id']}", accepte="application/octet-stream")

    def retirer(self, r, noms):
        for a in r.get("assets", []):
            if a["name"] in noms:
                self._appel("DELETE", f"{self.api}/releases/assets/{a['id']}")

    def poser(self, r, fichiers):
        """Téléverse tout sous un nom provisoire, puis échange les noms : le lien public ne manque que le temps d'un DELETE
        suivi d'un PATCH (vu le 12/11 : DELETE puis téléversement de 13 Mo laissait un trou)."""
        anciens = {a["name"]: a["id"] for a in r.get("assets", [])}
        for nom, ident in anciens.items():
            if nom.startswith(PROVISOIRE) and nom[len(PROVISOIRE):] in fichiers:
                self._appel("DELETE", f"{self.api}/releases/assets/{ident}")
        base, nouveaux = r["upload_url"].split("{")[0], {}
        for nom, octets in fichiers.items():
            type_contenu = ("application/vnd.android.package-archive" if nom.endswith(".apk") else
                            "application/gzip" if nom.endswith(".tgz") else "application/json" if nom.endswith(".json") else "text/plain")
            nouveaux[nom] = self._appel("POST", f"{base}?name={urllib.parse.quote(PROVISOIRE + nom)}", octets, type_contenu)["id"]
        for nom, ident in nouveaux.items():
            if nom in anciens:
                self._appel("DELETE", f"{self.api}/releases/assets/{anciens[nom]}")
            self._appel("PATCH", f"{self.api}/releases/assets/{ident}", {"name": nom})


# ---------------------------------------------------------------- commandes

class Canaux:
    def __init__(self, depot, gh):
        self.depot, self.gh = depot, gh

    def manifeste(self, r):
        octets = self.gh.lire(r, "manifeste.json")
        return None if octets is None else json.loads(octets)

    def _fiche(self, r, code):
        octets = self.gh.lire(r, nom_fiche(code))
        return None if octets is None else json.loads(octets)

    @staticmethod
    def _json(x):
        return (json.dumps(x, ensure_ascii=False, indent=1) + "\n").encode()

    def essai(self, code, version, commit, apk, archive):
        fiche = faire_fiche(code, version, commit, apk, archive)
        r, stable = self.gh.release("essai"), self.gh.release("stable")
        avant = self.manifeste(r)
        verifier_avance(code, {"essai": avant, "stable": self.manifeste(stable)})
        corps = notes("essai", fiche, self.depot)
        if r is None:
            r = self.gh.creer("essai", corps, commit)
        self.gh.poser(r, {nom_apk(code): apk, nom_archive(code): archive, nom_fiche(code): self._json(fiche)})
        # Une construction ne lève jamais une suspension, même posée pendant le téléversement : seul `reprendre` le fait.
        avant = self.manifeste(self.gh.release("essai")) or avant
        m = faire_manifeste(self.depot, "essai", fiche, 100, (avant or {}).get("versionMinimale", 0),
                            (avant or {}).get("suspendu", False), (avant or {}).get("raison", ""))
        self.gh.poser(r, {"manifeste.json": self._json(m)})
        self.gh.annoter(r, "essai", corps, commit)
        self.gh.retirer(r, a_retirer([a["name"] for a in r.get("assets", [])], code))
        return m

    def promouvoir(self, code, pourcentage):
        essai, r = self.gh.release("essai"), self.gh.release("stable")
        if r is None:
            raise Refus("release stable introuvable")
        avant = self.manifeste(r)
        fiche, apk, archive = self._fiche(essai, code), self.gh.lire(essai, nom_apk(code)), self.gh.lire(essai, nom_archive(code))
        verifier_promotion(code, fiche, apk, archive, avant)
        m = faire_manifeste(self.depot, "stable", fiche, pourcentage, (avant or {}).get("versionMinimale", 0))
        self.gh.poser(r, {nom_apk(code): apk, nom_archive(code): archive, nom_fiche(code): self._json(fiche)})
        if pourcentage == 100:
            self._lien(r, fiche, apk, archive)
        self.gh.poser(r, {"manifeste.json": self._json(m)})
        self._relire("stable", m)
        self.gh.retirer(r, a_retirer([a["name"] for a in r.get("assets", [])], code))
        return m

    def _lien(self, r, fiche, apk, archive):
        """Le lien public (page de téléchargement) : seulement quand la version est ouverte à tous."""
        self.gh.poser(r, {LIEN: apk, LIEN + ".sha256": f"{fiche['sha256']}  {LIEN}\n".encode(), "telephonie-twenty-app.tgz": archive})
        self.gh.annoter(r, "stable", notes("stable", fiche, self.depot), fiche["commit"])

    def _relire(self, canal, attendu):
        if self.gh.a_blanc:
            return
        r = self.gh.release(canal)
        apk = self.gh.lire(r, nom_apk(attendu["versionCode"]))
        if self.manifeste(r) != attendu or apk is None or sha256(apk) != attendu["sha256"]:
            raise Refus("relecture : ce qui est publié n'est pas ce qui était attendu")

    def _changer(self, canal, **champs):
        r = self.gh.release(canal)
        m = self.manifeste(r)
        if m is None:
            raise Refus(f"canal {canal} sans manifeste")
        fiche = self._fiche(r, m["versionCode"])
        if fiche is None:
            raise Refus(f"canal {canal} : fiche {m['versionCode']} absente")
        v = {"pourcentage": m["pourcentage"], "minimale": m["versionMinimale"], "suspendu": m["suspendu"], "raison": m["raison"], **champs}
        neuf = faire_manifeste(self.depot, canal, fiche, v["pourcentage"], v["minimale"], v["suspendu"], v["raison"])
        if canal == "stable" and v["pourcentage"] == 100 and m["pourcentage"] < 100:
            apk, archive = self.gh.lire(r, nom_apk(m["versionCode"])), self.gh.lire(r, nom_archive(m["versionCode"]))
            if apk is None or sha256(apk) != fiche["sha256"] or archive is None or sha256(archive) != fiche["archiveSha256"]:
                raise Refus("l'APK ou l'archive du canal stable n'est pas celui de sa fiche")
            self._lien(r, fiche, apk, archive)
        self.gh.poser(r, {"manifeste.json": self._json(neuf)})
        return neuf

    def pourcentage(self, canal, n):
        return self._changer(canal, pourcentage=n)

    def suspendre(self, canal, raison):
        if not raison.strip():
            raise Refus("une raison est attendue : elle s'affiche sur les téléphones")
        return self._changer(canal, suspendu=True, raison=raison)

    def reprendre(self, canal):
        return self._changer(canal, suspendu=False, raison="")

    def minimale(self, canal, code):
        return self._changer(canal, minimale=code)

    def etat(self):
        for canal in TAGS:
            r = self.gh.release(canal)
            m = self.manifeste(r)
            apks = sorted(a["name"] for a in (r or {}).get("assets", []) if a["name"].endswith(".apk"))
            print(f"{canal} : " + ("pas de release" if r is None else f"{'BROUILLON (invisible des téléphones)' if r.get('draft') else 'publié'}, "
                  f"{json.dumps(m, ensure_ascii=False) if m else 'sans manifeste (aucune mise à jour proposée)'}, {len(apks)} APK"))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("commande", choices=["essai", "promouvoir", "pourcentage", "suspendre", "reprendre", "minimale", "etat"])
    p.add_argument("depot")
    p.add_argument("fichiers", nargs="*")
    p.add_argument("--canal", choices=list(TAGS), default="stable")
    p.add_argument("--code", type=int)
    p.add_argument("--version", default="")
    p.add_argument("--commit", default="")
    p.add_argument("--pourcentage", type=int, default=10)
    p.add_argument("--raison", default="")
    p.add_argument("--a-blanc", action="store_true")
    a = p.parse_intermixed_args(argv)
    c = Canaux(a.depot, GitHub(a.depot, os.environ.get("GH_TOKEN"), a.a_blanc))
    try:
        if a.commande in ("essai", "promouvoir", "minimale") and not a.code and a.code != 0:
            raise Refus("--code attendu")
        if a.commande == "etat":
            c.etat()
            return 0
        if a.commande == "essai":
            apk, archive = (open(f, "rb").read() for f in a.fichiers)
            m = c.essai(a.code, a.version, a.commit, apk, archive)
        else:
            m = {"promouvoir": lambda: c.promouvoir(a.code, a.pourcentage), "pourcentage": lambda: c.pourcentage(a.canal, a.pourcentage),
                 "suspendre": lambda: c.suspendre(a.canal, a.raison), "reprendre": lambda: c.reprendre(a.canal),
                 "minimale": lambda: c.minimale(a.canal, a.code)}[a.commande]()
        print(json.dumps(m, ensure_ascii=False))
        return 0
    except Refus as e:
        print(f"REFUSÉ : {e}", file=sys.stderr)
        return 1
    except NonAbouti as e:
        print(f"NON ABOUTI : {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
