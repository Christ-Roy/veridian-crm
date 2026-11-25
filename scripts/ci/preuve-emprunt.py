#!/usr/bin/env python3
"""Preuve qu'une session d'emprunt (impersonate, niveau espace) lit comme la personne mais ne fabrique rien qui lui survive.

  preuve-emprunt.py <espace jetable> [--env staging]

Le propriétaire emprunte un administrateur de son espace jetable : lecture permise (témoin), clé API, jeton de clé et code OAuth refusés,
puis sortie propre (la session d'emprunt meurt). Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import json
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

JETONS = "mutation($l:String!,$o:String!){getAuthTokensFromLoginToken(loginToken:$l,origin:$o){tokens{accessOrWorkspaceAgnosticToken{token}}}}"


class Epreuve:
    def __init__(self, a):
        self.a, self.c, self.echecs = a, ta.Client(a.env), []
        acces, p = ta.lire_creds(), ta.prefixe(a.env, a.espace)
        self.tenant = acces.get(f"{p}_JETABLE_TENANT_ID")
        if not self.tenant:
            raise ta.Echec(f"{a.espace} n'est pas un espace jetable", 2)
        self.origine, self.jeton, self.ws = self.c.session(acces[f"{p}_EMAIL"], a.espace)

    def controle(self, nom, ok, detail=""):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:200], flush=True)
        if not ok:
            self.echecs.append(nom)

    def tenter(self, jeton, requete, variables=None, chemin="/metadata"):
        code, texte, _ = self.c.http(self.origine + chemin, json.dumps({"query": requete, "variables": variables or {}}).encode(),
                                     {"Content-Type": "application/json", "Origin": self.origine, "Authorization": f"Bearer {jeton}"})
        d = json.loads(texte)
        return d.get("data") if not d.get("errors") else None, "; ".join(e["message"] for e in d.get("errors") or []) or f"HTTP {code}"

    def jouer(self):
        hub, mail = str(uuid.uuid4()), f"e2e-emprunt-{uuid.uuid4().hex[:8]}@veridian.site"
        code, texte, _ = self.c.signe(f"/api/veridian/workspaces/{self.ws['id']}/attach-member", {
            "hub_user_id": hub, "email": mail, "hub_user_email": mail, "email_proven": True, "role": "admin"})
        if code != 201:
            raise ta.Echec(f"attach-member {code} {texte[:80]}", 2)
        try:
            code, texte, _ = self.c.signe("/api/hub/members/role", {"hub_tenant_id": self.tenant, "hub_user_id": hub, "email": mail,
                                                                    "role": "admin", "version": int(datetime.now().timestamp())})
            if code != 200:
                raise ta.Echec(f"rôle non posé : {code} {texte[:80]}", 2)
            _, membre, _ = self.c.session(mail, self.a.espace)
            cible = self.c.gql(self.origine, "{currentUser{id}}", jeton=membre)["currentUser"]["id"]
            roles = self.c.gql(self.origine, "{getApiKeyRoles{id label}}", jeton=self.jeton)["getApiKeyRoles"]
            role = next(r["id"] for r in roles if r["label"] == "Admin")
            expire = (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
            cle = {"i": {"name": "epreuve", "expiresAt": expire, "roleId": role}}
            creer = "mutation($i:CreateApiKeyInput!){createApiKey(input:$i){id}}"
            faite, d = self.tenter(self.jeton, creer, cle)
            self.controle("témoin : le propriétaire crée une clé", bool(faite), d)
            ident = faite["createApiKey"]["id"]
            jeton_cle = "mutation($a:UUID!,$e:String!){generateApiKeyToken(apiKeyId:$a,expiresAt:$e){token}}"
            fait, d = self.tenter(self.jeton, jeton_cle, {"a": ident, "e": expire})
            self.controle("témoin : le propriétaire fabrique un jeton de clé", bool(fait), d)

            donnees, d = self.tenter(self.jeton, "mutation($u:UUID!,$w:UUID!){impersonate(userId:$u,workspaceId:$w){loginToken{token}}}",
                                     {"u": cible, "w": self.ws["id"]})
            if not donnees:
                raise ta.Echec(f"emprunt refusé : {d}", 2)
            tokens = self.c.gql(self.origine, JETONS, {"l": donnees["impersonate"]["loginToken"]["token"], "o": self.origine})
            emprunt = tokens["getAuthTokensFromLoginToken"]["tokens"]["accessOrWorkspaceAgnosticToken"]["token"]
            lu, d = self.tenter(emprunt, "{currentUser{id}}")
            self.controle("emprunt : la session est celle de la personne", bool(lu) and lu["currentUser"]["id"] == cible, d)
            lu, d = self.tenter(emprunt, "{companies{totalCount}}", chemin="/graphql")
            self.controle("emprunt : lecture permise (témoin)", bool(lu), d)
            for nom, requete, variables in (
                ("crée une clé API", creer, cle),
                ("fabrique un jeton de clé", jeton_cle, {"a": ident, "e": expire}),
                ("fabrique un jeton de terrain de jeu", "mutation{generatePlaygroundToken{token}}", {}),
                ("obtient un code OAuth", "mutation($c:String!,$r:String!){authorizeApp(clientId:$c,redirectUrl:$r){redirectUrl}}",
                 {"c": str(uuid.uuid4()), "r": "https://e2e.veridian.site/retour"}),
                ("emprunte à son tour", "mutation($u:UUID!,$w:UUID!){impersonate(userId:$u,workspaceId:$w){loginToken{token}}}",
                 {"u": cible, "w": self.ws["id"]}),
            ):
                fait, d = self.tenter(emprunt, requete, variables)
                self.controle(f"emprunt refusé : {nom}", fait is None and "not available to this caller" in d, d)
            fini, d = self.tenter(emprunt, "mutation{stopImpersonation{canRestoreImpersonatorSession}}")
            self.controle("sortie acceptée", bool(fini), d)
            lu, d = self.tenter(self.jeton, "{currentUser{id}}")
            self.controle("le propriétaire est toujours lui (témoin)", bool(lu) and lu["currentUser"]["id"] != cible, d)
        finally:
            self.c.signe(f"/api/tenants/{self.tenant}/remove-member", {"hub_user_id": hub, "email": mail})
            self.c.signe("/api/hub/users/sync", {"hub_user_id": hub, "deleted": True})


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
    print("VRAI : l'emprunt lit et ne fabrique rien" if not e.echecs else f"FAUX : {len(e.echecs)} contrôle(s) : {', '.join(e.echecs)}")
    return 0 if not e.echecs else 1


if __name__ == "__main__":
    sys.exit(main())
