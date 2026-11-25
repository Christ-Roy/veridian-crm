#!/usr/bin/env python3
"""Faux CRM Twenty pour les épreuves de l'app Android sur émulateur (jamais le vrai CRM).

Parle ce que l'app utilise : REST (people, appels, textMessages : liste filtrée et paginée, lot, modification), OAuth natif
(découverte, enregistrement, autorisation PKCE, jetons), et refuse /metadata en le notant (l'app ne doit demander aucune
activation à un CRM qui a déjà ses objets). Tout ce qu'il reçoit est journalisé dans --journal (JSONL).

Deux ports : HTTPS (l'app) et HTTP sur 127.0.0.1 (pilotage) :
  GET  /etat                  décompte, créations par idSource, requêtes de métadonnées
  GET  /records               tout ce que le CRM porte
  POST /panne?code=503|0      toute requête REST rend ce code (0 : rétabli)
  POST /reinit                tout vider, puis Alice (+33611111111) et Bob (+33622222222)
  POST /personne              corps {"nom", "numero"} : ajoute une personne
  POST /oauth/revoquer        les jetons émis ne valent plus

  faux_crm.py --cle CLE --certificat c.pem --cle-privee k.pem --https 8443 --pilotage 8444 --journal j.jsonl
"""
import argparse
import base64
import hashlib
import http.server
import json
import ssl
import threading
import time
import urllib.parse
import uuid
from datetime import datetime, timezone

OBJETS = ("people", "appels", "textMessages")
CHAMPS_DATE = ("debutLe", "envoyeLe")


def date(v):
    return datetime.fromisoformat(str(v).replace("Z", "+00:00")).astimezone(timezone.utc)


def separer(expression):
    morceaux, profondeur, courant, guillemets = [], 0, "", False
    for c in expression:
        if c == '"':
            guillemets = not guillemets
        if not guillemets:
            if c == "(":
                profondeur += 1
            elif c == ")":
                profondeur -= 1
            elif c == "," and profondeur == 0:
                morceaux.append(courant)
                courant = ""
                continue
        courant += c
    return morceaux + [courant]


def clauses(filtre):
    if not filtre:
        return []
    if filtre.startswith("and(") and filtre.endswith(")"):
        return [c for morceau in separer(filtre[4:-1]) for c in clauses(morceau)]
    champ, reste = filtre.split("[", 1)
    operateur, valeur = reste.split("]:", 1)
    return [(champ, operateur, valeur.strip('"'))]


def correspond(record, clause):
    champ, operateur, valeur = clause
    actuel = record.get(champ)
    if operateur == "is":
        vide = actuel in (None, "", [], {})
        return vide if valeur == "NULL" else not vide
    if actuel is None:
        return False
    if operateur == "eq":
        return str(actuel) == valeur
    if champ in CHAMPS_DATE:
        return date(actuel) >= date(valeur) if operateur == "gte" else date(actuel) <= date(valeur)
    raise ValueError(f"opérateur non géré : {champ}[{operateur}]")


class Etat:
    def __init__(self, cle, journal):
        self.cle, self.journal = cle, journal
        self.verrou = threading.Lock()
        self.records = {o: [] for o in OBJETS}
        self.creations = {}
        self.modifications = []
        self.metadata = []
        self.panne = 0
        self.clients, self.codes, self.jetons, self.refresh = {}, {}, {}, {}
        self.revoque = False

    def ecrire(self, **fait):
        fait["t"] = round(time.time(), 3)
        with self.verrou, open(self.journal, "a") as f:
            f.write(json.dumps(fait, ensure_ascii=False) + "\n")

    def valide(self, jeton):
        return jeton == self.cle or (jeton in self.jetons and not self.revoque and self.jetons[jeton] > time.time())

    def jeton_pour(self, client):
        acces, refresh = "acc-" + uuid.uuid4().hex, "ref-" + uuid.uuid4().hex
        self.jetons[acces] = time.time() + 1800
        self.refresh[refresh] = client
        self.revoque = False
        return {"access_token": acces, "token_type": "Bearer", "expires_in": 1800, "refresh_token": refresh}


def fabriquer(etat, base):
    class Gestionnaire(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        def corps(self):
            n = int(self.headers.get("Content-Length") or 0)
            return self.rfile.read(n) if n else b""

        def repondre(self, code, objet=None, brut=None, type_="application/json", entetes=()):
            octets = brut if brut is not None else json.dumps(objet if objet is not None else {}).encode()
            self.send_response(code)
            self.send_header("Content-Type", type_)
            self.send_header("Content-Length", str(len(octets)))
            for k, v in entetes:
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(octets)

        def jeton(self):
            return self.headers.get("Authorization", "").removeprefix("Bearer ").strip()

        def aiguiller(self, methode):
            url = urllib.parse.urlparse(self.path)
            q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query, keep_blank_values=True).items()}
            corps = self.corps()
            chemin = url.path
            if chemin == "/.well-known/oauth-authorization-server":
                return self.repondre(200, {"issuer": base, "authorization_endpoint": base + "/authorize",
                                           "token_endpoint": base + "/oauth/token", "registration_endpoint": base + "/oauth/register"})
            if chemin == "/oauth/register":
                j = json.loads(corps)
                client = "client-" + uuid.uuid4().hex[:12]
                etat.clients[client] = j.get("redirect_uris", [])
                etat.ecrire(evenement="oauth.register", client=client, redirections=etat.clients[client])
                return self.repondre(201, {"client_id": client, "redirect_uris": etat.clients[client]})
            if chemin == "/authorize":
                client, retour = q["client_id"], q["redirect_uri"]
                if retour not in etat.clients.get(client, []):
                    return self.repondre(400, {"error": "redirect_uri mismatch"})
                code = "code-" + uuid.uuid4().hex
                etat.codes[code] = (client, q["code_challenge"], retour)
                etat.ecrire(evenement="oauth.authorize", client=client)
                return self.repondre(302, brut=b"", type_="text/plain", entetes=[
                    ("Location", retour + "?" + urllib.parse.urlencode({"code": code, "state": q["state"]}))])
            if chemin == "/oauth/token":
                f = {k: v[0] for k, v in urllib.parse.parse_qs(corps.decode()).items()}
                if f.get("grant_type") == "authorization_code":
                    client, defi, retour = etat.codes.pop(f.get("code"), (None, None, None))
                    verifie = base64.urlsafe_b64encode(hashlib.sha256(f.get("code_verifier", "").encode()).digest()).rstrip(b"=").decode()
                    if client != f.get("client_id") or verifie != defi:
                        return self.repondre(400, {"error": "invalid_grant"})
                    etat.ecrire(evenement="oauth.jeton", grant="authorization_code")
                    return self.repondre(200, etat.jeton_pour(client))
                if f.get("grant_type") == "refresh_token":
                    if f.get("refresh_token") not in etat.refresh:
                        return self.repondre(400, {"error": "invalid_grant"})
                    etat.ecrire(evenement="oauth.jeton", grant="refresh_token")
                    return self.repondre(200, etat.jeton_pour(etat.refresh[f["refresh_token"]]))
                return self.repondre(400, {"error": "unsupported_grant_type"})
            if not etat.valide(self.jeton()):
                etat.ecrire(evenement="refus.401", chemin=chemin)
                return self.repondre(401, {"error": "unauthorized"})
            if chemin == "/metadata":
                etat.metadata.append(corps.decode()[:300])
                etat.ecrire(evenement="metadata", corps=corps.decode()[:300])
                return self.repondre(200, {"errors": [{"message": "faux CRM", "extensions": {"code": "NOT_FOUND"}}]})
            if etat.panne:
                etat.ecrire(evenement="panne", code=etat.panne, chemin=chemin)
                return self.repondre(etat.panne, {"error": "panne simulée"})
            morceaux = [p for p in chemin.split("/") if p]
            if morceaux[:1] != ["rest"]:
                return self.repondre(404, {"error": "inconnu"})
            if methode == "GET" and len(morceaux) == 2 and morceaux[1] in OBJETS:
                return self.lister(morceaux[1], q)
            if methode == "POST" and len(morceaux) == 3 and morceaux[1] == "batch" and morceaux[2] in OBJETS:
                return self.creer(morceaux[2], json.loads(corps))
            if methode == "PATCH" and len(morceaux) == 3 and morceaux[1] in OBJETS:
                return self.modifier(morceaux[1], morceaux[2], json.loads(corps or b"{}"))
            return self.repondre(404, {"error": "inconnu"})

        def lister(self, pluriel, q):
            filtre = clauses(q.get("filter", ""))
            with etat.verrou:
                lignes = [r for r in etat.records[pluriel] if all(correspond(r, c) for c in filtre)]
            debut = 0
            if q.get("starting_after"):
                debut = next((i + 1 for i, r in enumerate(lignes) if r["id"] == q["starting_after"]), len(lignes))
            limite = int(q.get("limit", 60))
            page = lignes[debut:debut + limite]
            suite = debut + limite < len(lignes)
            self.repondre(200, {"data": {pluriel: page}, "pageInfo": {"hasNextPage": suite, "endCursor": page[-1]["id"] if page else None},
                                "totalCount": len(lignes)})

        def creer(self, pluriel, lot):
            faits = []
            for corps in lot:
                r = dict(corps, id=str(uuid.uuid4()), createdAt=datetime.now(timezone.utc).isoformat())
                with etat.verrou:
                    etat.records[pluriel].append(r)
                    if corps.get("idSource"):
                        etat.creations.setdefault(pluriel + "|" + corps["idSource"], []).append(round(time.time(), 3))
                faits.append(r)
                etat.ecrire(evenement="creation", objet=pluriel, idSource=corps.get("idSource"), personId=corps.get("personId"))
            self.repondre(201, {"data": {"create" + pluriel.capitalize(): faits}})

        def modifier(self, pluriel, ident, champs):
            with etat.verrou:
                r = next((x for x in etat.records[pluriel] if x["id"] == ident), None)
                if r is not None:
                    r.update(champs)
                    etat.modifications.append([pluriel, r.get("idSource"), sorted(champs)])
            if r is None:
                return self.repondre(404, {"error": "introuvable"})
            etat.ecrire(evenement="modification", objet=pluriel, idSource=r.get("idSource"), champs=sorted(champs))
            self.repondre(200, {"data": r})

        def do_GET(self): self.aiguiller("GET")
        def do_POST(self): self.aiguiller("POST")
        def do_PATCH(self): self.aiguiller("PATCH")

    return Gestionnaire


def pilotage(etat):
    class Pilote(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        def repondre(self, objet):
            octets = json.dumps(objet, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(octets)))
            self.end_headers()
            self.wfile.write(octets)

        def tout(self):
            url = urllib.parse.urlparse(self.path)
            n = int(self.headers.get("Content-Length") or 0)
            corps = json.loads(self.rfile.read(n)) if n else {}
            if url.path == "/etat":
                with etat.verrou:
                    return self.repondre({
                        "appels": len(etat.records["appels"]), "textMessages": len(etat.records["textMessages"]),
                        "doublons": {k: len(v) for k, v in etat.creations.items() if len(v) > 1},
                        "creations": {k: v for k, v in etat.creations.items()},
                        "modifications": etat.modifications, "metadata": etat.metadata, "panne": etat.panne,
                        "avec_personne": sum(1 for o in ("appels", "textMessages") for r in etat.records[o] if r.get("personId")),
                        "jetons_emis": len(etat.jetons)})
            if url.path == "/records":
                with etat.verrou:
                    return self.repondre({o: etat.records[o] for o in OBJETS})
            if url.path == "/reinit":
                with etat.verrou:
                    for o in OBJETS:
                        etat.records[o] = []
                    etat.creations, etat.modifications, etat.metadata = {}, [], []
                    etat.panne = 0
                    etat.jetons, etat.refresh, etat.codes, etat.clients, etat.revoque = {}, {}, {}, {}, False
                    for nom, numero in (("Alice", "+33611111111"), ("Bob", "+33622222222")):
                        etat.records["people"].append({"id": str(uuid.uuid4()), "name": {"firstName": nom, "lastName": ""},
                                                       "phones": {"primaryPhoneNumber": numero, "primaryPhoneCallingCode": "",
                                                                  "additionalPhones": []}})
                return self.repondre({"reinit": True})
            if url.path == "/panne":
                etat.panne = int(urllib.parse.parse_qs(url.query).get("code", ["0"])[0])
                return self.repondre({"panne": etat.panne})
            if url.path == "/personne":
                with etat.verrou:
                    etat.records["people"].append({"id": str(uuid.uuid4()), "name": {"firstName": corps["nom"], "lastName": ""},
                                                   "phones": {"primaryPhoneNumber": corps["numero"], "primaryPhoneCallingCode": "",
                                                              "additionalPhones": []}})
                return self.repondre({"personnes": len(etat.records["people"])})
            if url.path == "/oauth/revoquer":
                etat.revoque = True
                return self.repondre({"revoque": True})
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()

        do_GET = do_POST = tout

    return Pilote


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--cle", required=True)
    p.add_argument("--certificat", required=True)
    p.add_argument("--cle-privee", required=True)
    p.add_argument("--ecoute", default="127.0.0.1")
    p.add_argument("--https", type=int, default=8443)
    p.add_argument("--pilotage", type=int, default=8444)
    p.add_argument("--base", default="https://10.0.2.2:8443")
    p.add_argument("--journal", required=True)
    a = p.parse_args()
    etat = Etat(a.cle, a.journal)
    http.server.ThreadingHTTPServer.daemon_threads = True
    pilote = http.server.ThreadingHTTPServer(("127.0.0.1", a.pilotage), pilotage(etat))
    threading.Thread(target=pilote.serve_forever, daemon=True).start()
    serveur = http.server.ThreadingHTTPServer((a.ecoute, a.https), fabriquer(etat, a.base))
    contexte = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    contexte.load_cert_chain(a.certificat, a.cle_privee)
    serveur.socket = contexte.wrap_socket(serveur.socket, server_side=True)
    print(f"faux CRM : https {a.https}, pilotage 127.0.0.1:{a.pilotage}", flush=True)
    serveur.serve_forever()


if __name__ == "__main__":
    main()
