#!/usr/bin/env python3
"""Preuve qu'un administrateur installe une app par MCP et qu'un membre simple ne le peut pas, sur le staging seulement.

  preuve-apps-mcp.py <espace jetable> --listee <uid d'une app listée> --privee <uid d'une app non listée>

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
        creds, p = ta.lire_creds(), ta.prefixe("staging", a.espace)
        self.tenant = creds.get(f"{p}_JETABLE_TENANT_ID")
        if not self.tenant:
            raise ta.Echec(f"{a.espace} n'est pas un espace jetable", 2)
        self.url, self.cle = ta._cle("staging", a.espace)
        self.origine, self.admin, self.ws = self.c.session(creds[f"{p}_EMAIL"], a.espace)

    def controle(self, nom, ok, detail=""):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:260])
        if not ok:
            self.echecs.append(nom)

    def mcp(self, jeton, methode, params=None):
        corps = {"jsonrpc": "2.0", "id": 1, "method": methode, "params": params or {}}
        code, texte, _ = self.c.http(self.url + "/mcp", json.dumps(corps).encode(), {
            "Authorization": f"Bearer {jeton}", "Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
        try:
            return json.loads(next((x[5:] for x in texte.splitlines() if x.startswith("data:")), texte))
        except ValueError:
            raise ta.Echec(f"MCP {code} {texte[:100]}", 2)

    def outils(self, jeton):
        return {o["name"] for o in self.mcp(jeton, "tools/list")["result"]["tools"]}

    def outil(self, jeton, nom, **arguments):
        r = self.mcp(jeton, "tools/call", {"name": nom, "arguments": arguments})
        try:
            return json.loads(r["result"]["content"][0]["text"])
        except (KeyError, ValueError):
            return {"success": False, "brut": json.dumps(r)[:200]}

    def versions(self):
        return {u: a["version"] for u, a in ta._installees(self.c, self.url, self.cle).items()}

    def apps(self, jeton):
        r = self.outil(jeton, "list_available_apps")
        return {x["universalIdentifier"]: x for x in (r.get("result") or r).get("apps", [])}

    def jouer(self):
        hub, mail = str(uuid.uuid4()), f"e2e-apps-mcp-{int(time.time())}@veridian.site"
        code, texte, _ = self.c.signe(f"/api/veridian/workspaces/{self.ws['id']}/attach-member",
                                      {"hub_user_id": hub, "hub_user_email": mail, "role": "member"})
        if code != 201:
            raise ta.Echec(f"attach-member {code} {texte[:80]}", 2)
        try:
            _, membre, _ = self.c.session(mail, self.a.espace)
            deux = {"list_available_apps", "install_app"}
            for nom, jeton in (("admin, session", self.admin), ("admin, clé", self.cle)):
                self.controle(f"{nom} : les deux outils sont listés", deux <= self.outils(jeton), "")
            vus = self.outils(membre)
            self.controle("membre simple : aucun des deux listé", not (deux & vus), f"{len(vus)} outils")
            r = self.outil(membre, "install_app", universalIdentifier=self.a.listee)
            self.controle("membre simple : installation refusée", r.get("success") is not True and self.a.listee not in self.versions(),
                          json.dumps(r, ensure_ascii=False)[:160])

            avant = self.apps(self.admin)
            self.controle("la listée paraît, non installée ; la privée ne paraît pas",
                          avant.get(self.a.listee, {}).get("installedVersion", 1) is None and self.a.privee not in avant, str(list(avant)))
            r = self.outil(self.admin, "install_app", universalIdentifier=self.a.privee)
            self.controle("privée : refus avec sa raison", r.get("success") is False and "not allowed" in json.dumps(r) and
                          self.a.privee not in self.versions(), json.dumps(r, ensure_ascii=False)[:160])
            r = self.outil(self.admin, "install_app", universalIdentifier=str(uuid.uuid4()))
            self.controle("inconnue : refus", r.get("success") is False, json.dumps(r, ensure_ascii=False)[:160])

            t = time.time()
            r = self.outil(self.admin, "install_app", universalIdentifier=self.a.listee)
            self.controle("admin, session : installée par MCP", r.get("success") is not False and self.a.listee in self.versions(),
                          f"{time.time() - t:.0f} s {json.dumps(r, ensure_ascii=False)[:120]}")
            self.controle("la liste dit la version installée", self.apps(self.cle).get(self.a.listee, {}).get("installedVersion") ==
                          self.versions().get(self.a.listee), str(self.versions().get(self.a.listee)))
        finally:
            self.c.signe(f"/api/tenants/{self.tenant}/remove-member", {"hub_user_id": hub, "email": mail})
            self.c.signe("/api/hub/users/sync", {"hub_user_id": hub, "deleted": True})


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--listee", required=True)
    p.add_argument("--privee", required=True)
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
