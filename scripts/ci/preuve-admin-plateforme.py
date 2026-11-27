#!/usr/bin/env python3
"""Preuve de l'administrateur de plateforme (VER-263, CONTRAT-HUB §5.23) sur un espace jetable, depuis le bastion.

Sans signature : 401 (POST et GET). Signé : le propriétaire est lu « owner » et refusé (409 is_owner) ; un inconnu est
refusé (404) ; un membre rattaché reçoit le rôle Admin natif ; le propriétaire le lui retire à l'écran (mutation native) :
la lecture dit `admin_withdrawn`, un nouveau grant rend 409 ; seul `reinstate` le remet ; `revoke` le rend membre.

  preuve-admin-plateforme.py <ss-dom jetable> --email <propriétaire> [--env staging|prod]

Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

ROUTE = "/api/hub/workspace-admins"


class Epreuve:
    def __init__(self, a):
        self.c = ta.Client(a.env)
        self.origine, self.jeton, self.ws = self.c.session(a.email, a.espace)
        self.echecs = []
        espaces = [w for w in self.par_email(a.email) if w["subdomain"] == a.espace]
        if not espaces or not espaces[0].get("tenant_id"):
            raise ta.Echec(f"{a.espace} n'a pas de lien tenant Hub", 2)
        self.tenant = espaces[0]["tenant_id"]
        proprio = [u for u in self.c.utilisateurs() if (u.get("email") or "").lower() == a.email.lower()]
        if not proprio or not proprio[0].get("hub_user_id"):
            raise ta.Echec("propriétaire sans hub_user_id", 2)
        self.proprio = proprio[0]["hub_user_id"]

    def par_email(self, email):
        code, texte, _ = self.c.signe(f"/api/users/by-email?email={email.replace('+', '%2B')}", None, "GET")
        if code != 200:
            raise ta.Echec(f"by-email {code}", 2)
        return json.loads(texte)["workspaces"]

    def controle(self, nom, ok, detail=""):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:260])
        if not ok:
            self.echecs.append(nom)

    def nu(self, methode, corps=None):
        req = urllib.request.Request(f"{self.c.base}{ROUTE}" + ("" if corps else f"?workspace_id={self.tenant}"),
                                     method=methode, data=json.dumps(corps).encode() if corps else None,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code

    def poser(self, hub, action, **plus):
        code, texte, _ = self.c.signe(ROUTE, {"workspace_id": self.tenant, "hub_user_id": hub, "action": action,
                                              "actor_hub_user_id": "cle:ADMIN_SECRET", "reason": "preuve VER-263", **plus})
        try:
            return code, json.loads(texte)
        except ValueError:
            return code, {"brut": texte[:120]}

    def lire(self):
        code, texte, _ = self.c.signe(f"{ROUTE}?workspace_id={self.tenant}", None, "GET")
        if code != 200:
            raise ta.Echec(f"lecture {code} {texte[:80]}", 1)
        return {m["hub_user_id"]: m for m in json.loads(texte)["members"]}

    def retirer_a_l_ecran(self, email):
        """Le propriétaire rend le membre au rôle par défaut, par la mutation native de l'écran Membres."""
        roles = self.c.gql(self.origine, "{getRoles{id label}}", None, self.jeton)["getRoles"]
        membre = next((r["id"] for r in roles if r["label"] == "Member"), None)
        d = self.c.gql(self.origine, "query($e:String!){workspaceMembers(filter:{userEmail:{eq:$e}}){edges{node{id}}}}",
                       {"e": email}, self.jeton, "/graphql")
        fiche = d["workspaceMembers"]["edges"][0]["node"]["id"]
        self.c.gql(self.origine, "mutation($w:UUID!,$r:UUID!){updateWorkspaceMemberRole(workspaceMemberId:$w,roleId:$r){id}}",
                   {"w": fiche, "r": membre}, self.jeton)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--email", required=True)
    p.add_argument("--env", choices=["staging", "prod"], default="staging")
    a = p.parse_args()
    hub = str(uuid.uuid4())
    email = f"e2e-admin-plateforme-{int(time.time())}@veridian.site"
    e = None
    try:
        e = Epreuve(a)
        e.controle("POST sans signature refusé", e.nu("POST", {"workspace_id": e.tenant}) == 401)
        e.controle("GET sans signature refusé", e.nu("GET") == 401)
        lus = e.lire()
        e.controle("le propriétaire est lu « owner »", (lus.get(e.proprio) or {}).get("role") == "owner", str(lus.get(e.proprio)))
        code, r = e.poser(e.proprio, "grant")
        e.controle("jamais propriétaire : 409 is_owner", code == 409 and r.get("error") == "is_owner", f"{code} {r}")
        code, r = e.poser(hub, "grant")
        e.controle("inconnu : 404, rien de créé", code == 404 and r.get("error") == "user_not_in_app", f"{code} {r}")
        code, texte, _ = e.c.signe(f"/api/veridian/workspaces/{e.ws['id']}/attach-member",
                                   {"hub_user_id": hub, "hub_user_email": email, "role": "member"})
        if code != 201:
            raise ta.Echec(f"attach-member {code} {texte[:80]}", 2)
        code, r = e.poser(hub, "grant")
        e.controle("membre : rôle Admin natif posé", code == 200 and r.get("applied") is True and r.get("role") == "admin", f"{code} {r}")
        m = e.lire().get(hub) or {}
        e.controle("lecture : admin accordé", m.get("role") == "admin" and m.get("admin_granted") is True, str(m))
        e.retirer_a_l_ecran(email)
        m = e.lire().get(hub) or {}
        e.controle("retrait par le client constaté", m.get("admin_withdrawn") is True and m.get("role") == "member", str(m))
        code, r = e.poser(hub, "grant")
        e.controle("nouveau grant : 409 admin_withdrawn", code == 409 and r.get("error") == "admin_withdrawn", f"{code} {r}")
        code, r = e.poser(hub, "grant", reinstate=True)
        e.controle("reinstate le remet", code == 200 and r.get("role") == "admin", f"{code} {r}")
        code, r = e.poser(hub, "revoke")
        e.controle("revoke : rendu membre", code == 200 and r.get("role") == "member", f"{code} {r}")
        m = e.lire().get(hub) or {}
        e.controle("lecture finale : ni accordé ni retiré", m.get("admin_granted") is False and m.get("admin_withdrawn") is False, str(m))
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code
    finally:
        if e:
            e.c.signe(f"/api/tenants/{e.tenant}/remove-member", {"hub_user_id": hub, "email": email})
            e.c.signe("/api/hub/users/sync", {"hub_user_id": hub, "deleted": True})
    print("VERDICT :", "administrateur de plateforme conforme" if not e.echecs else f"ÉCHEC {e.echecs}")
    return 0 if not e.echecs else 1


if __name__ == "__main__":
    sys.exit(main())
