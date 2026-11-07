#!/usr/bin/env python3
"""Mesure de capacité : un espace jetable, N sociétés, latence d'un mélange lecture et écriture par palier.

L'espace et son compte sont retirés à la fin. Le chiffre vaut pour la machine qui sert, à sa charge du moment.

Usage : HUB_API_SECRET=... charge-staging.py <url> [nb-societes] [secondes-par-palier]
Sortie : 0 mesure rendue · 1 erreurs au-delà de 1 % à un palier · 2 mesure non aboutie
"""
import atexit, hashlib, hmac, json, os, signal, statistics, sys, threading, time, urllib.error, urllib.request, uuid
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE = sys.argv[1]
NB = int(sys.argv[2]) if len(sys.argv) > 2 else 5000
DUREE = int(sys.argv[3]) if len(sys.argv) > 3 else 30
SECRET = os.environ.get("HUB_API_SECRET", "")
if not SECRET:
    print("NON ABOUTI : HUB_API_SECRET absent")
    sys.exit(2)
LOCATAIRE, HUB_ID = str(uuid.uuid4()), str(uuid.uuid4())
EMAIL = f"charge+{int(time.time())}@veridian.site"
provisionne = False


def appel(url, corps=None, entetes=None, methode=None):
    req = urllib.request.Request(url, data=corps, headers=entetes or {}, method=methode or ("POST" if corps is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def signe(chemin, charge=None, methode=None):
    corps = json.dumps(charge).encode() if charge is not None else b""
    t = str(int(time.time() * 1000))
    entetes = {"Content-Type": "application/json", "X-Veridian-Timestamp": t,
               "X-Veridian-Hub-Signature": hmac.new(SECRET.encode(), f"{t}.".encode() + corps, hashlib.sha256).hexdigest()}
    return appel(BASE + chemin, corps if charge is not None else None, entetes, methode)


def nettoyer():
    if provisionne:
        print("espace retiré", signe(f"/api/tenants/{LOCATAIRE}", methode="DELETE")[0], flush=True)
    signe("/api/hub/users/sync", {"hub_user_id": HUB_ID, "deleted": True})


atexit.register(nettoyer)
signal.signal(signal.SIGTERM, lambda *_: sys.exit(2))

debut = time.time()
code, texte = signe("/api/tenants/provision", {"tenant_id": LOCATAIRE, "owner_email": EMAIL, "workspace_name": "Charge", "plan": "free", "metadata": {"hub_user_id": HUB_ID}})
if code != 200:
    print(f"NON ABOUTI : provisioning {code} {texte[:200]}")
    sys.exit(2)
provisionne = True
print(f"provisioning : {time.time() - debut:.0f} s", flush=True)
code, texte = signe("/api/sso/issue-magic-link", {"hub_user_id": HUB_ID, "email": EMAIL})
if code != 200:
    print(f"NON ABOUTI : lien {code} {texte[:200]}")
    sys.exit(2)

# La session se lit dans un vrai navigateur : c'est elle que les paliers rejouent.
capture = {}
with sync_playwright() as p:
    navigateur = p.chromium.launch()
    contexte = navigateur.new_context()
    page = contexte.new_page()
    page.on("request", lambda r: capture.update(url=r.url, entetes=r.all_headers()) if urlparse(r.url).path == "/graphql" and "authorization" not in capture else None)
    page.goto(json.loads(texte)["magic_link_url"], wait_until="domcontentloaded")
    limite = time.time() + 120
    while "url" not in capture and time.time() < limite:
        page.wait_for_timeout(1000)
    if "url" not in capture:
        print("NON ABOUTI : aucune requête /graphql vue après connexion")
        sys.exit(2)
    biscuits = "; ".join(f"{b['name']}={b['value']}" for b in contexte.cookies(capture["url"]))
    navigateur.close()

entetes = {k: v for k, v in capture["entetes"].items() if not k.startswith(":") and k not in ("content-length", "host", "cookie", "accept-encoding")}
entetes["Cookie"] = biscuits
entetes["Content-Type"] = "application/json"


def gql(requete, variables=None):
    code, texte = appel(capture["url"], json.dumps({"query": requete, "variables": variables or {}}).encode(), entetes)
    donnees = json.loads(texte) if texte[:1] == "{" else {}
    if code != 200 or donnees.get("errors") or "data" not in donnees:
        raise RuntimeError(f"{code} {texte[:200]}")
    return donnees["data"]


# Témoin : si la session rejouée ne marche pas, aucun chiffre ne vaut.
gql("{companies(first:1){edges{node{id}}}}")

debut, fait = time.time(), 0
while fait < NB:
    lot = [{"name": f"Societe {fait + i}", "domainName": {"primaryLinkUrl": f"societe{fait + i}.example.org"}} for i in range(min(60, NB - fait))]
    gql("mutation($d:[CompanyCreateInput!]){createCompanies(data:$d){id}}", {"d": lot})
    fait += len(lot)
ecoule = time.time() - debut
print(f"insertion : {NB} sociétés en {ecoule:.0f} s, {NB / ecoule:.0f}/s", flush=True)
total = gql("{companies{totalCount}}")["companies"]["totalCount"]
if total < NB:
    print(f"NON ABOUTI : {total} sociétés lues pour {NB} insérées")
    sys.exit(2)
print(f"relu : {total} sociétés", flush=True)

OPERATIONS = [
    ("liste", 6, lambda _: gql("{companies(first:60,orderBy:[{createdAt:DescNullsLast}]){edges{node{id name domainName{primaryLinkUrl}}}}}")),
    ("filtre", 3, lambda i: gql('query($n:String){companies(first:60,filter:{name:{ilike:$n}}){edges{node{id name}}}}', {"n": f"%{i % 900}%"})),
    ("creation", 1, lambda i: gql("mutation($d:PersonCreateInput!){createPerson(data:$d){id}}", {"d": {"name": {"firstName": "Charge", "lastName": str(i)}}})),
]
TIRAGE = [o for o in OPERATIONS for _ in range(o[1])]


def palier(utilisateurs):
    fin = time.time() + DUREE
    mesures, erreurs, verrou = [], [], threading.Lock()

    def travailleur(rang):
        i = rang * 100000
        while time.time() < fin:
            nom, _, operation = TIRAGE[i % len(TIRAGE)]
            t0 = time.time()
            try:
                operation(i)
                with verrou:
                    mesures.append((nom, time.time() - t0))
            except Exception as e:
                with verrou:
                    erreurs.append(str(e)[:160])
            i += 1

    with ThreadPoolExecutor(utilisateurs) as ex:
        list(ex.map(travailleur, range(utilisateurs)))
    return mesures, erreurs


def centile(valeurs, q):
    return sorted(valeurs)[min(len(valeurs) - 1, int(len(valeurs) * q))] * 1000


verdict = 0
for utilisateurs in (1, 5, 20, 50):
    mesures, erreurs = palier(utilisateurs)
    if not mesures:
        print(f"{utilisateurs} utilisateurs : aucune réponse, {erreurs[:1]}")
        verdict = 1
        continue
    d = [m[1] for m in mesures]
    taux = len(erreurs) / (len(d) + len(erreurs))
    detail = " ".join(f"{n}={centile([m[1] for m in mesures if m[0] == n], 0.95):.0f}" for n, _, _ in OPERATIONS if any(m[0] == n for m in mesures))
    print(f"{utilisateurs:>3} utilisateurs : {len(d) / DUREE:5.1f} req/s, p50 {statistics.median(d) * 1000:5.0f} ms, p95 {centile(d, 0.95):5.0f} ms, p99 {centile(d, 0.99):5.0f} ms, erreurs {taux:.1%} (p95 ms : {detail})", flush=True)
    if erreurs:
        print("  première erreur :", erreurs[0], flush=True)
    if taux > 0.01:
        verdict = 1
sys.exit(verdict)
