#!/usr/bin/env python3
"""Preuve qu'un membre retiré par le Hub perd l'espace tout de suite, session ouverte comprise, sur deux espaces jetables.

  preuve-retrait-session.py <espace A> <autre espace B> [--env staging] [--sonde 60]

La personne est membre de A et de B ; un second membre de A sert de témoin. Elle a ouvert : jeton, cookie de session, jeton de
rafraîchissement, MCP, flux en direct. Le Hub la retire de A. Après le 200 : tout est refusé dans A, rien n'arrive par le flux ;
B, le témoin et le propriétaire ne bougent pas. Revenue, elle entre par une session neuve, les anciennes restent mortes.
Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import importlib.util
import json
import sys
import threading
import time
import urllib.request
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

spec = importlib.util.spec_from_file_location("preuve_suspension", Path(__file__).with_name("preuve-suspension.py"))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

FLUX = ("subscription($i:String!){onEventSubscription(eventStreamId:$i){objectRecordEventsWithQueryIds{queryIds "
        "objectRecordEvent{action objectNameSingular recordId properties{after}}}}}")
LECTURE = "{companies(first:1){edges{node{id name}}}}"
IDENTITE = "{currentUser{id currentUserWorkspace{id}}}"


class Retrait(base.Epreuve):
    def membre(self, *tenants):
        hub, mail = str(uuid.uuid4()), f"e2e-retrait-{uuid.uuid4().hex[:8]}@veridian.site"
        for tenant in tenants:
            code, texte = self.rattacher(tenant, hub, mail)
            if code != 201:
                raise ta.Echec(f"attach-member {code} {texte[:80]}", 2)
        return hub, mail

    def rattacher(self, espace, hub, mail):
        code, texte, _ = self.c.signe(f"/api/veridian/workspaces/{espace}/attach-member", {
            "hub_user_id": hub, "email": mail, "hub_user_email": mail, "email_proven": True, "role": "member"})
        return code, texte

    def cookie(self, hub, mail, origine):
        """Session de navigateur : le même rebond, en demandant le cookie plutôt que les jetons."""
        _, texte, _ = self.rebond(mail, hub, origine)
        _, _, entetes = self.c.http(json.loads(texte)["magic_link_url"])
        jeton = parse_qs(urlparse(entetes.get("Location") or "").query)["loginToken"][0]
        corps = {"query": "mutation($l:String!,$o:String!){getAuthTokensFromLoginToken(loginToken:$l,origin:$o){tokens{refreshToken{token}}}}",
                 "variables": {"l": jeton, "o": origine}}
        _, _, entetes = self.c.http(origine + "/metadata", json.dumps(corps).encode(),
                                    {"Content-Type": "application/json", "Origin": origine, "x-twenty-session-cookie": "1"})
        return "; ".join(x.split(";")[0] for x in entetes.get_all("Set-Cookie") or [] if "twenty-session" in x)

    def entetes(self, origine, jeton=None, cookie=None):
        e = {"Content-Type": "application/json", "Origin": origine}
        if jeton:
            e["Authorization"] = f"Bearer {jeton}"
        if cookie:
            e.update({"Cookie": cookie, "x-twenty-session-cookie": "1"})
        return e

    def lire(self, origine, jeton=None, cookie=None, chemin="/graphql", requete=LECTURE):
        code, texte, _ = self.c.http(origine + chemin, json.dumps({"query": requete}).encode(), self.entetes(origine, jeton, cookie))
        try:
            d = json.loads(texte)
        except ValueError:
            return False
        return code == 200 and bool(d.get("data")) and not d.get("errors")

    def ouvrir_flux(self, origine, jeton, recus):
        ident = str(uuid.uuid4())
        req = urllib.request.Request(origine + "/metadata", data=json.dumps({"query": FLUX, "variables": {"i": ident}}).encode(),
                                     headers={**self.entetes(origine, jeton), "Accept": "text/event-stream"})

        def ecouter():
            try:
                with urllib.request.urlopen(req, timeout=300) as r:
                    for ligne in r:
                        if ligne.startswith(b"data:") and len(ligne) > 8:
                            d = json.loads(ligne[5:])
                            for e in ((d.get("data") or {}).get("onEventSubscription") or {}).get("objectRecordEventsWithQueryIds") or []:
                                recus.append((time.time(), e["objectRecordEvent"]["recordId"], bool(e["objectRecordEvent"]["properties"].get("after"))))
            except Exception as e:  # noqa: BLE001
                recus.append((time.time(), f"fermé : {type(e).__name__}", False))

        threading.Thread(target=ecouter, daemon=True).start()
        fin = time.time() + 20
        while time.time() < fin:
            time.sleep(1)
            try:
                self.c.gql(origine, "mutation($i:AddQuerySubscriptionInput!){addQueryToEventStream(input:$i)}",
                           {"i": {"eventStreamId": ident, "queryId": "q", "operationSignature": {"objectNameSingular": "company", "variables": {}}}}, jeton)
                return
            except ta.Echec:
                pass
        raise ta.Echec("le flux en direct ne s'ouvre pas", 2)

    def recu(self, recus, ident, secondes=20):
        fin = time.time() + secondes
        while time.time() < fin:
            if any(r[1] == ident for r in recus):
                return True
            time.sleep(0.5)
        return False

    def jouer(self):
        a = self.a
        self.cle_id = self.hook_id = None
        creer = "mutation($d:CompanyCreateInput!){createCompany(data:$d){id}}"

        def societe(nom):
            return self.c.gql(self.origine, creer, {"d": {"name": nom}}, self.session_a, "/graphql")["createCompany"]["id"]

        ws_b = self.c.gql(self.origine_b, "{currentWorkspace{id}}", jeton=self.session_b)["currentWorkspace"]["id"]
        hub, mail = self.membre(self.ws["id"], ws_b)
        hub_t, mail_t = self.membre(self.ws["id"])
        try:
            _, jeton, _ = self.c.session(mail, a.espace)
            _, jeton_b, _ = self.c.session(mail, a.temoin)
            _, jeton_t, _ = self.c.session(mail_t, a.espace)
            cookie, cookie_b = self.cookie(hub, mail, self.origine), self.cookie(hub, mail, self.origine_b)
            self.rafraichir = self.jeton_long(mail, hub, self.origine)
            self.rafraichir_b = self.jeton_long(mail, hub, self.origine_b)
            flux, flux_t = [], []
            self.ouvrir_flux(self.origine, jeton, flux)
            self.ouvrir_flux(self.origine, jeton_t, flux_t)

            portes = {
                "jeton (GraphQL)": lambda: self.lire(self.origine, jeton),
                "jeton (REST)": lambda: self.rest(self.origine, jeton)[0] == 200,
                "jeton (identité)": lambda: self.lire(self.origine, jeton, chemin="/metadata", requete=IDENTITE),
                "jeton (MCP)": lambda: self.mcp(self.origine, jeton)[1] > 0,
                "cookie (GraphQL)": lambda: self.lire(self.origine, cookie=cookie),
            }
            for nom, essai in portes.items():
                self.controle(f"avant : {nom} ouvert (témoin positif)", essai())
            ident = societe("Avant retrait")
            self.controle("avant : le flux reçoit (témoin positif)", self.recu(flux, ident) and self.recu(flux_t, ident))

            t = time.time()
            code, texte, _ = self.c.signe(f"/api/tenants/{self.tenant}/remove-member", {"hub_user_id": hub, "email": mail})
            debut = time.time()
            self.controle("retrait par le Hub : 200, removed", code == 200 and json.loads(texte).get("removed") is True, f"{debut - t:.1f} s")

            derniers, comptes, verrou = {}, {}, threading.Lock()

            def sonder(nom, essai):
                while time.time() - debut < a.sonde:
                    depart = time.time() - debut
                    ouvert = essai()
                    with verrou:
                        comptes[nom] = comptes.get(nom, 0) + 1
                        if ouvert:
                            derniers[nom] = depart
                    time.sleep(0.4)

            fils = [threading.Thread(target=sonder, args=x) for x in portes.items()]
            for f in fils:
                f.start()
            ok, detail = self.renouveler(self.origine, self.rafraichir)
            self.controle("rafraîchissement refusé", not ok, detail)
            apres = []
            while time.time() - debut < a.sonde:
                apres.append(societe(f"Après retrait {len(apres)}"))
                time.sleep(3)
            for f in fils:
                f.join()
            for nom in portes:
                self.controle(f"après : {nom} fermé", nom not in derniers,
                              f"{comptes[nom]} essais" if nom not in derniers else f"ENCORE OUVERT, dernière lecture {derniers[nom]:.1f} s après le 200")
            self.recu(flux_t, apres[-1])
            vus, vus_t = {r[1] for r in flux} & set(apres), {r[1] for r in flux_t} & set(apres)
            self.controle("après : rien n'arrive par son flux", not vus, f"{len(vus)} fiche(s) sur {len(apres)}, témoin {len(vus_t)}")
            self.controle("témoin : le flux du second membre reçoit tout", len(vus_t) == len(apres), f"{len(vus_t)} sur {len(apres)}")
            self.controle("témoin : le second membre lit", self.lire(self.origine, jeton_t))
            self.controle("témoin : le propriétaire lit", self.lire(self.origine, self.session_a))
            self.controle("autre espace : jeton", self.lire(self.origine_b, jeton_b))
            self.controle("autre espace : cookie", self.lire(self.origine_b, cookie=cookie_b))
            ok, detail = self.renouveler(self.origine_b, self.rafraichir_b)
            self.controle("autre espace : rafraîchissement", ok, detail)
            st, _, _ = self.rebond(mail, hub, self.origine)
            self.controle("rebond vers A sans entrée", not self.entree(mail, a.espace), f"HTTP {st}")

            code, texte = self.rattacher(self.ws["id"], hub, mail)
            self.controle("elle revient : rattachée", code == 201, texte[:60])
            _, neuf, _ = self.c.session(mail, a.espace)
            self.controle("session neuve : elle lit", self.lire(self.origine, neuf))
            time.sleep(1)
            for nom, essai in portes.items():
                self.controle(f"revenue : l'ancienne session reste morte, {nom}", not essai())
            ok, detail = self.renouveler(self.origine, self.rafraichir)
            self.controle("revenue : l'ancien rafraîchissement reste mort", not ok, detail)
        finally:
            for h, m in ((hub, mail), (hub_t, mail_t)):
                self.c.signe(f"/api/tenants/{self.tenant}/remove-member", {"hub_user_id": h, "email": m})
                self.c.signe("/api/hub/users/sync", {"hub_user_id": h, "deleted": True})

    def entree(self, mail, espace):
        try:
            self.c.session(mail, espace)
            return True
        except ta.Echec:
            return False


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("temoin")
    p.add_argument("--env", default="staging", choices=("staging", "prod"))
    p.add_argument("--sonde", type=int, default=60)
    a = p.parse_args()
    a.sans_ecran, a.attente = True, 20
    try:
        e = Retrait(a, None)
        e.jouer()
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code
    print("VRAI : retrait immédiat, dans cet espace seulement" if not e.echecs else f"FAUX : {len(e.echecs)} contrôle(s) : {', '.join(e.echecs)}")
    return 0 if not e.echecs else 1


if __name__ == "__main__":
    sys.exit(main())
