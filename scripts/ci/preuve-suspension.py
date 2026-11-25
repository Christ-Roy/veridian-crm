#!/usr/bin/env python3
"""Preuve de la suspension d'un espace (CONTRAT-HUB §5.4), sur deux espaces jetables : A suspendu puis repris, B témoin.

  avant   : REST, GraphQL, MCP, rafraîchissement, webhook reçu et signé (témoins positifs) ; fiches de A et de B comptées.
  pendant : coupure mesurée en secondes ; clé API, session, MCP, rafraîchissement et rebond (423) refusés, écran « suspendu » ;
            un membre retiré par le Hub émet un événement dont le webhook est REPORTÉ ; document d'organisation en 423 ;
            B garde REST, GraphQL, rafraîchissement et rebond.
  après   : tout revient, le MÊME jeton de rafraîchissement compris ; le webhook reporté arrive ; fiches identiques.
Par API seulement : aucune lecture en base. La clé et le webhook créés ici sont révoqués.

  preuve-suspension.py <espace jetable A> <espace témoin B> [--env staging] [--attente 20] [--sans-ecran] [--sans-report]

Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import json
import secrets
import sys
import threading
import time
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

FICHES = "{ people { totalCount } companies { totalCount } }"


class Epreuve:
    def __init__(self, a, url):
        self.a, self.url = a, url
        self.c = ta.Client(a.env)
        creds = ta.lire_creds()
        pa, pb = ta.prefixe(a.env, a.espace), ta.prefixe(a.env, a.temoin)
        self.tenant, self.tenant_b = creds.get(f"{pa}_JETABLE_TENANT_ID"), creds.get(f"{pb}_JETABLE_TENANT_ID")
        if not self.tenant or not self.tenant_b:
            raise ta.Echec("deux espaces jetables attendus (A et témoin B)", 2)
        self.email, self.email_b = creds[f"{pa}_EMAIL"], creds[f"{pb}_EMAIL"]
        self.hub_a, self.hub_b = creds.get(f"{pa}_JETABLE_HUB_USER_ID"), creds.get(f"{pb}_JETABLE_HUB_USER_ID")
        self.origine, self.session_a, self.ws = self.c.session(self.email, a.espace)
        self.origine_b, self.session_b, _ = self.c.session(self.email_b, a.temoin)
        self.rafraichir_a = self.jeton_long(self.email, self.hub_a, self.origine)
        self.rafraichir_b = self.jeton_long(self.email_b, self.hub_b, self.origine_b)
        self.cle = self.cle_id = self.hook_id = None
        self.echecs = []

    def controle(self, nom, ok, detail=""):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:230], flush=True)
        if not ok:
            self.echecs.append(nom)

    def fiches(self, origine, jeton):
        return self.gql(origine, jeton)[1]

    def jeton_long(self, email, hub, origine):
        """Rafraîchissement (60 jours) d'une session neuve, comme le navigateur le garde."""
        code, texte, _ = self.rebond(email, hub, origine)
        if code != 200:
            raise ta.Echec(f"rebond {code}", 2)
        _, _, entetes = self.c.http(json.loads(texte)["magic_link_url"])
        jeton = parse_qs(urlparse(entetes.get("Location") or "").query).get("loginToken", [None])[0]
        d = self.c.gql(origine, "mutation($l:String!,$o:String!){getAuthTokensFromLoginToken(loginToken:$l,origin:$o)"
                                "{tokens{refreshToken{token}}}}", {"l": jeton, "o": origine})
        return d["getAuthTokensFromLoginToken"]["tokens"]["refreshToken"]["token"]

    def renouveler(self, origine, jeton):
        try:
            d = self.c.gql(origine, "mutation($t:String!){renewToken(appToken:$t){tokens{refreshToken{token}}}}", {"t": jeton})
            return bool(d["renewToken"]["tokens"]["refreshToken"]["token"]), "renouvelé"
        except ta.Echec as e:
            return False, str(e)

    def suppression_refusee(self, qui, jeton):
        try:
            self.c.gql(self.origine, "mutation{deleteCurrentWorkspace{id}}", jeton=jeton)
            self.controle(f"suppression de l'espace refusée [{qui}]", False, "ACCEPTÉE")
        except ta.Echec as e:
            self.controle(f"suppression de l'espace refusée [{qui}]", any(m in str(e) for m in ("Veridian Hub", "suspended")), str(e))

    def coupure(self, quoi, essai, debut, borne=60):
        while time.time() - debut < borne:
            if not essai():
                self.controle(f"coupure {quoi}", True, f"{time.time() - debut:.1f} s après la suspension")
                return
            time.sleep(0.3)
        self.controle(f"coupure {quoi}", False, f"toujours ouvert après {borne} s")

    # --- appels, rendent (statut, corps)
    def rest(self, origine, cle, methode="GET", chemin="/rest/companies?limit=1", corps=None):
        code, texte, _ = self.c.http(origine + chemin, json.dumps(corps).encode() if corps is not None else None,
                                     {"Authorization": f"Bearer {cle}", "Content-Type": "application/json"}, methode)
        return code, texte

    def gql(self, origine, jeton):
        code, texte, _ = self.c.http(origine + "/graphql", json.dumps({"query": FICHES}).encode(),
                                     {"Authorization": f"Bearer {jeton}", "Content-Type": "application/json", "Origin": origine})
        try:
            d = json.loads(texte)
        except ValueError:
            return code, None
        return code, (d.get("data") if not d.get("errors") else None)

    def mcp(self, origine, jeton):
        code, texte, _ = self.c.http(origine + "/mcp", json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).encode(),
                                     {"Authorization": f"Bearer {jeton}", "Content-Type": "application/json",
                                      "Accept": "application/json, text/event-stream"})
        outils = 0
        for ligne in texte.splitlines() if code == 200 else []:
            if ligne.startswith("data:"):
                outils = len(json.loads(ligne[5:]).get("result", {}).get("tools", []))
        return code, outils

    def rebond(self, email, hub, origine):
        return self.c.signe("/api/sso/issue-magic-link", {"hub_user_id": hub, "email": email, "next": origine + "/"})

    def statut_hub(self, email, sous_domaine):
        _, texte, _ = self.c.signe("/api/users/by-email?email=" + quote(email), None, "GET")
        return next((w.get("status") for w in json.loads(texte).get("workspaces", []) if w.get("subdomain") == sous_domaine), None)

    def recus(self, evenement="company.created"):
        return [x for x in ta._Recepteur.recus if x[0] == evenement]

    def attendre_recu(self, avant, secondes, evenement="company.created"):
        fin = time.time() + secondes
        while time.time() < fin and len(self.recus(evenement)) <= avant:
            time.sleep(1)
        return len(self.recus(evenement)) > avant

    def membre(self):
        hub, mail = str(uuid.uuid4()), f"e2e-suspension-{int(time.time())}@veridian.site"
        code, texte, _ = self.c.signe(f"/api/veridian/workspaces/{self.ws['id']}/attach-member",
                                      {"hub_user_id": hub, "hub_user_email": mail, "role": "member"})
        if code != 201:
            raise ta.Echec(f"attach-member {code} {texte[:80]}", 2)
        return hub, mail

    def organisation(self):
        code, texte, _ = self.c.signe("/api/hub/organisations/sync", {
            "hub_tenant_id": self.tenant, "version": int(time.time() * 1000), "nom": "x", "type": "organisation",
            "marque": {"nom_affiche": None, "logo_url": None}, "modules": ["crm"], "membres": [], "reglages": {}})
        return code, texte

    def installer_acces(self):
        """Clé API Admin et webhook sur A, par la session du propriétaire. Révoqués par nettoyer()."""
        roles = self.c.gql(self.origine, "{getApiKeyRoles{id label}}", jeton=self.session_a)["getApiKeyRoles"]
        admin = next((r for r in roles if r["label"] == "Admin"), None)
        if not admin:
            raise ta.Echec("aucun rôle Admin assignable sur A", 2)
        expire = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        cle = self.c.gql(self.origine, "mutation($i:CreateApiKeyInput!){createApiKey(input:$i){id}}",
                         {"i": {"name": "preuve-suspension", "expiresAt": expire, "roleId": admin["id"]}}, self.session_a)["createApiKey"]
        self.cle_id = cle["id"]
        self.cle = self.c.gql(self.origine, "mutation($a:UUID!,$e:String!){generateApiKeyToken(apiKeyId:$a,expiresAt:$e){token}}",
                              {"a": cle["id"], "e": expire}, self.session_a)["generateApiKeyToken"]["token"]
        secret = secrets.token_hex(32)
        self.hook_id = self.c.gql(self.origine, "mutation($i:CreateWebhookInput!){createWebhook(input:$i){id}}",
                                  {"i": {"targetUrl": self.url + "/twenty", "operations": ["company.created", "workspaceMember.deleted"], "roleId": admin["id"],
                                         "secret": secret, "description": "preuve-suspension"}}, self.cle)["createWebhook"]["id"]
        ta._Recepteur.secret = secret

    def nettoyer(self):
        try:
            self.reprendre(self.tenant)
        except Exception as e:  # noqa: BLE001
            print(f"reprise de nettoyage non aboutie : {e}", flush=True)
        try:
            ta._revoquer(self.c, self.origine, self.session_a, self.cle_id, self.hook_id)
        except Exception as e:  # noqa: BLE001
            print(f"révocation incomplète : {e}", flush=True)

    def suspendre(self, tenant):
        return self.c.signe("/api/tenants/suspend", {"tenant_id": tenant, "reason": "admin_action"})

    def reprendre(self, tenant):
        return self.c.signe("/api/tenants/resume", {"tenant_id": tenant})

    def societe(self, nom):
        code, texte = self.rest(self.origine, self.cle, "POST", "/rest/companies", {"name": nom})
        ident = json.loads(texte).get("data", {}).get("createCompany", {}).get("id") if code == 201 else None
        return code, ident

    def ouvrir_ecran(self):
        if self.a.sans_ecran:
            return None
        from playwright.sync_api import sync_playwright
        self.pw = sync_playwright().start()
        self.nav = self.pw.chromium.launch(headless=True)
        page = self.nav.new_page()
        _, texte, _ = self.rebond(self.email, self.hub_a, self.origine)
        page.goto(json.loads(texte)["magic_link_url"], wait_until="domcontentloaded", timeout=120000)
        page.wait_for_url("**/objects/**", timeout=120000)
        page.goto(self.origine + "/objects/companies", wait_until="domcontentloaded", timeout=120000)
        page.wait_for_selector("text=Companies", timeout=120000)
        self.controle("avant : écran de A ouvert (témoin positif)", "suspendu" not in page.inner_text("body"), page.url)
        return page

    def fermer_ecran(self):
        for o, f in ((getattr(self, "nav", None), "close"), (getattr(self, "pw", None), "stop")):
            if o:
                getattr(o, f)()

    def jouer(self):
        a = self.a
        code, outils = self.mcp(self.origine, self.session_a)
        self.controle("avant : MCP de A répond (témoin positif)", code == 200 and outils > 0, f"{code} {outils} outils")
        self.installer_acces()
        code, ident = self.societe(f"Preuve suspension avant {int(time.time())}")
        self.controle("avant : REST crée une fiche", code == 201 and ident, f"HTTP {code}")
        # Le nom du tunnel met parfois des minutes à se résoudre côté serveur : le témoin attend que le CRM le joigne.
        fin = time.time() + 600
        while not self.attendre_recu(0, a.attente) and time.time() < fin:
            self.societe(f"Preuve suspension témoin {int(time.time())}")
        if not self.recus():
            raise ta.Echec("le CRM ne joint pas le récepteur en 10 min : mesure impossible", 2)
        self.controle("avant : webhook reçu et signé (témoin positif)", all(ok for _, ok in self.recus()), f"{self.recus()}")
        time.sleep(a.attente)
        hub0, mail0 = self.membre()
        self.c.signe(f"/api/tenants/{self.tenant}/remove-member", {"hub_user_id": hub0, "email": mail0})
        self.controle("avant : un membre retiré par le Hub émet son webhook (témoin positif)",
                      self.attendre_recu(0, a.attente, "workspaceMember.deleted"), str(self.recus("workspaceMember.deleted")))
        hub1, mail1 = self.membre()
        self.suppression_refusee("actif, clé API", self.cle)
        self.suppression_refusee("actif, session du propriétaire", self.session_a)
        avant_a, avant_b = self.fiches(self.origine, self.session_a), self.fiches(self.origine_b, self.session_b)
        self.controle("avant : fiches comptées", bool(avant_a) and bool(avant_b), f"A={avant_a} B={avant_b}")
        page = self.ouvrir_ecran()
        recus_avant, partis_avant = len(self.recus()), len(self.recus("workspaceMember.deleted"))

        debut = time.time()
        st, corps, _ = self.suspendre(self.tenant)
        self.controle("suspension signée : 200 et suspended_at", st == 200 and "suspended_at" in corps, f"HTTP {st}")
        self.coupure("clé API (REST)", lambda: self.rest(self.origine, self.cle)[0] == 200, debut)
        self.coupure("session ouverte (GraphQL)", lambda: self.gql(self.origine, self.session_a)[1] is not None, debut)
        self.coupure("MCP", lambda: self.mcp(self.origine, self.cle)[1] > 0, debut)
        st2, _, _ = self.suspendre(self.tenant)
        self.controle("suspension rejouée : idempotente", st2 == 200, f"HTTP {st2}")
        self.controle("by-email rend suspended pour A", self.statut_hub(self.email, a.espace) == "suspended")
        code, _ = self.rest(self.origine, self.cle)
        self.controle("REST par clé API refusé", code in (401, 402, 403, 423), f"HTTP {code}")
        code, donnees = self.gql(self.origine, self.cle)
        self.controle("GraphQL par clé API refusé", donnees is None, f"HTTP {code}")
        code, outils = self.mcp(self.origine, self.session_a)
        self.controle("MCP par session refusé", outils == 0, f"HTTP {code} {outils} outils")
        code, _ = self.rest(self.origine, self.cle, "POST", "/rest/companies", {"name": "Preuve suspension refusee"})
        self.controle("écriture REST refusée", code not in (200, 201), f"HTTP {code}")
        ok, detail = self.renouveler(self.origine, self.rafraichir_a)
        self.controle("rafraîchissement de A refusé", not ok and "suspended" in detail.lower(), detail)
        st, texte, _ = self.rebond(self.email, self.hub_a, self.origine)
        self.controle("rebond du Hub vers A : 423", st == 423 and "workspace_suspended" in texte, f"HTTP {st}")
        self.suppression_refusee("suspendu, clé API", self.cle)
        self.suppression_refusee("suspendu, session", self.session_a)
        code, texte = self.organisation()
        self.controle("document d'organisation : 423", code == 423, f"{code} {texte[:60]}")
        if page:
            t = time.time()
            page.reload(wait_until="domcontentloaded", timeout=120000)
            page.wait_for_selector("text=Cet espace est suspendu.", timeout=60000)
            vu = page.inner_text("body")
            self.controle("écran : suspendu, sans facturation", "Vos données sont conservées" in vu and "illing" not in vu,
                          f"{time.time() - t:.1f} s au rechargement")
        self.c.signe(f"/api/tenants/{self.tenant}/remove-member", {"hub_user_id": hub1, "email": mail1})
        time.sleep(a.attente)
        self.controle("pendant : aucun webhook, ni création ni membre retiré",
                      len(self.recus()) == recus_avant and len(self.recus("workspaceMember.deleted")) == partis_avant,
                      f"{len(self.recus())} et {len(self.recus('workspaceMember.deleted'))} reçus")

        code, donnees = self.gql(self.origine_b, self.session_b)
        self.controle("témoin B lisible, fiches inchangées", donnees == avant_b, f"{donnees}")
        ok, detail = self.renouveler(self.origine_b, self.rafraichir_b)
        self.controle("témoin B : rafraîchissement servi", ok, detail)
        st, _, _ = self.rebond(self.email_b, self.hub_b, self.origine_b)
        self.controle("témoin B : rebond 200", st == 200, f"HTTP {st}")

        st, _, _ = self.reprendre(self.tenant)
        self.controle("reprise : 200", st == 200, f"HTTP {st}")
        st2, _, _ = self.reprendre(self.tenant)
        self.controle("reprise rejouée : idempotente", st2 == 200, f"HTTP {st2}")
        time.sleep(2)
        code, _ = self.rest(self.origine, self.cle)
        self.controle("REST par clé API rendu", code == 200, f"HTTP {code}")
        apres = self.fiches(self.origine, self.session_a)
        self.controle("session rendue, fiches identiques", apres == avant_a, f"{apres}")
        code, outils = self.mcp(self.origine, self.cle)
        self.controle("MCP rendu", code == 200 and outils > 0, f"HTTP {code} {outils} outils")
        ok, detail = self.renouveler(self.origine, self.rafraichir_a)
        self.controle("le même jeton de rafraîchissement sert encore", ok, detail)
        st, _, _ = self.rebond(self.email, self.hub_a, self.origine)
        self.controle("rebond rendu : 200", st == 200, f"HTTP {st}")
        code, texte = self.organisation()
        self.controle("document d'organisation appliqué", code == 200, f"{code} {texte[:60]}")
        if page:
            page.goto(self.origine + "/objects/companies", wait_until="domcontentloaded", timeout=120000)
            page.wait_for_selector("text=Companies", timeout=120000)
            self.controle("écran rendu", "suspendu" not in page.inner_text("body"), page.url)
        code, ident = self.societe(f"Preuve suspension apres {int(time.time())}")
        self.controle("après : REST crée une fiche, webhook signé", code == 201 and self.attendre_recu(recus_avant, a.attente) and
                      all(ok for _, ok in self.recus()), f"HTTP {code}, {len(self.recus())} reçus")
        if not a.sans_report:
            t = time.time()
            self.controle("le webhook reporté pendant la suspension arrive", self.attendre_recu(partis_avant, 480, "workspaceMember.deleted"),
                          f"{time.time() - t:.0f} s après la reprise")
        for hub in (hub0, hub1):
            self.c.signe("/api/hub/users/sync", {"hub_user_id": hub, "deleted": True})


def main():
    p = argparse.ArgumentParser()
    p.add_argument("espace")
    p.add_argument("temoin")
    p.add_argument("--env", default="staging", choices=("staging", "prod"))
    p.add_argument("--sans-ecran", action="store_true")
    p.add_argument("--sans-report", action="store_true")
    p.add_argument("--attente", type=int, default=20, help="secondes d'attente d'un webhook attendu ou d'une absence")
    a = p.parse_args()
    serveur = ThreadingHTTPServer(("127.0.0.1", 0), ta._Recepteur)
    threading.Thread(target=serveur.serve_forever, daemon=True).start()
    proc, e = None, None
    try:
        proc, url = ta._tunnel(serveur.server_address[1])
        pret = False
        for _ in range(45):
            try:
                with urllib.request.urlopen(url, timeout=10) as r:
                    pret = r.read() == b"recepteur-twenty-admin"
            except Exception:  # noqa: BLE001
                pass
            if pret:
                break
            time.sleep(2)
        if not pret:
            raise ta.Echec("le tunnel ne joint pas le récepteur en 90 s", 2)
        ta._attendre_dns(urlparse(url).hostname)
        ta._Recepteur.recus.clear()
        e = Epreuve(a, url)
        e.jouer()
    except ta.Echec as err:
        print(f"NON ABOUTI : {err}")
        return err.code
    finally:
        if e is not None:
            e.fermer_ecran()
            e.nettoyer()
        if proc:
            proc.terminate()
        serveur.shutdown()
    if e.echecs:
        print(f"FAUX : {len(e.echecs)} contrôle(s) en échec : {', '.join(e.echecs)}")
        return 1
    print("VRAI : suspension et reprise sans perte, témoin intact, webhook muet puis rétabli")
    return 0


if __name__ == "__main__":
    sys.exit(main())
