#!/usr/bin/env python3
"""Preuve du document d'organisation du Hub (CONTRAT-HUB §5.19.6) sur un espace jetable : nom choisi, membres additifs, version.

  preuve-organisation.py <espace jetable (twenty-admin jetable:creer)> [--env staging] [--logo <url servie par le Hub>]

Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import json
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

ROUTE = "/api/hub/organisations/sync"


def iso(delta=0):
    return (datetime.now(timezone.utc) + timedelta(seconds=delta)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class Epreuve:
    def __init__(self, a):
        self.a, self.c, self.echecs = a, ta.Client(a.env), []
        creds, p = ta.lire_creds(), ta.prefixe(a.env, a.espace)
        self.tenant = creds.get(f"{p}_JETABLE_TENANT_ID")
        if not self.tenant:
            raise ta.Echec(f"{a.espace} n'est pas un espace jetable", 2)
        self.email = creds[f"{p}_EMAIL"]
        self.origine, self.session, self.ws = self.c.session(self.email, a.espace)
        self.version = int(time.time() * 1000)

    def controle(self, nom, ok, detail=""):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:260])
        if not ok:
            self.echecs.append(nom)

    def pousser(self, membres=(), nom=None, logo=None, version=None, tenant=None):
        if version is None:
            self.version += 1
            version = self.version
        code, texte, _ = self.c.signe(ROUTE, {
            "hub_tenant_id": tenant or self.tenant, "version": version, "nom": "nom du compte", "type": "organisation",
            "marque": {"nom_affiche": nom, "logo_url": logo, "couleur_primaire": "#112233", "couleur_accent": None},
            "modules": ["crm"], "membres": list(membres), "reglages": {}})
        try:
            return code, json.loads(texte)
        except ValueError:
            raise ta.Echec(f"sync {code} {texte[:100]}", 2)

    def relire(self):
        code, texte, _ = self.c.signe(f"{ROUTE}?hub_tenant_id={self.tenant}", None, "GET")
        return code, json.loads(texte)

    def espace(self):
        return self.c.gql(self.origine, "{currentWorkspace{displayName logo}}", jeton=self.session)["currentWorkspace"]

    def appartient(self, mail):
        code, texte, _ = self.c.signe(f"/api/users/by-email?email={mail.replace('+', '%2B')}", None, "GET")
        if code != 200:
            raise ta.Echec(f"by-email {code}", 2)
        return self.ws["id"] in texte

    def role(self, mail):
        d = self.c.gql(self.origine, "{getRoles{label workspaceMembers{userEmail}}}", jeton=self.session)
        return [r["label"] for r in d["getRoles"] if any(m["userEmail"] == mail for m in r["workspaceMembers"])]

    def jouer(self):
        hub, mail = str(uuid.uuid4()), f"e2e-organisation-{int(time.time())}@veridian.site"

        def membre(**k):
            return {"hub_user_id": hub, "email": mail, "email_proven": True, "name": "E2E", "role": "member", "joined_at": iso(-60), **k}

        try:
            code, _, _ = self.c.http(self.c.base + ROUTE, b"{}", {"Content-Type": "application/json"})
            self.controle("sans signature : refusé", code == 401, str(code))
            r = self.pousser(tenant=str(uuid.uuid4()))
            self.controle("organisation inconnue : 404", r == (404, {"error": "tenant_not_linked"}), str(r))
            avant = self.espace()
            r = self.pousser()
            self.controle("nom du compte : appliqué sans renommer", r[0] == 200 and r[1].get("applied") and
                          self.espace()["displayName"] == avant["displayName"], str(r))
            relu = self.relire()
            self.controle("relu", relu == (200, {"version": self.version}), str(relu))
            choisi = f"Choisi {int(time.time())}"
            r = self.pousser(nom=choisi)
            self.controle("nom choisi : l'espace se renomme", r[1].get("applied") and self.espace()["displayName"] == choisi, str(r))
            r = self.pousser()
            self.controle("nom nul : rien ne se vide", r[1].get("applied") and self.espace()["displayName"] == choisi, str(r))
            r = self.pousser(nom="Rejoué", version=self.version)
            self.controle("même version : unchanged", r[1] == {"applied": False, "reason": "unchanged"}, str(r))
            r = self.pousser(nom="Ancien", version=self.version - 1)
            self.controle("version ancienne : stale, sans effet", r[1] == {"applied": False, "reason": "stale"} and
                          self.espace()["displayName"] == choisi, str(r))
            r = self.pousser(logo="https://ailleurs.example/logo.png")
            self.controle("logo d'ailleurs : refusé", r == (422, {"error": "logo_not_from_hub"}), str(r))

            r = self.pousser([membre(email_proven=False)])
            self.controle("adresse non prouvée : écartée et comptée", r[1].get("refused") == 1 and not self.appartient(mail), str(r))
            r = self.pousser([membre()])
            self.controle("membre du document : rattaché", r[1].get("attached") == 1 and self.appartient(mail), str(r))
            roles = self.role(mail)
            r = self.pousser([membre(role="admin")])
            self.controle("présent : rôle inchangé", r[1].get("attached") == 0 and bool(roles) and self.role(mail) == roles, f"{roles} {r}")
            r = self.pousser()
            self.controle("absent du document : pas retiré", r[1].get("applied") and self.appartient(mail), str(r))
            self.c.signe(f"/api/tenants/{self.tenant}/remove-member", {"email": mail})
            self.controle("retiré par le Hub", not self.appartient(mail))
            r = self.pousser([membre()])
            self.controle("retiré : une vieille adhésion ne le ramène pas", r[1].get("refused") == 1 and not self.appartient(mail), str(r))
            r = self.pousser([membre(joined_at=iso(5))])
            self.controle("nouvelle adhésion : il revient", r[1].get("attached") == 1 and self.appartient(mail), str(r))
            if self.a.logo:
                r = self.pousser(logo=self.a.logo)
                e = self.espace()
                self.controle("logo du Hub : posé", r[1].get("applied") is True and e["logo"] and e["logo"] != avant["logo"], str(r))
                self.pousser()
                self.controle("logo nul : il reste", bool(self.espace()["logo"]))
        finally:
            self.c.signe(f"/api/tenants/{self.tenant}/remove-member", {"email": mail})
            self.c.signe("/api/hub/users/sync", {"hub_user_id": hub, "deleted": True})


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--env", default="staging", choices=("staging", "prod"))
    p.add_argument("--logo")
    try:
        e = Epreuve(p.parse_args())
        e.jouer()
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code
    print("VERDICT :", "conforme" if not e.echecs else f"ÉCHEC {e.echecs}")
    return 0 if not e.echecs else 1


if __name__ == "__main__":
    sys.exit(main())
