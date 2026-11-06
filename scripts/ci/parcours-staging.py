#!/usr/bin/env python3
"""Parcours réel du staging : limite levée, rebond Hub signé, objet créé dans un navigateur.

1. vérifie qu'on ne peut ni s'inscrire ni se connecter sans le Hub ;
2. provisionne N workspaces (au-delà de l'ancienne limite de 5) ;
3. contrôle les refus du contrat et l'identité par hub_user_id ;
4. suit un lien signé HMAC dans un navigateur, crée une personne, la relit après rechargement ;
5. liste les hôtes contactés par le navigateur.

Usage : HUB_API_SECRET=... parcours-staging.py <url> <dossier-sortie> [nb-workspaces]
Sortie : 0 parcours réussi · 1 échec · 2 mesure non aboutie
"""
import hashlib, hmac, json, os, re, sys, time, urllib.error, urllib.request, uuid
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE, OUT = sys.argv[1], sys.argv[2]
NB = int(sys.argv[3]) if len(sys.argv) > 3 else 7
SECRET = os.environ.get("HUB_API_SECRET", "")
DOMAINE = urlparse(BASE).hostname
EMAIL = f"parcours+{int(time.time())}@veridian.site"
MDP = "Parcours-Staging-2026!x"
echecs = []


def controle(nom, ok, detail=""):
    print(("OK    " if ok else "ECHEC ") + nom + (f" : {detail}" if detail else ""), flush=True)
    if not ok:
        echecs.append(nom)


def http(url, corps=None, entetes=None):
    req = urllib.request.Request(url, data=corps, headers=entetes or {}, method="POST" if corps is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def gql(requete, variables, jeton=None, origine=None):
    entetes = {"Content-Type": "application/json", "Origin": origine or BASE}
    if jeton:
        entetes["Authorization"] = f"Bearer {jeton}"
    code, texte = http(BASE + "/metadata", json.dumps({"query": requete, "variables": variables}).encode(), entetes)
    donnees = json.loads(texte)
    if donnees.get("errors"):
        raise RuntimeError(json.dumps(donnees["errors"])[:400])
    return donnees["data"]


def signe(chemin, charge, signer=True):
    corps = json.dumps(charge).encode()
    t = str(int(time.time() * 1000))
    entetes = {"Content-Type": "application/json", "X-Veridian-Timestamp": t}
    if signer:
        entetes["X-Veridian-Hub-Signature"] = hmac.new(SECRET.encode(), f"{t}.".encode() + corps, hashlib.sha256).hexdigest()
    return http(BASE + chemin, corps, entetes)


def rebond(hub_id, email, signer=True):
    return signe("/api/sso/issue-magic-link", {"hub_user_id": hub_id, "email": email}, signer)


def refus(requete, variables):
    try:
        gql(requete, variables)
        return False
    except RuntimeError as e:
        return "Identity is managed" in str(e) or "FORBIDDEN" in str(e)


if not SECRET:
    print("NON ABOUTI : HUB_API_SECRET absent")
    sys.exit(2)

HUB_ID = str(uuid.uuid4())

# ── 1. identité fermée : le Hub seul
controle("inscription directe refusée", refus("mutation($e:String!,$p:String!){signUp(email:$e,password:$p){tokens{accessOrWorkspaceAgnosticToken{token}}}}", {"e": EMAIL, "p": MDP}))
controle("connexion par mot de passe refusée", refus("mutation($e:String!,$p:String!){getLoginTokenFromCredentials(email:$e,password:$p,origin:\"x\"){loginToken{token}}}", {"e": EMAIL, "p": MDP}))
code, _ = signe("/api/tenants/provision", {"tenant_id": str(uuid.uuid4())}, signer=False)
controle("provisioning sans signature : 401", code == 401, str(code))

# ── 2. workspaces provisionnés par le Hub
locataires = []
for i in range(1, NB + 1):
    debut = time.time()
    locataire = str(uuid.uuid4())
    code, texte = signe("/api/tenants/provision", {"tenant_id": locataire, "owner_email": EMAIL, "workspace_name": f"Parcours {i}", "plan": "free", "metadata": {"hub_user_id": HUB_ID}})
    if code != 200:
        controle(f"workspace {i}/{NB}", False, f"{code} {texte[:300]}")
        print("VERDICT : échec du provisioning")
        sys.exit(1)
    locataires.append((locataire, json.loads(texte)))
    print(f"workspace {i}/{NB} actif en {time.time() - debut:.0f}s : {locataires[-1][1]['workspace_id']}", flush=True)
controle(f"{NB} workspaces, au-delà de l'ancienne limite de 5", NB > 5)
code, texte = signe("/api/tenants/provision", {"tenant_id": locataires[0][0], "owner_email": EMAIL, "workspace_name": "Parcours 1", "plan": "free", "metadata": {"hub_user_id": HUB_ID}})
controle("provisioning idempotent", code == 200 and json.loads(texte)["created"] is False, f"{code}")
code, _ = signe("/api/tenants/provision", {"tenant_id": locataires[0][0], "owner_email": "autre@veridian.site", "workspace_name": "x", "plan": "free", "metadata": {"hub_user_id": str(uuid.uuid4())}})
controle("autre propriétaire : 409", code == 409, str(code))

# ── 3. refus du contrat
code, _ = rebond(HUB_ID, EMAIL, signer=False)
controle("rebond sans signature : 401", code == 401, str(code))
code, texte = rebond(str(uuid.uuid4()), f"inconnu+{int(time.time())}@veridian.site")
controle("inconnu : 400 user_not_in_app", code == 400 and "user_not_in_app" in texte, f"{code} {texte[:80]}")
code, texte = rebond(str(uuid.uuid4()), EMAIL)
controle("email connu lié à un autre hub_user_id : refusé", code == 400, f"{code} {texte[:80]}")
code, texte = rebond(HUB_ID, "email-change@veridian.site")
controle("hub_user_id prime sur l'email", code == 200, str(code))
code, texte = signe("/api/veridian/users/sync", {"hub_user_id": HUB_ID, "first_name": "Parcours", "last_name": "Hub"})
controle("nom poussé par le Hub", code == 200, f"{code} {texte[:80]}")

# ── 3. lien signé, navigateur
code, texte = rebond(HUB_ID, EMAIL)
lien = json.loads(texte).get("magic_link_url", "") if code == 200 else ""
controle("signature valide : 200 et lien /auth/token", code == 200 and "/auth/token?t=" in lien, f"{code} {lien[:60]}")
if not lien:
    print("NON ABOUTI : aucun lien")
    sys.exit(2)

hotes = {}


def note(req):
    h = urlparse(req.url).hostname or ""
    hotes[h] = hotes.get(h, 0) + 1


with sync_playwright() as p:
    nav = p.chromium.launch(headless=True)
    ctx = nav.new_context(viewport={"width": 1400, "height": 900})
    ctx.on("request", note)
    page = ctx.new_page()
    page.set_default_navigation_timeout(180000)
    page.goto(lien, wait_until="domcontentloaded")
    page.wait_for_timeout(15000)
    page.screenshot(path=f"{OUT}/1-apres-rebond.png")
    corps = page.inner_text("body")
    connecte = "Settings" in corps and "/welcome" not in page.url
    controle("le lien connecte l'utilisateur", connecte, f"{page.url[:70]} | {corps[:90]!r}")

    autre = nav.new_context(viewport={"width": 1400, "height": 900})
    autre.on("request", note)
    page2 = autre.new_page()
    page2.set_default_navigation_timeout(180000)
    page2.goto(lien, wait_until="domcontentloaded")
    page2.wait_for_timeout(12000)
    corps2 = page2.inner_text("body")
    controle("le lien ne sert qu'une fois", "Settings" not in corps2, page2.url[:90])
    autre.close()

    racine = f"{urlparse(page.url).scheme}://{urlparse(page.url).hostname}"
    for i in range(8):
        texte_page = page.inner_text("body")
        if "Create profile" in texte_page:
            champs = page.locator("input:visible")
            champs.nth(0).fill("Parcours")
            champs.nth(1).fill("Staging")
            page.wait_for_timeout(500)
        cliques = False
        for motif in ["^Continue$", "^Skip", "Continue without", "^Finish", "Get started"]:
            b = page.get_by_role("button", name=re.compile(motif, re.I)).first
            if b.count() and b.is_visible() and b.is_enabled():
                b.click()
                cliques = True
                break
        page.wait_for_timeout(6000)
        if not cliques or "/objects" in page.url:
            break

    for chemin in ["/objects/companies", "/objects/opportunities", "/settings/applications", "/settings/ai", "/objects/dashboards"]:
        page.goto(racine + chemin, wait_until="domcontentloaded")
        page.wait_for_timeout(6000)
    ligne = page.get_by_text(re.compile("My First Dashboard", re.I)).first
    if ligne.count():
        ligne.click(timeout=10000)
        page.wait_for_timeout(10000)
    tiers = [f.url for f in page.frames if urlparse(f.url).hostname and DOMAINE not in f.url]
    controle("tableau de bord sans iframe tiers", not tiers, str(tiers)[:100])

    page.goto(racine + "/objects/people", wait_until="domcontentloaded")
    page.wait_for_timeout(8000)
    page.get_by_role("button", name=re.compile("^Create$", re.I)).first.click(timeout=15000)
    page.wait_for_timeout(3000)
    page.keyboard.type("Parcours Navigateur")
    page.keyboard.press("Enter")
    page.wait_for_timeout(4000)
    page.goto(racine + "/objects/people", wait_until="domcontentloaded")
    page.wait_for_timeout(9000)
    page.screenshot(path=f"{OUT}/2-personnes.png")
    controle("personne créée et relue après rechargement", page.get_by_text("Parcours Navigateur").count() > 0)
    nav.close()

externes = {h: n for h, n in hotes.items() if h and DOMAINE not in h}
print("HOTES NAVIGATEUR", json.dumps(hotes))
controle("navigateur : aucun hôte tiers", not externes, str(externes))
print(f"EMAIL {EMAIL}")
print(f"VERDICT : {'ÉCHEC ' + str(echecs) if echecs else 'parcours réussi'}")
sys.exit(1 if echecs else 0)
