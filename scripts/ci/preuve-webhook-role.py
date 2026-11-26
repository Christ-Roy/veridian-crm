#!/usr/bin/env python3
"""Preuve qu'un webhook ne reçoit que ce que son rôle peut lire (repris de l'amont 12e8fae471), sur un espace jetable.

  preuve-webhook-role.py <espace jetable (twenty-admin jetable:creer)> [--env staging|prod] [--sabotage]

Un rôle « restreint » ne lit ni le champ `annualRevenue` des sociétés ni les personnes. Deux webhooks vers un récepteur
public éphémère : l'un porte ce rôle, l'autre le rôle Admin (témoin). Une société et une personne sont créées par l'API.
Attendu : le témoin reçoit les deux événements avec `annualRevenue` ; le restreint reçoit la société SANS `annualRevenue` et
aucune personne. --sabotage donne le rôle Admin au webhook « restreint » : la preuve doit alors sortir en 1.
Tout ce qui est créé est retiré à la fin. Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import hashlib
import hmac
import json
import secrets
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

SECRETS = {"restreint": secrets.token_hex(16), "admin": secrets.token_hex(16)}
RECUS = []


class Recepteur(BaseHTTPRequestHandler):
    def do_POST(self):
        nom = self.path.strip("/")
        corps = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        t = self.headers.get("X-Twenty-Webhook-Timestamp", "")
        attendu = hmac.new(SECRETS.get(nom, "?").encode(), f"{t}:".encode() + corps, hashlib.sha256).hexdigest()
        valide = hmac.compare_digest(attendu, self.headers.get("X-Twenty-Webhook-Signature", ""))
        try:
            charge = json.loads(corps)
        except ValueError:
            charge = {}
        RECUS.append((nom, valide, charge))
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"recepteur-twenty-admin")

    def log_message(self, *args):
        pass


class Epreuve:
    def __init__(self, a):
        self.a, self.echecs, self.nettoyer = a, [], []
        v = ta.lire_creds()
        p = ta.prefixe(a.env, a.espace)
        if not v.get(f"{p}_JETABLE_TENANT_ID"):
            raise ta.Echec(f"{a.espace} n'est pas un jetable rangé : refus", 2)
        self.c, self.url = ta.Client(a.env), v[f"{p}_API_URL"]
        self.h = {"Content-Type": "application/json", "Authorization": f"Bearer {v[f'{p}_API_KEY']}"}

    def controle(self, nom, ok, detail=""):
        print(("OK    " if ok else "ECHEC ") + nom + (f" : {detail}" if detail else ""), flush=True)
        if not ok:
            self.echecs.append(nom)

    def gql(self, requete, variables=None):
        code, texte, _ = self.c.http(self.url + "/metadata", json.dumps({"query": requete, "variables": variables or {}}).encode(), self.h)
        d = json.loads(texte) if texte.startswith("{") else {}
        if code != 200 or d.get("errors"):
            raise ta.Echec(f"/metadata {code} : {(d.get('errors') or [{}])[0].get('message', texte[:120])}", 2)
        return d["data"]

    def rest(self, chemin, corps=None, methode=None):
        code, texte, _ = self.c.http(self.url + chemin, json.dumps(corps).encode() if corps is not None else None, self.h, methode)
        return code, json.loads(texte) if texte.startswith("{") else {}

    def jouer(self):
        objets = self.gql("{objects(paging:{first:200}){edges{node{id nameSingular fields(paging:{first:300}){edges{node{id name}}}}}}}")
        meta = {e["node"]["nameSingular"]: e["node"] for e in objets["objects"]["edges"]}
        societe, personne = meta["company"], meta["person"]
        employes = next(f["node"]["id"] for f in societe["fields"]["edges"] if f["node"]["name"] == "annualRevenue")
        roles = self.gql("{getApiKeyRoles{id label}}")["getApiKeyRoles"]
        admin = next(r["id"] for r in roles if r["label"] == "Admin")
        role = self.gql("mutation($i:CreateRoleInput!){createOneRole(createRoleInput:$i){id}}", {"i": {
            "label": f"Preuve webhook {int(time.time())}", "canReadAllObjectRecords": True, "canUpdateAllObjectRecords": False,
            "canSoftDeleteAllObjectRecords": False, "canDestroyAllObjectRecords": False, "canUpdateAllSettings": False,
            "canBeAssignedToApiKeys": True, "canBeAssignedToUsers": False, "canBeAssignedToAgents": False}})["createOneRole"]["id"]
        self.nettoyer.append(("mutation($r:UUID!){deleteOneRole(roleId:$r)}", {"r": role}))
        self.gql("mutation($i:UpsertObjectPermissionsInput!){upsertObjectPermissions(upsertObjectPermissionsInput:$i){objectMetadataId}}",
                 {"i": {"roleId": role, "objectPermissions": [{"objectMetadataId": personne["id"], "canReadObjectRecords": False,
                                                                "canUpdateObjectRecords": False, "canSoftDeleteObjectRecords": False,
                                                                "canDestroyObjectRecords": False}]}})
        self.gql("mutation($i:UpsertFieldPermissionsInput!){upsertFieldPermissions(upsertFieldPermissionsInput:$i){fieldMetadataId}}",
                 {"i": {"roleId": role, "fieldPermissions": [{"objectMetadataId": societe["id"], "fieldMetadataId": employes,
                                                              "canReadFieldValue": False, "canUpdateFieldValue": False}]}})
        print("rôle restreint posé : personnes illisibles, champ annualRevenue illisible", flush=True)

        serveur = ThreadingHTTPServer(("127.0.0.1", 0), Recepteur)
        threading.Thread(target=serveur.serve_forever, daemon=True).start()
        proc, url = ta._tunnel(serveur.server_address[1])
        try:
            for _ in range(45):
                try:
                    with urllib.request.urlopen(url, timeout=10) as r:
                        if r.read() == b"recepteur-twenty-admin":
                            break
                except Exception:
                    pass
                time.sleep(2)
            else:
                raise ta.Echec("le tunnel ne joint pas le récepteur en 90 s", 2)
            ta._attendre_dns(urlparse(url).hostname)
            for nom, role_id in (("restreint", admin if self.a.sabotage else role), ("admin", admin)):
                w = self.gql("mutation($i:CreateWebhookInput!){createWebhook(input:$i){id}}", {"i": {
                    "targetUrl": f"{url}/{nom}", "operations": ["company.created", "person.created"], "secret": SECRETS[nom], "roleId": role_id}})
                self.nettoyer.insert(0, ("mutation($i:UUID!){deleteWebhook(id:$i){id}}", {"i": w["createWebhook"]["id"]}))
            time.sleep(5)
            suffixe = int(time.time())
            code, s = self.rest("/rest/companies", {"name": f"Preuve webhook {suffixe}", "annualRevenue": {"amountMicros": 4242000000, "currencyCode": "EUR"}})
            code_p, pe = self.rest("/rest/people", {"name": {"firstName": "Preuve", "lastName": f"Webhook {suffixe}"}})
            if code != 201 or code_p != 201:
                raise ta.Echec(f"création société {code}, personne {code_p}", 2)
            for chemin, d, cle in (("/rest/companies/", s, "createCompany"), ("/rest/people/", pe, "createPerson")):
                self.nettoyer.append(("REST", chemin + d["data"][cle]["id"]))
            fin = time.time() + self.a.attente
            while time.time() < fin and len({(n, (c or {}).get("eventName")) for n, _, c in RECUS if n == "admin"}) < 2:
                time.sleep(1)
            time.sleep(10)
        finally:
            proc.terminate()
            serveur.shutdown()

        def evenements(nom):
            return {c.get("eventName"): c for n, ok, c in RECUS if n == nom and ok}

        mal_signes = [n for n, ok, _ in RECUS if not ok]
        self.controle("toutes les livraisons sont signées par leur secret", not mal_signes, str(mal_signes))
        temoin, restreint = evenements("admin"), evenements("restreint")
        print("reçus :", {n: sorted(evenements(n)) for n in ("admin", "restreint")}, flush=True)
        rec = lambda e: (e or {}).get("record") or {}  # noqa: E731
        montant = (rec(temoin.get("company.created")).get("annualRevenue") or {}).get("amountMicros")
        self.controle("témoin Admin : société reçue avec annualRevenue", str(montant) == "4242000000", str(montant))
        self.controle("témoin Admin : personne reçue", "person.created" in temoin)
        self.controle("restreint : société reçue", "company.created" in restreint)
        self.controle("restreint : annualRevenue absent de la société", "annualRevenue" not in rec(restreint.get("company.created")),
                      str(rec(restreint.get("company.created")).get("annualRevenue")))
        self.controle("restreint : aucune personne reçue", "person.created" not in restreint)

    def ranger(self):
        for item in self.nettoyer:
            try:
                if item[0] == "REST":
                    self.rest(item[1], None, "DELETE")
                else:
                    self.gql(*item)
            except ta.Echec as e:
                print("rangement :", e, flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--env", default="staging", choices=("staging", "prod"))
    p.add_argument("--attente", type=int, default=90)
    p.add_argument("--sabotage", action="store_true")
    e = None
    try:
        e = Epreuve(p.parse_args())
        e.jouer()
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code
    finally:
        if e:
            e.ranger()
    print("VRAI : chaque webhook ne reçoit que ce que son rôle lit" if not e.echecs else f"FAUX : {len(e.echecs)} contrôle(s) : {', '.join(e.echecs)}")
    return 0 if not e.echecs else 1


if __name__ == "__main__":
    sys.exit(main())
