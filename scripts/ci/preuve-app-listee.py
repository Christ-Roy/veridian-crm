#!/usr/bin/env python3
"""Preuve du catalogue d'instance, staging seulement : une app publiée par un espace ne s'installe et ne s'exécute dans un
autre espace que si l'administrateur d'INSTANCE l'a listée.

  preuve-app-listee.py <editeur> <autre> --admin <email admin d'instance> --uid <app> --outil <app_xxx> [--garder]

<autre> n'a aucun couple pour l'app. Épreuves : non listée (installation refusée, absente de Disponibles), drapeau refusé à
l'éditeur et à une clé, listée (visible, installée, outil exécuté), délistée (exécution refusée), relistée. Puis l'app est
désinstallée de <autre> et remise dans l'état de départ, sauf --garder.
Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402


class Epreuve:
    def __init__(self, a):
        self.a, self.c, self.echecs = a, ta.Client("staging"), []
        self.url, self.cle = ta._cle("staging", a.autre)
        self.url_ed, self.cle_ed = ta._cle("staging", a.editeur)
        self.origine, self.session, _ = self.c.session(a.admin, a.editeur)
        self.reg = ta._registre(self.c, self.url_ed, self.cle_ed, a.uid)
        if not self.reg or self.reg["sourceType"] != "TARBALL":
            raise ta.Echec(f"{a.uid} n'est pas publiée en TARBALL", 2)
        self.depart = self.drapeaux()["isListed"]

    def controle(self, nom, ok, detail=""):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:280])
        if not ok:
            self.echecs.append(nom)

    def drapeaux(self):
        return self.c.gql(self.origine, "query($i:String!){findOneAdminApplicationRegistration(id:$i){isListed isPreInstalled}}",
                          {"i": self.reg["id"]}, self.session, "/admin-panel")["findOneAdminApplicationRegistration"]

    def lister(self, valeur):
        self.c.gql(self.origine, "mutation($i:AdminUpdateApplicationRegistrationInput!){updateAdminApplicationRegistration(input:$i){id}}",
                   {"i": {"id": self.reg["id"], "update": {"isListed": valeur}}}, self.session, "/admin-panel")
        if self.drapeaux()["isListed"] is not valeur:
            raise ta.Echec("le drapeau n'a pas pris", 2)

    def cle_gql(self, requete, variables=None, editeur=False, chemin="/metadata"):
        url, cle = (self.url_ed, self.cle_ed) if editeur else (self.url, self.cle)
        return ta._gql_cle(self.c, url, cle, requete, variables, chemin)

    def refusee(self, nom, f):
        try:
            r = f()
        except ta.Echec as e:
            return self.controle(nom, e.code == 1, str(e))
        self.controle(nom, False, f"acceptée : {json.dumps(r)[:120]}")

    def installer(self):
        return self.cle_gql("mutation($u:String!){installApplication(universalIdentifier:$u){id version}}", {"u": self.a.uid})

    def visible(self):
        # le cache du catalogue vit quelques secondes
        d = self.cle_gql("{findManyMarketplaceApps{id name}}")["findManyMarketplaceApps"]
        return [x["id"] for x in d if x["id"] in (self.a.uid, self.reg["id"])]

    def attendre_visible(self, attendu, secondes=120):
        fin = time.time() + secondes
        while time.time() < fin:
            if bool(self.visible()) is attendu:
                return True
            time.sleep(5)
        return False

    def outil(self):
        corps = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": self.a.outil, "arguments": {}}}
        code, texte, _ = self.c.http(self.url + "/mcp", json.dumps(corps).encode(), {
            "Authorization": f"Bearer {self.cle}", "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream"})
        return next((x[5:] for x in texte.splitlines() if x.startswith("data:")), texte)

    def execute(self):
        r = self.outil()
        return "not allowed to run code" not in r and "not found" not in r and "erreur" in r, r[:220]

    def jouer(self):
        self.lister(False)
        self.controle("non listée : absente de Disponibles", self.attendre_visible(False), str(self.visible()))
        self.refusee("non listée : installation refusée", self.installer)
        m = "mutation($i:AdminUpdateApplicationRegistrationInput!){updateAdminApplicationRegistration(input:$i){id}}"
        v = {"i": {"id": self.reg["id"], "update": {"isListed": True}}}
        self.refusee("drapeau par la clé Admin de l'éditeur : refusé", lambda: self.cle_gql(m, v, editeur=True, chemin="/admin-panel"))
        m2 = "mutation($i:UpdateApplicationRegistrationInput!){updateApplicationRegistration(input:$i){id}}"
        self.refusee("drapeau par la mutation du propriétaire : refusé", lambda: self.cle_gql(m2, v, editeur=True))
        self.controle("toujours non listée", self.drapeaux()["isListed"] is False)

        self.lister(True)
        self.controle("listée : visible dans Disponibles", self.attendre_visible(True), str(self.visible()))
        i = self.installer()["installApplication"]
        self.controle("listée : installée sans couple", bool(i["id"]), i["version"])
        ok, r = self.execute()
        self.controle("listée : la fonction s'exécute", ok, r)

        self.lister(False)
        ok, r = self.execute()
        self.controle("délistée : la fonction ne s'exécute plus", not ok, r)
        self.lister(True)
        ok, r = self.execute()
        self.controle("relistée : la fonction s'exécute", ok, r)

    def ranger(self):
        if self.a.garder:
            return
        try:
            self.cle_gql("mutation($u:String!){uninstallApplication(universalIdentifier:$u)}", {"u": self.a.uid})
        except ta.Echec as e:
            print(f"désinstallation : {e}")
        self.lister(self.depart)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("editeur")
    p.add_argument("autre")
    p.add_argument("--admin", required=True)
    p.add_argument("--uid", required=True)
    p.add_argument("--outil", required=True)
    p.add_argument("--garder", action="store_true")
    a = p.parse_args()
    e = None
    try:
        e = Epreuve(a)
        e.jouer()
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code
    finally:
        if e:
            e.ranger()
    print("VERDICT :", "catalogue conforme" if not e.echecs else f"ÉCHEC {e.echecs}")
    return 0 if not e.echecs else 1


if __name__ == "__main__":
    sys.exit(main())
