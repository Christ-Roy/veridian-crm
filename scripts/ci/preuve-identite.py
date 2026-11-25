#!/usr/bin/env python3
"""Preuve qu'une personne se désigne par hub_user_id (CONTRAT-HUB §5.19.7), sur un espace jetable : une personne change
d'adresse au Hub, un compte NEUF reprend l'ancienne ; aucun geste visant l'une ne touche l'autre.

  preuve-identite.py <espace jetable (twenty-admin jetable:creer)> [--env staging]

Comptes de test seulement, tous coupés à la fin. Le propriétaire jetable change lui aussi d'adresse, puis la reprend.
Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import json
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402


class Epreuve:
    def __init__(self, a):
        self.a, self.c, self.echecs = a, ta.Client(a.env), []
        acces, p = ta.lire_creds(), ta.prefixe(a.env, a.espace)
        self.tenant = acces.get(f"{p}_JETABLE_TENANT_ID")
        if not self.tenant:
            raise ta.Echec(f"{a.espace} n'est pas un espace jetable", 2)
        self.mail, self.hub = acces[f"{p}_EMAIL"], acces[f"{p}_JETABLE_HUB_USER_ID"]
        self.origine, self.session, self.ws = self.c.session(self.mail, a.espace)

    def controle(self, nom, ok, detail=""):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:240], flush=True)
        if not ok:
            self.echecs.append(nom)

    def poster(self, chemin, corps):
        code, texte, _ = self.c.signe(chemin, corps)
        try:
            return code, json.loads(texte)
        except ValueError:
            return code, {"brut": texte[:120]}

    def sync(self, hub, **champs):
        return self.poster("/api/hub/users/sync", {"hub_user_id": hub, **champs})

    def rattacher(self, hub, mail, **champs):
        return self.poster(f"/api/veridian/workspaces/{self.ws['id']}/attach-member",
                           {"hub_user_id": hub, "email": mail, "hub_user_email": mail, "email_proven": True, "role": "member", **champs})

    def retirer(self, **corps):
        return self.poster(f"/api/tenants/{self.tenant}/remove-member", corps)

    def creer(self, hub, mail):
        return self.poster("/api/tenants/provision", {
            "tenant_id": self.tenant, "owner_hub_user_id": hub, "owner_email": mail, "email_proven": True,
            "workspace_name": "rejeu", "plan": "free", "metadata": {"hub_user_id": hub}})

    def liste(self, **q):
        code, texte, _ = self.c.signe("/api/users/by-email?" + "&".join(f"{k}={quote(v, safe='')}" for k, v in q.items()), None, "GET")
        if code not in (200, 400):
            raise ta.Echec(f"by-email {code}", 2)
        return {w["workspace_id"]: w["role"] for w in json.loads(texte).get("workspaces", [])}

    def membres(self):
        d = self.c.gql(self.origine, "{currentUser{workspaceMembers{userEmail}}}", None, self.session)
        return sorted(m["userEmail"] for m in d["currentUser"]["workspaceMembers"])

    def attendre_membres(self, *attendus):
        fin = time.time() + 30
        while time.time() < fin and not set(attendus) <= set(self.membres()):
            time.sleep(2)
        return set(attendus) <= set(self.membres())

    def jouer(self):
        t = int(time.time())
        jean, neuf, tiers, quatre = (str(uuid.uuid4()) for _ in range(4))
        ancienne, nouvelle = f"e2e-identite-{t}@veridian.site", f"e2e-identite-{t}-bis@veridian.site"
        proprio = self.mail.replace("@", f"-{t}@")
        try:
            self.controle("Jean entre par l'ancienne adresse", self.rattacher(jean, ancienne)[0] == 201)
            r = self.sync(jean, email=nouvelle)
            self.controle("Jean change d'adresse au Hub", r[0] == 200, str(r))
            r = self.rattacher(neuf, ancienne)
            self.controle("un compte neuf reprend l'ancienne adresse", r[0] == 201, str(r)[:80])
            self.controle("les deux sont membres (témoin positif)", self.attendre_membres(nouvelle, ancienne), str(self.membres()))

            r = self.sync(jean, email=ancienne, name="Ecrit Malgré Tout")
            self.controle("adresse d'un autre : 409 email_conflict", r == (409, {"error": "email_conflict"}), str(r))
            d = self.c.gql(self.origine, "{currentUser{workspaceMembers{userEmail name{firstName}}}}", None, self.session)
            noms = {m["userEmail"]: m["name"]["firstName"] for m in d["currentUser"]["workspaceMembers"]}
            self.controle("rien d'écrit avec le conflit (ni nom ni adresse)", nouvelle in noms and "Ecrit" not in noms.values(), str(noms))

            r = self.retirer(email=ancienne)
            self.controle("retrait sans hub_user_id : 400 invalid_payload", r == (400, {"error": "invalid_payload"}), str(r)[:100])
            self.controle("et personne n'est parti", {ancienne, nouvelle} <= set(self.membres()), str(self.membres()))
            r = self.retirer(hub_user_id=tiers, email=ancienne)
            self.controle("retrait d'un inconnu : removed false", r[0] == 200 and r[1].get("removed") is False, str(r)[:100])
            self.controle("et personne n'est parti (2)", {ancienne, nouvelle} <= set(self.membres()), str(self.membres()))
            r = self.retirer(hub_user_id=jean, email=ancienne, user_email=ancienne)
            self.controle("retrait de Jean, son ancienne adresse dans le corps", r[0] == 200 and r[1].get("removed") is True and
                          r[1].get("hub_user_id") == jean, str(r)[:140])
            restants = self.membres()
            self.controle("Jean est parti, le compte neuf reste", nouvelle not in restants and ancienne in restants, str(restants))

            troisieme = f"e2e-identite-{t}-ter@veridian.site"
            self.controle("Jean, parti, change encore d'adresse", self.sync(jean, email=troisieme)[0] == 200)
            r = self.rattacher(quatre, nouvelle)
            self.controle("un autre reprend celle qu'il avait en partant", r[0] == 201, str(r)[:90])
            r = self.rattacher(jean, troisieme)
            self.controle("Jean revient sous son adresse du jour", r[0] == 201 and self.attendre_membres(troisieme, nouvelle), str(r)[:60])

            r = self.rattacher(tiers, ancienne)
            self.controle("adresse reliée à un autre : 409 hub_user_conflict", r == (409, {"error": "hub_user_conflict"}), str(r)[:100])

            self.controle("le propriétaire est propriétaire (témoin positif)", self.liste(hub_user_id=self.hub, email=self.mail).get(self.ws["id"]) == "owner")
            self.controle("le propriétaire change d'adresse", self.sync(self.hub, email=proprio)[0] == 200, proprio)
            r = self.rattacher(tiers, self.mail)
            self.controle("un autre compte neuf reprend celle du propriétaire", r[0] == 201, str(r)[:80])
            self.controle("le propriétaire le reste", self.liste(hub_user_id=self.hub).get(self.ws["id"]) == "owner", str(self.liste(hub_user_id=self.hub)))
            self.controle("propriétaire aussi sous sa nouvelle adresse", self.liste(email=proprio).get(self.ws["id"]) == "owner")
            self.controle("celui qui a repris l'adresse ne l'est pas", self.liste(hub_user_id=tiers).get(self.ws["id"]) == "member" and
                          self.liste(email=self.mail).get(self.ws["id"]) == "member", str(self.liste(email=self.mail)))
            r = self.creer(self.hub, proprio)
            self.controle("création rejouée, même propriétaire, autre adresse : 200", r[0] == 200 and r[1].get("created") is False, str(r)[:90])
            r = self.creer(tiers, self.mail)
            self.controle("création rejouée par un autre : 409 owner_mismatch", r == (409, {"error": "owner_mismatch"}), str(r)[:90])
        finally:
            for hub, mail in ((jean, nouvelle), (neuf, ancienne), (tiers, self.mail), (quatre, nouvelle)):
                self.retirer(hub_user_id=hub, email=mail)
                self.sync(hub, deleted=True)
            # L'adresse d'un compte coupé reste prise : le propriétaire jetable garde la sienne, son espace est retiré juste après.


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--env", default="staging", choices=("staging", "prod"))
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
