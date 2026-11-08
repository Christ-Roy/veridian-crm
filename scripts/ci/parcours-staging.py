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
import atexit, hashlib, hmac, json, os, re, signal, sys, time, urllib.error, urllib.parse, urllib.request, uuid
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
# Compte de test retiré quoi qu'il arrive, sinon il pollue la dérive du Hub.
locataires = []


def nettoyer():
    for locataire, _ in locataires:
        t = str(int(time.time() * 1000))
        s = hmac.new(SECRET.encode(), f"{t}.".encode(), hashlib.sha256).hexdigest()
        req = urllib.request.Request(f"{BASE}/api/tenants/{locataire}", headers={"X-Veridian-Timestamp": t, "X-Veridian-Hub-Signature": s}, method="DELETE")
        try:
            with urllib.request.urlopen(req, timeout=240) as r:
                print("espace retiré", locataire, r.status, flush=True)
        except urllib.error.HTTPError as e:
            print("ECHEC retrait espace", locataire, e.code, flush=True)
    signe("/api/hub/users/sync", {"hub_user_id": HUB_ID, "deleted": True})


atexit.register(nettoyer)
signal.signal(signal.SIGTERM, lambda *_: sys.exit(2))

# ── 1. identité fermée : le Hub seul
controle("inscription directe refusée", refus("mutation($e:String!,$p:String!){signUp(email:$e,password:$p){tokens{accessOrWorkspaceAgnosticToken{token}}}}", {"e": EMAIL, "p": MDP}))
controle("connexion par mot de passe refusée", refus("mutation($e:String!,$p:String!){getLoginTokenFromCredentials(email:$e,password:$p,origin:\"x\"){loginToken{token}}}", {"e": EMAIL, "p": MDP}))
code, _ = signe("/api/tenants/provision", {"tenant_id": str(uuid.uuid4())}, signer=False)
controle("provisioning sans signature : 401", code == 401, str(code))

# ── 2. workspaces provisionnés par le Hub
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
if NB > 5:
    controle(f"{NB} workspaces d'un coup, au-delà de l'ancienne limite de 5", True)
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
code, texte = signe("/api/hub/users/sync", {"hub_user_id": HUB_ID, "name": "Parcours Hub"})
controle("nom poussé par le Hub", code == 200, f"{code} {texte[:80]}")
code, texte = signe("/api/hub/users/sync", {"hub_user_id": str(uuid.uuid4()), "name": "Personne"})
controle("sync inconnu : 404 user_not_in_app", code == 404 and "user_not_in_app" in texte, f"{code} {texte[:80]}")


def lecture(chemin, charge_signee):
    t = str(int(time.time() * 1000))
    signature = hmac.new(SECRET.encode(), f"{t}.{charge_signee}".encode(), hashlib.sha256).hexdigest()
    return http(BASE + chemin, None, {"X-Veridian-Timestamp": t, "X-Veridian-Hub-Signature": signature})


code, _ = http(BASE + "/api/hub/users")
controle("GET /api/hub/users sans signature : 401", code == 401, str(code))
code, texte = lecture("/api/hub/users", "")
vu = next((u for u in json.loads(texte).get("users", []) if u["hub_user_id"] == HUB_ID), None) if code == 200 else None
controle("GET /api/hub/users liste le compte", bool(vu) and vu["name"] == "Parcours Hub", f"{code} {vu}")
requete = "/api/users/by-email?email=" + urllib.parse.quote(EMAIL, safe="")
code, texte = lecture(requete, "")
controle("GET /api/users/by-email", code == 200 and json.loads(texte).get("found") is True and len(json.loads(texte)["workspaces"]) == NB, f"{code} {texte[:120]}")

# ── 2bis. plan posé par le Hub (CONTRAT-BILLING v2 §3) : stocké, relu, rien de limité
t0 = locataires[0][0]
def plan_hub(plan, source="stripe", cle=None, **extra):
    corps = {"contract_version": "2.0", "tenant_id": t0, "plan": plan, "plan_source": source,
             "effective_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "stripe_subscription_id": None,
             "idempotency_key": cle or str(uuid.uuid4()), "reason": "parcours"}
    corps.update(extra)
    return signe("/api/tenants/update-plan", corps)
def plan_lu():
    c, t = lecture(requete, "")
    w = [x for x in json.loads(t).get("workspaces", []) if x.get("tenant_id") == t0] if c == 200 else []
    return (w[0].get("plan"), w[0].get("plan_source")) if w else (None, None)
code, _ = signe("/api/tenants/update-plan", {"tenant_id": t0}, signer=False)
controle("update-plan sans signature : 401", code == 401, str(code))
cle = str(uuid.uuid4())
code, texte = plan_hub("pro", cle=cle)
controle("update-plan pro : 200 et previous_plan", code == 200 and json.loads(texte).get("previous_plan") == "free", f"{code} {texte[:140]}")
controle("plan relu par le Hub : pro", plan_lu() == ("pro", "stripe"), str(plan_lu()))
code2, texte2 = plan_hub("pro", cle=cle)
controle("rejeu de la même clé : même réponse", code2 == 200 and json.loads(texte2) == json.loads(texte), f"{code2} {texte2[:80]}")
controle("plan hors enum : 400 invalid_plan", plan_hub("freemium")[0] == 400)
controle("version majeure inconnue : 400", plan_hub("pro", contract_version="3.0")[0] == 400)
controle("tenant inconnu : 404", signe("/api/tenants/update-plan", {"contract_version": "2.0", "tenant_id": str(uuid.uuid4()), "plan": "pro", "plan_source": "stripe", "effective_at": "2026-11-08T00:00:00Z", "idempotency_key": str(uuid.uuid4())})[0] == 404)
code, _ = plan_hub("business", "grant_manual")
code2, texte2 = plan_hub("free", "downgrade_auto")
controle("plan offert immunisé : 409 plan_source_immutable", code == 200 and code2 == 409 and "plan_source_immutable" in texte2, f"{code} {code2}")
controle("plan offert conservé", plan_lu() == ("business", "grant_manual"), str(plan_lu()))
controle("retour free par grant_manual", plan_hub("free", "grant_manual")[0] == 200 and plan_lu()[0] == "free", str(plan_lu()))

# ── 3. lien signé, navigateur
cible = BASE + "/objects/people"
code, texte = signe("/api/sso/issue-magic-link", {"hub_user_id": HUB_ID, "email": EMAIL, "next": "https://evil.example/x"})
controle("next hors origine ignoré", code == 200 and "evil" not in texte and "next=" not in texte, texte[:100])
code, texte = signe("/api/sso/issue-magic-link", {"hub_user_id": HUB_ID, "email": EMAIL, "next": cible})
controle("next sur l'origine conservé", code == 200 and "next=%2Fobjects%2Fpeople" in texte, texte[-60:])
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
    graphql = []
    ctx.on("request", lambda q: graphql.append(q.headers) if q.url.endswith("/graphql") and q.method == "POST" else None)
    page = ctx.new_page()
    page.set_default_navigation_timeout(180000)
    page.goto(lien, wait_until="domcontentloaded")
    page.wait_for_timeout(15000)
    page.screenshot(path=f"{OUT}/1-apres-rebond.png")
    corps = page.inner_text("body")
    # Sur le domaine de l'app : une page de connexion du Hub n'est pas une arrivée (faux OK du 08/11/2026 en prod).
    hote_final = urlparse(page.url).hostname or ""
    connecte = (hote_final == DOMAINE or hote_final.endswith("." + DOMAINE)) and "/welcome" not in page.url and "/verify" not in page.url and "Continue with" not in corps
    controle("le lien connecte l'utilisateur", connecte, f"{page.url[:70]} | {corps[:90]!r}")

    autre = nav.new_context(viewport={"width": 1400, "height": 900})
    autre.on("request", note)
    page2 = autre.new_page()
    page2.set_default_navigation_timeout(180000)
    page2.goto(lien, wait_until="domcontentloaded")
    page2.wait_for_timeout(12000)
    corps2 = page2.inner_text("body")
    controle("le lien ne sert qu'une fois", "Settings" not in corps2, page2.url[:90])
    controle("sans session : renvoi vers le Hub", (urlparse(page2.url).hostname.startswith("hub.") or urlparse(page2.url).hostname == os.environ.get("HUB_HOTE", "app.veridian.site")), page2.url[:90])
    autre.close()

    racine = f"{urlparse(page.url).scheme}://{urlparse(page.url).netloc}"
    controle("aucune étape d'accueil à franchir", "/invite-team" not in page.url and "/create" not in page.url, page.url[:80])
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

    textes = {}
    for chemin in ["/objects/companies", "/objects/opportunities", "/settings/applications", "/settings/ai", "/objects/dashboards"]:
        page.goto(racine + chemin, wait_until="domcontentloaded")
        try:
            page.wait_for_function("document.body && document.body.innerText.length > 200", timeout=60000)
        except Exception:
            pass
        page.wait_for_timeout(3000)
        textes[chemin] = re.sub(r"\s+", " ", page.inner_text("body"))
    # Aucun fournisseur IA (VERIDIAN_AI_DISABLED) : ni chat ni écran de modèles, MCP seul reste.
    controle("navigation sans onglet IA", not re.search(r"Home AI Settings", textes["/objects/companies"]), textes["/objects/companies"][:60])
    ia = textes["/settings/ai"]
    controle("Paramètres > AI réduit à MCP", "MCP client configuration" in ia and not re.search(r"\bModels\b|\bSkills\b|\bUsage\b", ia), ia[ia.find("AI MCP"):][:80])
    controle("pas de carte ChatGPT du cloud Twenty", "ChatGPT" not in ia)
    # Menus morts retirés : e-mailing de Twenty (Notifuse fait foi), console de logs sans ClickHouse.
    controle("navigation sans Campaigns", "Campaigns" not in textes["/objects/companies"], textes["/objects/companies"][:120])
    controle("réglages sans interrupteur Logs", not re.search(r"\bLogs\b", textes["/settings/applications"]), textes["/settings/applications"][-80:])
    ligne = page.get_by_text(re.compile("My First Dashboard", re.I)).first
    if ligne.count():
        ligne.click(timeout=10000)
        page.wait_for_timeout(10000)
    h = {k: v for k, v in (graphql[-1] if graphql else {}).items() if not k.startswith(":") and k not in ("content-length", "host", "cookie")}
    essais = page.evaluate("""async (h) => {
      const f = async (c, q, v) => (await fetch(c, {method: 'POST', credentials: 'include', headers: h, body: JSON.stringify({query: q, variables: v})})).text();
      const m = await f('/graphql', '{workspaceMembers(first:1){edges{node{id}}}}', {});
      const id = JSON.parse(m).data.workspaceMembers.edges[0].node.id;
      return [
        await f('/graphql', 'mutation($i:UUID!){updateWorkspaceMember(id:$i,data:{name:{firstName:"Pirate"}}){id name{firstName}}}', {i: id}),
        await f('/metadata', 'mutation($i:UpdateWorkspaceMemberSettingsInput!){updateWorkspaceMemberSettings(input:$i)}', {i: {workspaceMemberId: id, update: {name: {firstName: 'Pirate2'}}}}),
        await f('/metadata', '{findManyAgents{id}}', {}),
        await f('/metadata', '{skills{id}}', {}),
      ];
    }""", h)
    controle("renommage par /graphql refusé", '"Pirate"' not in essais[0], essais[0][:120])
    controle("renommage par /metadata refusé", "Identity is managed" in essais[1], essais[1][:120])
    # IA coupée côté serveur, pas seulement masquée : un appel direct de l'Admin est refusé.
    for i, nom in ((2, "agents"), (3, "compétences")):
        controle(f"IA refusée par l'API ({nom})", '"errors"' in essais[i] and ("PERMISSION" in essais[i].upper() or "FORBIDDEN" in essais[i].upper()), essais[i][:140])
    tiers = [f.url for f in page.frames if urlparse(f.url).hostname and DOMAINE not in f.url]
    controle("tableau de bord sans iframe tiers", not tiers, str(tiers)[:100])

    # Ce qui appartient au Hub : refusé par le serveur, absent de l'interface. Chaque absence a un témoin présent à côté.
    reserve = page.evaluate("""async (h) => {
      const f = async (q) => (await fetch('/metadata', {method: 'POST', credentials: 'include', headers: h, body: JSON.stringify({query: q})})).text();
      return {
        deleteUser: await f('mutation{deleteUser{id}}'),
        deleteUserFromWorkspace: await f('mutation{deleteUserFromWorkspace(workspaceMemberIdToDelete:"00000000-0000-4000-8000-000000000000"){id}}'),
        deleteCurrentWorkspace: await f('mutation{deleteCurrentWorkspace{id}}'),
        lienInvitation: await f('mutation{updateWorkspace(data:{isPublicInviteLinkEnabled:true}){id}}'),
        motDePasse: await f('mutation{updateWorkspace(data:{isPasswordAuthEnabled:true}){id}}'),
        double: await f('mutation{updateWorkspace(data:{isTwoFactorAuthenticationEnforced:true}){id}}'),
        doubleOtp: await f('mutation{initiateOTPProvisioningForAuthenticatedUser{uri}}'),
        temoin: await f('{currentWorkspace{id isPasswordAuthEnabled isPublicInviteLinkEnabled editableProfileFields}}'),
      };
    }""", h)
    temoin = json.loads(reserve.pop("temoin"))["data"]["currentWorkspace"]
    for nom, reponse in reserve.items():
        controle(f"{nom} refusé par le serveur", "Identity is managed" in reponse, reponse[:120])
    controle("provisioning : mot de passe, lien d'invitation et identité fermés",
             temoin["isPasswordAuthEnabled"] is False and temoin["isPublicInviteLinkEnabled"] is False and temoin["editableProfileFields"] == ["profilePicture"], str(temoin)[:160])

    def visible(texte):
        return page.get_by_text(texte, exact=True).locator("visible=true").count() > 0

    page.goto(racine + "/settings/profile", wait_until="domcontentloaded")
    page.get_by_text("Your name as it will be displayed").locator("visible=true").first.wait_for(timeout=60000)
    controle("profil : pas de suppression de compte ni de 2FA locale", not visible("Delete account") and not visible("Leave workspace") and not visible("Authenticator App"))
    controle("profil : nom et email en lecture seule, mot de passe absent",
             page.locator("input:visible:not([disabled]):not([type=checkbox])").count() == 0 and not visible("Change Password") and not visible("Set Password"),
             f"{page.locator('input:visible:not([disabled]):not([type=checkbox])').count()} champ(s) actif(s)")

    page.goto(racine + "/settings/members", wait_until="domcontentloaded")
    page.get_by_text("Team", exact=True).locator("visible=true").first.wait_for(timeout=60000)
    controle("membres : pas d'onglet Invite", not visible("Invite"))

    page.goto(racine + "/settings/general", wait_until="domcontentloaded")
    page.get_by_text("Workspace domain").locator("visible=true").first.wait_for(timeout=60000)
    mention = page.get_by_text("Basé sur Twenty, AGPL", exact=True).first
    controle("marque : mention amont et lien vers le code", mention.get_attribute("href") == "https://github.com/Christ-Roy/veridian-crm-source", str(mention.get_attribute("href")))
    controle("marque : titre du navigateur", "Twenty" not in page.title() and page.locator("link[rel=manifest]").count() > 0, page.title())
    for chemin in ["/settings/general", "/settings/profile", "/settings/members", "/settings/ai", "/settings/applications", "/settings/billing", "/objects/people", "/objects/companies", "/getting-started"]:
        page.goto(racine + chemin, wait_until="domcontentloaded")
        # Un rendu réel, pas un délai fixe : 5 s ne suffisaient pas sur un nœud chargé (26 caractères lus).
        try:
            page.wait_for_function("document.body && document.body.innerText.length > 200", timeout=60000)
        except Exception:
            pass
        page.wait_for_timeout(1500)
        reste = [l.strip() for l in page.locator("body").inner_text().splitlines() if "Twenty" in l and "Basé sur Twenty" not in l]
        controle(f"marque : {chemin} sans le nom amont, {len(page.locator('body').inner_text())} caractères lus", not reste and len(page.locator("body").inner_text()) > 40, str(reste)[:200])
    controle("général : pas de suppression du workspace", not visible("Delete workspace"))

    page.goto(racine + "/objects/people", wait_until="domcontentloaded")
    page.get_by_text(re.compile(r"^Parcours \d+$")).locator("visible=true").first.wait_for(timeout=60000)
    page.get_by_text(re.compile(r"^Parcours \d+$")).locator("visible=true").first.click(timeout=15000)
    page.get_by_role("button", name="More options").first.wait_for(timeout=15000)
    page.wait_for_timeout(1500)
    lignes = page.locator("body").inner_text().splitlines()
    controle("menu : pas d'Invite user, Theme à côté", "Invite user" not in lignes and "Theme" in lignes, str([l for l in lignes if l in ("Invite user", "Theme")]))
    page.get_by_role("button", name="More options").first.click(timeout=15000)
    page.wait_for_timeout(2000)
    lignes = page.locator("body").inner_text().splitlines()
    controle("menu : pas de Create Workspace, Log out à côté", "Create Workspace" not in lignes and "Log out" in lignes, str([l for l in lignes if l in ("Create Workspace", "Log out")]))
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")

    page.goto(racine + "/objects/people", wait_until="domcontentloaded")
    page.wait_for_timeout(8000)
    avant = page.get_by_text("PersonneParcours").count()
    for bouton in page.locator("button:visible").all():
        if bouton.inner_text().strip() == "Create":
            bouton.click(timeout=8000)
            break
    page.wait_for_timeout(4000)
    page.mouse.click(1180, 98)
    page.wait_for_timeout(1500)
    page.keyboard.type("PersonneParcours")
    page.keyboard.press("Enter")
    page.wait_for_timeout(1500)
    page.keyboard.press("Control+Enter")
    page.wait_for_timeout(6000)
    page.goto(racine + "/objects/people", wait_until="domcontentloaded")
    page.wait_for_timeout(9000)
    page.screenshot(path=f"{OUT}/2-personnes.png")
    controle("personne créée et relue après rechargement", page.get_by_text("PersonneParcours").count() > avant)
    # Lecture de session, celle que la batterie du Hub utilise.
    lire = """async () => (await fetch('/metadata', {method: 'POST', credentials: 'include',
      headers: {'content-type': 'application/json', 'x-twenty-session-cookie': '1'},
      body: JSON.stringify({query: '{currentUser{email}}'})})).text()"""
    controle("lecture de session : connecté", EMAIL in page.evaluate(lire), page.evaluate(lire)[:80])

    code, _ = signe("/api/hub/users/sync", {"hub_user_id": HUB_ID, "revoke_sessions": True})
    page.goto(racine + "/objects/people", wait_until="domcontentloaded")
    page.wait_for_timeout(15000)
    controle("revoke_sessions : session coupée", code == 200 and (urlparse(page.url).hostname.startswith("hub.") or urlparse(page.url).hostname == os.environ.get("HUB_HOTE", "app.veridian.site")), f"{code} {page.url[:80]}")

    # Reconnexion, puis déconnexion explicite.
    ctx.clear_cookies()
    _, texte = rebond(HUB_ID, EMAIL)
    page.goto(json.loads(texte)["magic_link_url"], wait_until="domcontentloaded")
    page.wait_for_timeout(12000)
    page.goto(racine + "/settings/profile", wait_until="domcontentloaded")
    # L'élément lui-même, pas un délai fixe : 9 s n'ont pas suffi en prod le 09/11/2026.
    page.locator("#nav-item-logout").click(timeout=60000)
    page.wait_for_timeout(9000)
    corps = page.inner_text("body")
    controle("déconnexion : page locale, pas de rebond", "Continuer" in corps and urlparse(page.url).hostname == urlparse(racine).hostname, page.url[:90])
    href = page.get_by_role("link", name="Continuer").get_attribute("href")
    controle("Continuer : rebond sans auto", "bounce/prepare" in href and "auto=1" not in href, href[:110])
    page.goto(racine + "/objects/people", wait_until="domcontentloaded")
    page.wait_for_timeout(9000)
    controle("après déconnexion : toujours pas de rebond", "Continuer" in page.inner_text("body") and urlparse(page.url).hostname != "hub.staging.veridian.site", page.url[:90])

    # Domaine nu, navigateur vierge : le chemin d'un utilisateur qui ne connaît pas son espace.
    nu = nav.new_context(viewport={"width": 1400, "height": 900})
    nu.on("request", note)
    pn = nu.new_page()
    navs = []
    pn.on("request", lambda q: navs.append(q.url) if q.is_navigation_request() else None)
    pn.goto(BASE + "/settings/profile", wait_until="commit", timeout=120000)
    pn.wait_for_timeout(25000)
    vers_hub = [u for u in navs if "bounce/prepare" in u]
    controle("domaine nu : pas de boucle", len(navs) < 12, f"{len(navs)} navigations")
    controle("domaine nu : rebond auto vers la page demandée", bool(vers_hub) and "auto=1" in vers_hub[0] and "settings%2Fprofile" in vers_hub[0], (vers_hub or [pn.url])[0][:150])
    nu.close()

    # Domaine nu jusqu'à la page demandée : le Hub est simulé par l'appel signé qu'il ferait.
    arrivee = nav.new_context(viewport={"width": 1400, "height": 900})
    arrivee.on("request", note)

    def hub_simule(route):
        rep = route.fetch(max_redirects=0)
        cible = rep.headers.get("location", "")
        if "bounce/prepare" not in cible:
            route.fulfill(response=rep)
            return
        demande = urllib.parse.parse_qs(urlparse(cible).query).get("next", [""])[0]
        _, corps_lien = signe("/api/sso/issue-magic-link", {"hub_user_id": HUB_ID, "email": EMAIL, "next": demande})
        route.fulfill(status=302, headers={**rep.headers, "location": json.loads(corps_lien)["magic_link_url"]})

    arrivee.route("**/welcome*", hub_simule)
    pa = arrivee.new_page()
    pa.goto(BASE + "/settings/profile", wait_until="commit", timeout=120000)
    for _ in range(45):
        pa.wait_for_timeout(2000)
        if urlparse(pa.url).path == "/settings/profile" and urlparse(pa.url).hostname != urlparse(BASE).hostname:
            break
    controle("domaine nu : arrivée connectée sur la page demandée", urlparse(pa.url).path == "/settings/profile" and EMAIL in pa.evaluate(lire), pa.url[:90])
    arrivee.close()

    # Un seul essai automatique : navigateur vierge, deux passages.
    neuf = nav.new_context(viewport={"width": 1400, "height": 900})
    neuf.on("request", note)
    p3 = neuf.new_page()
    p3.set_default_navigation_timeout(180000)
    rebonds = []
    p3.on("request", lambda q: rebonds.append(q.url) if "bounce/prepare" in q.url else None)
    p3.goto(racine + "/objects/people", wait_until="domcontentloaded")
    p3.wait_for_timeout(12000)
    controle("sans session : rebond auto vers la page demandée", bool(rebonds) and "auto=1" in rebonds[0] and "objects%2Fpeople" in rebonds[0], (rebonds or [p3.url])[0][:150])
    p3.goto(racine + "/objects/people", wait_until="domcontentloaded")
    p3.wait_for_timeout(12000)
    controle("second passage : page locale", "Continuer" in p3.inner_text("body"), p3.url[:90])
    neuf.close()
    nav.close()

externes = {h: n for h, n in hotes.items() if h and not h.endswith(".veridian.site")}
print("HOTES NAVIGATEUR", json.dumps(hotes))
controle("navigateur : aucun hôte tiers", not externes, str(externes))
code, _ = signe("/api/hub/users/sync", {"hub_user_id": HUB_ID, "deleted": True})
code2, _ = rebond(HUB_ID, EMAIL)
controle("compte supprimé par le Hub : plus de lien", code == 200 and code2 == 400, f"{code} {code2}")
code, texte = lecture("/api/hub/users", "")
controle("compte de test retiré de la liste", code == 200 and EMAIL not in texte, str(code))
print(f"EMAIL {EMAIL}")
print(f"VERDICT : {'ÉCHEC ' + str(echecs) if echecs else 'parcours réussi'}")
sys.exit(1 if echecs else 0)
