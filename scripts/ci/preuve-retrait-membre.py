#!/usr/bin/env python3
"""Preuve qu'un membre retiré par le Hub ne ferme pas l'espace aux autres (VER-203), depuis le bastion.

Dans un espace de test : attache un compte jetable par la route signée du Hub, le retire, le rattache, le retire de
nouveau, puis coupe le compte. À chaque étape, l'admin doit charger son compte (la requête de l'écran, GetCurrentUser).

  preuve-retrait-membre.py <ss-dom> --email <admin> [--env staging|prod] [--reparer]

--reparer rejoue d'abord remove-member sur les fiches e2e-sso-*-role-mcp@veridian.site restées orphelines.
Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
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
        self.c = ta.Client(a.env)
        self.origine, self.jeton, self.ws = self.c.session(a.email, a.espace)
        self.echecs = []
        espaces = [w for w in self.par_email(a.email) if w["subdomain"] == a.espace]
        if not espaces or not espaces[0].get("tenant_id"):
            raise ta.Echec(f"{a.espace} n'a pas de lien tenant Hub", 2)
        self.tenant = espaces[0]["tenant_id"]

    def par_email(self, email):
        code, texte, _ = self.c.signe(f"/api/users/by-email?email={email.replace('+', '%2B')}", None, "GET")
        if code != 200:
            raise ta.Echec(f"by-email {code}", 2)
        return ta.json.loads(texte)["workspaces"]

    def controle(self, nom, ok, detail=""):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:260])
        if not ok:
            self.echecs.append(nom)

    def membres(self):
        """Adresses vues par l'écran de l'admin, ou l'erreur qui l'empêche de se charger."""
        try:
            d = self.c.gql(self.origine, "{currentUser{workspaceMembers{id userEmail}}}", None, self.jeton)
        except ta.Echec as e:
            return None, str(e)
        return [m["userEmail"] for m in d["currentUser"]["workspaceMembers"]], ""

    def charge(self, quand, present=None, absent=None):
        vus, erreur = self.membres()
        ok = vus is not None and (present is None or present in vus) and (absent is None or absent not in vus)
        self.controle(f"l'admin charge l'espace, {quand}", ok, erreur or f"{len(vus)} membre(s)")

    def attacher(self, hub, email, attendu):
        code, texte, _ = self.c.signe(f"/api/veridian/workspaces/{self.ws['id']}/attach-member",
                                      {"hub_user_id": hub, "hub_user_email": email, "role": "member"})
        self.controle("attach-member", code == attendu, f"{code} {texte[:80]}" if code != attendu else str(code))

    def retirer(self, email):
        code, texte, _ = self.c.signe(f"/api/tenants/{self.tenant}/remove-member", {"email": email})
        return code == 200, ta.json.loads(texte).get("removed") if code == 200 else texte[:80]

    def fiches(self, email):
        d = self.c.gql(self.origine, "query($e:String!){workspaceMembers(filter:{userEmail:{eq:$e}}){edges{node{id}}}}",
                       {"e": email}, self.jeton, "/graphql")
        return [x["node"]["id"] for x in d["workspaceMembers"]["edges"]]

    def entre(self, email):
        try:
            self.c.session(email, self.ws["subdomain"])
            return True
        except ta.Echec:
            return False


def reparer(e):
    d = e.c.gql(e.origine, "{workspaceMembers(first:60){edges{node{userEmail}}}}", None, e.jeton, "/graphql")
    actifs = {(u.get("email") or "").lower() for u in e.c.utilisateurs()}
    cibles = [x["node"]["userEmail"] for x in d["workspaceMembers"]["edges"]]
    cibles = [m for m in cibles if m.startswith("e2e-sso-") and m.endswith("-role-mcp@veridian.site") and m not in actifs]
    vus, erreur = e.membres()
    print(f"avant réparation : {erreur or f'{len(vus)} membre(s)'} ; {len(cibles)} fiche(s) à réparer")
    for m in cibles:
        ok, removed = e.retirer(m)
        e.controle(f"réparation {m}", ok and not e.fiches(m), f"removed={removed}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--email", required=True)
    p.add_argument("--env", choices=["staging", "prod"], default="staging")
    p.add_argument("--reparer", action="store_true")
    a = p.parse_args()
    hub = str(uuid.uuid4())
    email = f"e2e-retrait-{int(time.time())}@veridian.site"
    e = None
    try:
        e = Epreuve(a)
        if a.reparer:
            reparer(e)
        e.charge("au départ", absent=email)
        e.attacher(hub, email, 201)
        e.charge("membre attaché", present=email)
        fiche = e.fiches(email)
        e.controle("le membre entre", e.entre(email))
        ok, removed = e.retirer(email)
        e.controle("remove-member", ok and removed is True, f"removed={removed}")
        e.charge("membre retiré", absent=email)
        e.controle("le membre n'entre plus", not e.entre(email))
        e.attacher(hub, email, 201)
        e.charge("membre rattaché", present=email)
        e.controle("la même fiche est restaurée", bool(fiche) and e.fiches(email) == fiche, f"{len(fiche)} fiche(s)")
        e.controle("le membre rattaché entre", e.entre(email))
        code, _, _ = e.c.signe("/api/hub/users/sync", {"hub_user_id": hub, "deleted": True})
        e.controle("users/sync deleted", code == 200, str(code))
        e.charge("compte coupé au Hub", absent=email)
        e.controle("le compte coupé n'entre plus", not e.entre(email))
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code
    finally:
        if e:
            e.retirer(email)
            e.c.signe("/api/hub/users/sync", {"hub_user_id": hub, "deleted": True})
    print("VERDICT :", "retrait sûr" if not e.echecs else f"ÉCHEC {e.echecs}")
    return 0 if not e.echecs else 1


if __name__ == "__main__":
    sys.exit(main())
