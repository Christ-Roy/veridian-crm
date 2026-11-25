#!/usr/bin/env python3
"""Preuve que l'administration d'instance suit la personne, jamais l'adresse, sur le staging seulement.

  preuve-admins.py <espace jetable> --admin <adresse d'un administrateur de test listé> --chez <son espace> [--avant]

L'administrateur change d'adresse au Hub, une personne de test prend l'ancienne et entre dans l'espace jetable : elle n'obtient
rien ; lui garde le droit, même en créant un espace sous sa nouvelle adresse. Tout est remis. --avant : image antérieure, sans
la création d'espace (elle lui retirerait le droit). Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402


class Epreuve:
    def __init__(self, a):
        self.a, self.c, self.echecs = a, ta.Client("staging"), []
        acces, p = ta.lire_creds(), ta.prefixe("staging", a.espace)
        if not acces.get(f"{p}_JETABLE_TENANT_ID"):
            raise ta.Echec(f"{a.espace} n'est pas un espace jetable", 2)
        self.proprio = acces[f"{p}_EMAIL"]
        _, _, self.ws = self.c.session(self.proprio, a.espace)
        self.admin = next((u["hub_user_id"] for u in self.c.utilisateurs() if u["email"].lower() == a.admin.lower()), None)
        if not self.admin:
            raise ta.Echec("administrateur de test introuvable", 2)

    def controle(self, nom, ok, detail=""):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:200], flush=True)
        if not ok:
            self.echecs.append(nom)

    def droits(self, adresse, espace):
        origine, jeton, _ = self.c.session(adresse, espace)
        u = self.c.gql(origine, "{currentUser{canAccessFullAdminPanel canImpersonate}}", None, jeton)["currentUser"]
        return bool(u["canAccessFullAdminPanel"]), bool(u["canImpersonate"])

    def sync(self, hub, **champs):
        return self.c.signe("/api/hub/users/sync", {"hub_user_id": hub, **champs})[0]

    def jouer(self):
        a, t = self.a, int(time.time())
        ailleurs = a.admin.replace("@", f"-{t}@")
        personne, libre, tenant = str(uuid.uuid4()), f"e2e-admins-{t}@veridian.site", str(uuid.uuid4())
        self.controle("l'administrateur l'est (témoin positif)", self.droits(a.admin, a.chez) == (True, True))
        self.controle("un propriétaire d'espace ne l'est pas (témoin)", self.droits(self.proprio, a.espace) == (False, False))
        try:
            self.controle("il change d'adresse au Hub", self.sync(self.admin, email=ailleurs) == 200)
            code, texte, _ = self.c.signe(f"/api/veridian/workspaces/{self.ws['id']}/attach-member", {
                "hub_user_id": personne, "email": a.admin, "hub_user_email": a.admin, "email_proven": True, "role": "member"})
            self.controle("une autre personne prend l'adresse listée", code == 201, f"{code} {texte[:60]}")
            r = self.droits(a.admin, a.espace)
            self.controle("elle n'obtient rien", r == (False, False), str(r))
            r = self.droits(ailleurs, a.chez)
            self.controle("lui garde le droit", r == (True, True), str(r))
            if not a.avant:
                code, texte, _ = self.c.signe("/api/tenants/provision", {
                    "tenant_id": tenant, "owner_hub_user_id": self.admin, "owner_email": ailleurs, "email_proven": True,
                    "workspace_name": "preuve admins", "plan": "free", "metadata": {"hub_user_id": self.admin}})
                self.controle("il crée un espace sous sa nouvelle adresse", code == 200, f"{code} {texte[:60]}")
                r = self.droits(ailleurs, a.chez)
                self.controle("et le garde encore", r == (True, True), str(r))
                dits = [u["hub_user_id"] for u in self.c.utilisateurs() if u.get("server_admin")]
                self.controle("la liste le dit, lui et pas elle", self.admin in dits and personne not in dits, f"{len(dits)} administrateur(s)")
        finally:
            if not a.avant:
                self.c.signe(f"/api/tenants/{tenant}", None, "DELETE")
            self.sync(personne, email=libre)
            self.sync(personne, deleted=True)
            remis = self.sync(self.admin, email=a.admin)
            self.controle("adresse de l'administrateur remise", remis == 200 and self.droits(a.admin, a.chez) == (True, True), str(remis))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--admin", required=True)
    p.add_argument("--chez", required=True)
    p.add_argument("--avant", action="store_true")
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
