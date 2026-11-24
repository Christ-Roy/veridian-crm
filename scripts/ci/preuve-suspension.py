#!/usr/bin/env python3
"""Preuve de la suspension d'un espace (CONTRAT-HUB §5.4), staging seulement.

Espace jetable A suspendu puis repris, espace témoin B jamais suspendu. Mesures :
  avant    : fiches de A et de B comptées en base ; clé API et webhook créés sur A, webhook company.created reçu (témoin positif).
  pendant  : suspension signée (200, idempotente), by-email « suspended », suspendedAt NULL en base ; REST, GraphQL, MCP par
             clé API et GraphQL par session refusés sur A ; une écriture REST refusée ne crée rien et n'émet aucun webhook ;
             rebond du Hub en 423 ; B lisible, rebond de B en 200, fiches de B inchangées ; fiches de A identiques.
  après    : reprise (200, idempotente) ; REST, GraphQL, MCP rendus ; webhook reçu de nouveau ; fiches de A identiques à l'avant.
Le récepteur du webhook est local, exposé par un tunnel public éphémère (mécanique de `twenty-admin agent:preuve`).
La clé et le webhook créés ici sont révoqués à la fin ; rien n'est rangé dans les fichiers d'accès.

  preuve-suspension.py <espace jetable A> <espace témoin B> [--job crm-staging] [--attente 20]

Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import base64
import json
import secrets
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlparse

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

ICI = Path(__file__).resolve().parent
FICHES = "{ people { totalCount } companies { totalCount } }"


class Epreuve:
    def __init__(self, a, url):
        self.a, self.url = a, url
        self.c = ta.Client("staging")
        creds = ta.lire_creds()
        pa, pb = ta.prefixe("staging", a.espace), ta.prefixe("staging", a.temoin)
        self.tenant, self.tenant_b = creds.get(f"{pa}_JETABLE_TENANT_ID"), creds.get(f"{pb}_JETABLE_TENANT_ID")
        if not self.tenant or not self.tenant_b:
            raise ta.Echec("deux espaces jetables attendus (A et témoin B)", 2)
        self.email, self.email_b = creds[f"{pa}_EMAIL"], creds[f"{pb}_EMAIL"]
        self.hub_a, self.hub_b = creds.get(f"{pa}_JETABLE_HUB_USER_ID"), creds.get(f"{pb}_JETABLE_HUB_USER_ID")
        self.origine, self.session_a, _ = self.c.session(self.email, a.espace)
        self.origine_b, self.session_b, _ = self.c.session(self.email_b, a.temoin)
        self.cle = self.cle_id = self.hook_id = None
        self.echecs = []

    def controle(self, nom, ok, detail=""):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:230], flush=True)
        if not ok:
            self.echecs.append(nom)

    # --- base, lecture seule, dans le conteneur du CRM de staging
    def etat(self, sous_domaine):
        alloc = subprocess.run(
            ["bash", "-c", f"nomad job status {self.a.job} 2>/dev/null | awk '/^Allocations/{{f=1;next}} f&&/stack|crm/&&/ run +running/{{print $1; exit}}'"],
            capture_output=True, text=True, timeout=60).stdout.strip()
        if not alloc:
            raise ta.Echec(f"aucune allocation {self.a.job} en service", 2)
        b64 = base64.b64encode((ICI / "etat-espace.js").read_bytes()).decode()
        cmd = (f"export PGMOD=/app/node_modules/pg SOUS_DOMAINE={sous_domaine}; echo {b64} | base64 -d > /tmp/etat-espace.js; "
               "node /tmp/etat-espace.js; c=$?; rm -f /tmp/etat-espace.js; exit $c")
        sortie = subprocess.run(["timeout", "120", "nomad-v", "raw", "alloc", "exec", "-task", "crm-server", alloc, "sh", "-c", cmd],
                                capture_output=True, text=True).stdout
        ligne = next((x for x in sortie.splitlines() if x.startswith("ESPACE ")), None)
        if not ligne:
            raise ta.Echec(f"état de {sous_domaine} illisible : {sortie[-120:]!r}", 2)
        return json.loads(ligne[7:])

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

    def recus(self):
        return [x for x in ta._Recepteur.recus if x[0] == "company.created"]

    def attendre_recu(self, avant, secondes):
        fin = time.time() + secondes
        while time.time() < fin and len(self.recus()) <= avant:
            time.sleep(1)
        return len(self.recus()) > avant

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
                                  {"i": {"targetUrl": self.url + "/twenty", "operations": ["company.created"], "roleId": admin["id"],
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

    def jouer(self):
        a = self.a
        avant_a, avant_b = self.etat(a.espace), self.etat(a.temoin)
        self.controle("avant : A et B actifs, suspendedAt NULL",
                      avant_a["statut"] == "ACTIVE" and avant_b["statut"] == "ACTIVE" and avant_a["suspendu"] is None,
                      f"A={avant_a['statut']} B={avant_b['statut']}")
        code, outils = self.mcp(self.origine, self.session_a)
        self.controle("avant : MCP de A répond (témoin positif)", code == 200 and outils > 0, f"{code} {outils} outils")

        self.installer_acces()
        code, ident = self.societe(f"Preuve suspension avant {int(time.time())}")
        self.controle("avant : REST crée une fiche", code == 201 and ident, f"HTTP {code}")
        self.controle("avant : webhook company.created reçu et signé (témoin positif)",
                      self.attendre_recu(0, a.attente) and all(ok for _, ok in self.recus()), f"{self.recus()}")
        if ident:
            self.rest(self.origine, self.cle, "DELETE", f"/rest/companies/{ident}")
        time.sleep(2)
        avant_a, avant_b = self.etat(a.espace), self.etat(a.temoin)
        recus_avant = len(self.recus())

        st, corps, _ = self.suspendre(self.tenant)
        self.controle("suspension signée : 200 et suspended_at", st == 200 and "suspended_at" in corps, f"HTTP {st}")
        st2, _, _ = self.suspendre(self.tenant)
        self.controle("suspension rejouée : idempotente", st2 == 200, f"HTTP {st2}")
        self.controle("by-email rend suspended pour A", self.statut_hub(self.email, a.espace) == "suspended")
        pendant = self.etat(a.espace)
        self.controle("base : SUSPENDED et suspendedAt NULL (le cron natif n'effacera rien)",
                      pendant["statut"] == "SUSPENDED" and pendant["suspendu"] is None, f"{pendant['statut']} {pendant['suspendu']}")

        code, _ = self.rest(self.origine, self.cle)
        self.controle("REST par clé API refusé sur A", code in (401, 402, 403, 423), f"HTTP {code}")
        code, donnees = self.gql(self.origine, self.cle)
        self.controle("GraphQL par clé API refusé sur A", donnees is None, f"HTTP {code}")
        code, donnees = self.gql(self.origine, self.session_a)
        self.controle("GraphQL par session refusé sur A", donnees is None, f"HTTP {code}")
        code, outils = self.mcp(self.origine, self.cle)
        self.controle("MCP par clé API refusé sur A", outils == 0, f"HTTP {code} {outils} outils")
        code, _ = self.rest(self.origine, self.cle, "POST", "/rest/companies", {"name": "Preuve suspension refusee"})
        self.controle("écriture REST refusée sur A", code != 201, f"HTTP {code}")
        st, texte, _ = self.rebond(self.email, self.hub_a, self.origine)
        self.controle("rebond du Hub vers A : 423 workspace_suspended", st == 423 and "workspace_suspended" in texte, f"HTTP {st}")

        time.sleep(a.attente)
        self.controle("aucun webhook émis pendant la suspension", len(self.recus()) == recus_avant,
                      f"{len(self.recus())} reçu(s), {recus_avant} avant")
        self.controle("fiches de A identiques pendant la suspension", self.etat(a.espace)["comptes"] == avant_a["comptes"],
                      str(avant_a["comptes"]))

        code, donnees = self.gql(self.origine_b, self.session_b)
        self.controle("témoin B lisible pendant la suspension", donnees is not None, f"HTTP {code}")
        st, _, _ = self.rebond(self.email_b, self.hub_b, self.origine_b)
        self.controle("rebond du Hub vers B : 200", st == 200, f"HTTP {st}")
        pendant_b = self.etat(a.temoin)
        self.controle("témoin B actif, fiches inchangées", pendant_b["statut"] == "ACTIVE" and pendant_b["comptes"] == avant_b["comptes"],
                      str(avant_b["comptes"]))

        st, _, _ = self.reprendre(self.tenant)
        self.controle("reprise : 200", st == 200, f"HTTP {st}")
        st2, _, _ = self.reprendre(self.tenant)
        self.controle("reprise rejouée : idempotente", st2 == 200, f"HTTP {st2}")
        apres = self.etat(a.espace)
        self.controle("base : ACTIVE après reprise, fiches identiques à l'avant",
                      apres["statut"] == "ACTIVE" and apres["comptes"] == avant_a["comptes"], f"{apres['statut']} {apres['comptes']}")
        code, _ = self.rest(self.origine, self.cle)
        self.controle("REST par clé API rendu après reprise", code == 200, f"HTTP {code}")
        code, donnees = self.gql(self.origine, self.cle)
        self.controle("GraphQL par clé API rendu après reprise", donnees is not None, f"HTTP {code}")
        code, outils = self.mcp(self.origine, self.cle)
        self.controle("MCP par clé API rendu après reprise", code == 200 and outils > 0, f"HTTP {code} {outils} outils")
        st, _, _ = self.rebond(self.email, self.hub_a, self.origine)
        self.controle("rebond du Hub vers A rendu : 200", st == 200, f"HTTP {st}")
        code, ident = self.societe(f"Preuve suspension apres {int(time.time())}")
        self.controle("après reprise : REST crée une fiche", code == 201 and ident, f"HTTP {code}")
        self.controle("après reprise : le webhook repart, signé",
                      self.attendre_recu(recus_avant, a.attente) and all(ok for _, ok in self.recus()), f"{len(self.recus())} reçu(s)")
        if ident:
            self.rest(self.origine, self.cle, "DELETE", f"/rest/companies/{ident}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("espace")
    p.add_argument("temoin")
    p.add_argument("--job", default="crm-staging")
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
