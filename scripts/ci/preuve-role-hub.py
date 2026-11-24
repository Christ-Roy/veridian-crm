#!/usr/bin/env python3
"""Preuve du rôle porté par le Hub (CONTRAT-HUB §5.22), sur le staging seulement : un membre n'installe rien, promu admin au
Hub il installe, rétrogradé il ne peut plus, à la requête suivante et sans reconnexion ; version rejouée, dernier Admin, rôle
sur mesure, non-membre et autre espace.

  preuve-role-hub.py <espace jetable> <autre espace jetable> --listee <uid d'une app listée>

Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import json
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402


class Epreuve:
    def __init__(self, a):
        self.a, self.c, self.echecs = a, ta.Client("staging"), []
        creds = ta.lire_creds()
        p, q = ta.prefixe("staging", a.espace), ta.prefixe("staging", a.autre)
        self.tenant, self.autre = creds.get(f"{p}_JETABLE_TENANT_ID"), creds.get(f"{q}_JETABLE_TENANT_ID")
        if not self.tenant or not self.autre:
            raise ta.Echec("deux espaces jetables attendus", 2)
        self.proprio, self.proprio_hub = creds[f"{p}_EMAIL"], creds[f"{p}_JETABLE_HUB_USER_ID"]
        self.url, self.cle = ta._cle("staging", a.espace)
        self.origine, self.admin, self.ws = self.c.session(self.proprio, a.espace)
        self.v = int(time.time() * 1000)

    def controle(self, nom, ok, detail=""):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:230])
        if not ok:
            self.echecs.append(nom)

    def pousser(self, role, hub, version=None, tenant=None, email="x@veridian.site"):
        if version is None:
            self.v += 1
            version = self.v
        code, texte, _ = self.c.signe("/api/hub/members/role", {"hub_tenant_id": tenant or self.tenant, "hub_user_id": hub,
                                                                "email": email, "role": role, "version": version})
        return code, json.loads(texte) if texte.startswith("{") else {"brut": texte[:100]}

    def relu(self, email):
        _, texte, _ = self.c.signe(f"/api/users/by-email?email={email.replace('+', '%2B')}", None, "GET")
        return {w["hub_tenant_id"]: (w.get("hub_role"), w.get("native_admin")) for w in json.loads(texte)["workspaces"]}

    def mcp(self, jeton, methode, params=None):
        _, texte, _ = self.c.http(self.url + "/mcp", json.dumps({"jsonrpc": "2.0", "id": 1, "method": methode, "params": params or {}}).encode(),
                                  {"Authorization": f"Bearer {jeton}", "Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
        return json.loads(next((x[5:] for x in texte.splitlines() if x.startswith("data:")), texte))

    def voit(self, jeton):
        return "install_app" in {o["name"] for o in self.mcp(jeton, "tools/list")["result"]["tools"]}

    def installe(self, jeton):
        r = self.mcp(jeton, "tools/call", {"name": "install_app", "arguments": {"universalIdentifier": self.a.listee}})
        return self.a.listee in ta._installees(self.c, self.url, self.cle), json.dumps(r, ensure_ascii=False)[:120]

    def gql(self, q, v=None):
        return self.c.gql(self.origine, q, v, self.admin)

    def attendu(self, nom, reponse, code, **champs):
        c, r = reponse
        self.controle(nom, c == code and all(r.get(k) == x for k, x in champs.items()), f"{c} {json.dumps(r)}")

    def jouer(self):
        hub, mail = str(uuid.uuid4()), f"e2e-role-{int(time.time())}@veridian.site"
        wid = self.ws["id"]
        self.attendu("compte inconnu : jamais d'appartenance", self.pousser("admin", str(uuid.uuid4())), 200, applied=False, reason="not_member")
        self.attendu("organisation inconnue : 404", self.pousser("admin", self.proprio_hub, tenant=str(uuid.uuid4())), 404, error="tenant_not_linked")
        self.attendu("rôle inconnu : 400", self.pousser("root", self.proprio_hub), 400, error="invalid_body")
        self.attendu("dernier Admin : gardé", self.pousser("member", self.proprio_hub), 200, applied=False, reason="last_admin")
        code, texte, _ = self.c.http(self.c.base + "/api/hub/members/role", b"{}", {"Content-Type": "application/json"}, "POST")
        self.controle("sans signature : 401", code == 401, f"{code} {texte[:60]}")

        code, texte, _ = self.c.signe(f"/api/veridian/workspaces/{wid}/attach-member", {"hub_user_id": hub, "hub_user_email": mail, "role": "member"})
        if code != 201:
            raise ta.Echec(f"attach-member {code} {texte[:80]}", 2)
        try:
            _, jeton, _ = self.c.session(mail, self.a.espace)
            self.controle("membre : n'a pas l'outil", not self.voit(jeton))
            fait, r = self.installe(jeton)
            self.controle("membre : n'installe rien", not fait, r)
            self.attendu("promu admin au Hub", self.pousser("admin", hub), 200, applied=True, native_role="Admin")
            self.controle("relu en base", self.relu(mail).get(self.tenant) == ("admin", True), str(self.relu(mail)))
            self.controle("même session, sans reconnexion : voit l'outil", self.voit(jeton))
            fait, r = self.installe(jeton)
            self.controle("même session : installe", fait, r)
            self.attendu("version rejouée : rien", self.pousser("member", hub, version=self.v), 200, applied=False, reason="stale")
            self.attendu("version ancienne : rien", self.pousser("member", hub, version=self.v - 5), 200, applied=False, reason="stale")
            self.attendu("même rôle : inchangé", self.pousser("owner", hub), 200, applied=False, reason="unchanged")
            self.controle("toujours Admin", self.relu(mail).get(self.tenant) == ("owner", True), str(self.relu(mail)))
            self.attendu("rétrogradé", self.pousser("member", hub), 200, applied=True, native_role="Member")
            self.controle("même session : ne voit plus l'outil", not self.voit(jeton))
            self.controle("relu en base", self.relu(mail).get(self.tenant) == ("member", False), str(self.relu(mail)))

            self.attendu("autre espace, pas membre : rien", self.pousser("admin", hub, tenant=self.autre), 200, applied=False, reason="not_member")
            self.controle("un seul espace touché", set(self.relu(mail)) == {self.tenant}, str(self.relu(mail)))

            self.v += 1
            org = [{"hub_tenant_id": self.tenant, "role": "admin", "version": self.v}, {"hub_tenant_id": "x", "role": "admin", "version": 1}]
            code, _, _ = self.c.signe("/api/sso/issue-magic-link", {"hub_user_id": hub, "email": mail, "next": self.origine + "/", "organisations": org})
            self.controle("au rebond : promu", code == 200 and self.relu(mail).get(self.tenant) == ("admin", True), f"{code} {self.relu(mail)}")
            code, _, _ = self.c.signe("/api/sso/issue-magic-link", {"hub_user_id": hub, "email": mail, "next": self.origine + "/"})
            self.controle("rebond sans organisations : ne retire rien", code == 200 and self.relu(mail).get(self.tenant) == ("admin", True), str(code))

            self.pousser("member", hub)
            role = self.gql("mutation($i:CreateRoleInput!){createOneRole(createRoleInput:$i){id}}", {"i": {
                "label": "Sur mesure", "canReadAllObjectRecords": True, "canUpdateAllObjectRecords": False, "canSoftDeleteAllObjectRecords": False,
                "canDestroyAllObjectRecords": False, "canUpdateAllSettings": False, "canAccessAllTools": True, "canBeAssignedToUsers": True,
                "canBeAssignedToAgents": False, "canBeAssignedToApiKeys": False}})["createOneRole"]["id"]
            fiches = self.c.gql(self.origine, "{workspaceMembers{edges{node{id userEmail}}}}", None, self.admin, "/graphql")["workspaceMembers"]["edges"]
            m = next(x["node"]["id"] for x in fiches if x["node"]["userEmail"] == mail)
            self.gql("mutation($m:UUID!,$r:UUID!){updateWorkspaceMemberRole(workspaceMemberId:$m,roleId:$r){id}}", {"m": m, "r": role})
            self.attendu("rôle sur mesure : member ne le remplace pas", self.pousser("member", hub), 200, applied=False, reason="native_custom")
            self.attendu("rôle sur mesure : admin le remplace", self.pousser("admin", hub), 200, applied=True, native_role="Admin")
            self.attendu("le propriétaire peut céder, un autre Admin reste", self.pousser("member", self.proprio_hub), 200, applied=True)
            self.attendu("le propriétaire redevient Admin", self.pousser("owner", self.proprio_hub), 200, applied=True, native_role="Admin")

            self.c.signe(f"/api/tenants/{self.tenant}/remove-member", {"email": mail})
            self.attendu("parti : pas membre", self.pousser("admin", hub), 200, applied=False, reason="not_member")
            self.c.signe(f"/api/veridian/workspaces/{wid}/attach-member", {"hub_user_id": hub, "hub_user_email": mail, "role": "member"})
            self.controle("revenu : rôle par défaut, rien de gardé", self.relu(mail).get(self.tenant) == (None, False), str(self.relu(mail)))
        finally:
            self.c.signe(f"/api/tenants/{self.tenant}/remove-member", {"email": mail})
            self.c.signe("/api/hub/users/sync", {"hub_user_id": hub, "deleted": True})


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("autre")
    p.add_argument("--listee", required=True)
    try:
        e = Epreuve(p.parse_args())
        e.jouer()
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code
    print("VERDICT :", "rôle conforme" if not e.echecs else f"ÉCHEC {e.echecs}")
    return 0 if not e.echecs else 1


if __name__ == "__main__":
    sys.exit(main())
