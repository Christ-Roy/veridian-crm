#!/usr/bin/env python3
"""Preuve qu'aucun chemin de Twenty n'ajoute un humain à un espace sans le Hub (VER-245), sur le staging seulement.

  preuve-porte-membres.py <espace jetable (twenty-admin jetable:creer)>

Chaque chemin est essayé par l'acteur le plus fort qui peut l'emprunter (public, session d'administrateur d'espace, clé Admin,
MCP), et l'appartenance est comptée en base avant et après, jamais déduite du message d'erreur. Contrôle positif : la route
signée du Hub ajoute, compte, entre, retire. Codes : 0 porte close, 1 un chemin ajoute ou n'est pas refusé, 2 non abouti.
"""
import base64
import json
import subprocess
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

COMPTE = """const { Client } = require('/app/node_modules/pg');
(async () => { const c = new Client({ connectionString: process.env.PG_DATABASE_URL }); await c.connect();
 await c.query('SET default_transaction_read_only = on'); const n = async (q, p) => (await c.query(q, p)).rows[0].n;
 const w = (await c.query('select id, "databaseSchema" s from core.workspace where subdomain=$1 and "deletedAt" is null', [process.argv[2]])).rows[0];
 const r = { acces: await n('select count(*)::int n from core."userWorkspace" where "workspaceId"=$1 and "deletedAt" is null', [w.id]),
  fiches: await n('select count(*)::int n from "' + w.s + '"."workspaceMember" where "deletedAt" is null'),
  comptes: await n('select count(*)::int n from core."user" where "deletedAt" is null'),
  espaces: await n('select count(*)::int n from core.workspace where "deletedAt" is null'),
  invitations: await n(`select count(*)::int n from core."appToken" where type='InvitationToken' and "workspaceId"=$1`, [w.id]) };
 console.log('COMPTE ' + JSON.stringify(r)); await c.end(); process.exit(0); })().catch((e) => { console.log('ERR ' + e.message); process.exit(2); });
"""


class Epreuve:
    def __init__(self, espace):
        self.espace, self.c, self.echecs, self.nuls = espace, ta.Client("staging"), [], []
        creds, p = ta.lire_creds(), ta.prefixe("staging", espace)
        self.tenant = creds.get(f"{p}_JETABLE_TENANT_ID")
        if not self.tenant:
            raise ta.Echec(f"{espace} n'est pas un espace jetable", 2)
        self.url, self.cle = ta._cle("staging", espace)
        self.email = creds[f"{p}_EMAIL"]
        self.origine, self.session, self.ws = self.c.session(self.email, espace)
        brut = subprocess.run(["nomad-v", "raw", "job", "status", "crm-staging"], capture_output=True, text=True).stdout
        self.alloc = next(l.split()[0] for l in brut.split("Allocations", 1)[1].splitlines() if " run " in l and "running" in l)

    def compte(self):
        b64 = base64.b64encode(COMPTE.encode()).decode()
        for _ in range(4):
            r = subprocess.run(["nomad-v", "raw", "alloc", "exec", "-task", "crm-server", self.alloc, "sh", "-c",
                                f"echo {b64} | base64 -d > /tmp/pm.js; timeout 30 node /tmp/pm.js {self.espace}; rm -f /tmp/pm.js"],
                               stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=90)
            ligne = next((l[7:] for l in r.stdout.splitlines() if l.startswith("COMPTE ")), None)
            if ligne:
                return json.loads(ligne)
            time.sleep(5)
        raise ta.Echec("comptage en base non abouti", 2)

    def gql(self, acteur, q, v=None, chemin="/metadata"):
        if acteur == "cle":
            return ta._gql_cle(self.c, self.url, self.cle, q, v, chemin)
        return self.c.gql(self.origine, q, v, self.session if acteur == "admin" else None, chemin)

    def juger(self, nom, ok, detail):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:260])
        if not ok:
            self.echecs.append(nom)

    def refuse(self, nom, acteur, q, v=None, chemin="/metadata"):
        try:
            r = self.gql(acteur, q, v, chemin)
            self.juger(f"{nom} [{acteur}]", False, f"ACCEPTÉ {json.dumps(r)[:120]}")
        except ta.Echec as e:
            # Un refus se reconnaît ; une requête mal formée, un plantage ou un état fortuit ne prouvent rien.
            refus = any(m in str(e) for m in ("managed by Veridian Hub", "does not have permission", "not enabled", "not found in workspace", "Invalid"))
            print(f"{'OK   ' if refus else 'NUL  '} {nom} [{acteur}] : {e}"[:260])
            if not refus:
                self.nuls.append(nom)

    def http(self, nom, chemin, attendus, methode="GET", corps=None, entetes=None, base=None):
        code, texte, h = self.c.http((base or self.origine) + chemin, corps, entetes or {}, methode)
        self.juger(nom, code in attendus, f"{code} {(h.get('Location') or texte)[:110]}")

    def jouer(self):
        avant = self.compte()
        print("AVANT", avant)
        mail = lambda n: f"e2e-porte-{n}-{int(time.time())}@veridian.site"
        mdp = "Epreuve-" + uuid.uuid4().hex
        wid = self.ws["id"]
        hachage = None
        for q in ("{currentWorkspace{inviteHash}}",):
            try:
                hachage = self.gql("admin", q)["currentWorkspace"]["inviteHash"]
            except ta.Echec as e:
                print("inviteHash illisible :", e)

        print("-- inscription et connexion, sans compte")
        self.refuse("signUp", "public", "mutation($e:String!,$p:String!){signUp(email:$e,password:$p){tokens{accessOrWorkspaceAgnosticToken{token}}}}", {"e": mail("s"), "p": mdp})
        s = "mutation($e:String!,$p:String!,$w:UUID,$h:String,$t:String){signUpInWorkspace(email:$e,password:$p,workspaceId:$w,workspaceInviteHash:$h,workspacePersonalInviteToken:$t){workspace{id}}}"
        self.refuse("signUpInWorkspace, identifiant de l'espace", "public", s, {"e": mail("w"), "p": mdp, "w": wid})
        self.refuse(f"signUpInWorkspace, lien d'invitation public (hachage réel : {bool(hachage)})", "public", s, {"e": mail("h"), "p": mdp, "w": wid, "h": hachage or "x"})
        self.refuse("signUpInWorkspace, jeton personnel", "public", s, {"e": mail("t"), "p": mdp, "w": wid, "t": "x"})
        self.refuse("signUpInNewWorkspace", "admin", "mutation{signUpInNewWorkspace{workspace{id}}}")
        self.refuse("signIn", "public", "mutation($e:String!,$p:String!){signIn(email:$e,password:$p){tokens{accessOrWorkspaceAgnosticToken{token}}}}", {"e": self.email, "p": mdp})
        self.refuse("getLoginTokenFromCredentials (accepte une invitation)", "public", "mutation($e:String!,$p:String!,$o:String!){getLoginTokenFromCredentials(email:$e,password:$p,origin:$o){loginToken{token}}}", {"e": self.email, "p": mdp, "o": self.origine})
        self.refuse("emailPasswordResetLink", "public", "mutation($e:String!,$w:UUID){emailPasswordResetLink(email:$e,workspaceId:$w){success}}", {"e": self.email, "w": wid})
        self.refuse("updatePasswordViaResetToken", "public", "mutation($t:String!,$p:String!){updatePasswordViaResetToken(passwordResetToken:$t,newPassword:$p){success}}", {"t": "x", "p": mdp})
        self.refuse("verifyEmailAndGetLoginToken (accepte une invitation)", "public", "mutation($t:String!,$e:String!,$o:String!){verifyEmailAndGetLoginToken(emailVerificationToken:$t,email:$e,origin:$o){loginToken{token}}}", {"t": "x", "e": self.email, "o": self.origine})
        self.refuse("getAuthTokensFromSSOExchangeToken", "public", "mutation($t:String!){getAuthTokensFromSSOExchangeToken(ssoExchangeToken:$t){tokens{accessOrWorkspaceAgnosticToken{token}}}}", {"t": "x"})

        print("-- invitations, domaines, réglages de l'espace")
        for a in ("admin", "cle"):
            self.refuse("sendInvitations", a, "mutation($e:[String!]!){sendInvitations(emails:$e){success}}", {"e": [mail("i")]})
            self.refuse("resendWorkspaceInvitation", a, "mutation($i:String!){resendWorkspaceInvitation(appTokenId:$i){success}}", {"i": str(uuid.uuid4())})
            for champ in ("isPublicInviteLinkEnabled", "isPasswordAuthEnabled", "isPasswordAuthBypassEnabled"):
                self.refuse(f"updateWorkspace {champ}", a, "mutation($d:UpdateWorkspaceInput!){updateWorkspace(data:$d){id}}", {"d": {champ: True}})
        u = "mutation($d:UpdateWorkspaceInput!){updateWorkspace(data:$d){id}}"
        for champ in ("isGoogleAuthEnabled", "isMicrosoftAuthEnabled"):
            try:
                self.gql("admin", u, {"d": {champ: True}})
                print(f"NOTE  updateWorkspace {champ} : accepté par l'espace, la porte est au serveur (essais HTTP ci-dessous)")
            except ta.Echec as e:
                print(f"NOTE  updateWorkspace {champ} : refusé ({e})"[:200])
        try:
            d = self.gql("admin", "mutation($i:CreateApprovedAccessDomainInput!){createApprovedAccessDomain(input:$i){id isValidated}}", {"i": {"domain": "veridian.site", "email": "e2e-porte@veridian.site"}})
            print("NOTE  createApprovedAccessDomain accepté :", json.dumps(d)[:150])
        except ta.Echec as e:
            print(f"NOTE  createApprovedAccessDomain refusé : {e}"[:200])
        self.refuse("validateApprovedAccessDomain", "admin", "mutation($i:ValidateApprovedAccessDomainInput!){validateApprovedAccessDomain(input:$i){isValidated}}", {"i": {"approvedAccessDomainId": str(uuid.uuid4()), "validationToken": "x"}})
        self.refuse("signUpInWorkspace après domaine approuvé", "public", s, {"e": mail("d"), "p": mdp, "w": wid})
        try:
            self.gql("admin", "mutation($d:ActivateWorkspaceInput!){activateWorkspace(data:$d){id}}", {"d": {"displayName": "x"}})
            print("NOTE  activateWorkspace : accepté sur un espace déjà actif (n'ajoute personne, le comptage final le dit)")
        except ta.Echec as e:
            print(f"NOTE  activateWorkspace refusé : {e}"[:200])

        print("-- connexion par un tiers (Google, Microsoft, OIDC, SAML)")
        for c in (f"/auth/google?workspaceId={wid}", "/auth/google/redirect?code=x&state=%7B%7D", f"/auth/microsoft?workspaceId={wid}",
                  "/auth/microsoft/redirect?code=x&state=%7B%7D"):
            try:
                code, texte, h = self.c.http(self.c.base + c, None, {}, "GET")
                lieu = h.get("Location") or ""
                tiers = any(x in lieu for x in ("accounts.google", "login.microsoft"))
                self.juger(f"GET {c.split('?')[0]}", not tiers and "loginToken" not in lieu, f"{code} {(lieu or texte)[:110]}")
            except ta.Echec as e:
                self.juger(f"GET {c.split('?')[0]}", False, str(e))
        i = str(uuid.uuid4())
        for m, c in (("GET", f"/auth/oidc/login/{i}"), ("GET", "/auth/oidc/callback?code=x&state=x"), ("GET", f"/auth/saml/login/{i}"), ("POST", f"/auth/saml/callback/{i}")):
            code, texte, h = self.c.http(self.c.base + c, b"" if m == "POST" else None, {}, m)
            self.juger(f"{m} {c.split('/' + i)[0].split('?')[0]}", "loginToken" not in (h.get("Location") or "") and code != 200, f"{code} {(h.get('Location') or texte)[:100]}")
        self.refuse("createOIDCIdentityProvider", "admin", "mutation($i:SetupOIDCSsoInput!){createOIDCIdentityProvider(input:$i){id}}", {"i": {"name": "x", "issuer": "https://veridian.site", "clientID": "x", "clientSecret": "x"}})
        self.refuse("createSAMLIdentityProvider", "admin", "mutation($i:SetupSAMLSsoInput!){createSAMLIdentityProvider(input:$i){id}}", {"i": {"name": "x", "issuer": "https://veridian.site", "id": i, "ssoURL": "https://veridian.site", "certificate": "x"}})

        print("-- fiche de membre par les API générées")
        uid = self.gql("admin", "{currentUser{id}}")["currentUser"]["id"]
        m = {"name": {"firstName": "Porte", "lastName": "Dérobée"}, "userEmail": mail("f"), "userId": str(uuid.uuid4())}
        for a in ("admin", "cle"):
            self.refuse("createWorkspaceMember", a, "mutation($d:WorkspaceMemberCreateInput!){createWorkspaceMember(data:$d){id}}", {"d": m}, "/graphql")
            self.refuse("createWorkspaceMembers upsert", a, "mutation($d:[WorkspaceMemberCreateInput!]!){createWorkspaceMembers(data:$d,upsert:true){id}}", {"d": [m]}, "/graphql")
            self.refuse("restoreWorkspaceMembers", a, "mutation($f:WorkspaceMemberFilterInput!){restoreWorkspaceMembers(filter:$f){id}}", {"f": {"deletedAt": {"is": "NOT_NULL"}}}, "/graphql")
        mien = self.gql("admin", "{workspaceMembers{edges{node{id}}}}", None, "/graphql")["workspaceMembers"]["edges"][0]["node"]["id"]
        for a in ("admin", "cle"):
            for champ, v in (("userId", str(uuid.uuid4())), ("userEmail", mail("z"))):
                self.refuse(f"updateWorkspaceMember {champ} (fiche existante vers un autre compte)", a, "mutation($i:UUID!,$d:WorkspaceMemberUpdateInput!){updateWorkspaceMember(id:$i,data:$d){id}}", {"i": mien, "d": {champ: v}}, "/graphql")
        h = {"Authorization": f"Bearer {self.cle}", "Content-Type": "application/json"}
        self.http("POST /rest/workspaceMembers [cle]", "/rest/workspaceMembers", (400, 403, 404, 405), "POST", json.dumps(m).encode(), h, self.url)
        self.http("POST /rest/batch/workspaceMembers [cle]", "/rest/batch/workspaceMembers", (400, 403, 404, 405), "POST", json.dumps([m]).encode(), h, self.url)
        hm = {**h, "Accept": "application/json, text/event-stream"}

        def mcp(methode, params=None):
            _, texte, _ = self.c.http(self.url + "/mcp", json.dumps({"jsonrpc": "2.0", "id": 1, "method": methode, "params": params or {}}).encode(), hm)
            return json.loads(next((x[5:] for x in texte.splitlines() if x.startswith("data:")), texte))
        outils = [o["name"] for o in mcp("tools/list")["result"]["tools"]]
        suspects = [o for o in outils if "member" in o or "invit" in o or "user" in o]
        print("MCP", len(outils), "outils, touchant les membres :", suspects)
        for o, args in (("create_one_workspace_member", m), ("create_many_workspace_members", {"records": [m]}), ("upsert_many_workspace_members", {"records": [m]})):
            r = mcp("tools/call", {"name": o, "arguments": args})
            t = json.dumps(r, ensure_ascii=False)
            self.juger(f"MCP {o} [cle]", '\\"success\\":true' not in t and '"success": true' not in t and ("error" in t or "rror" in t), t[:170])

        print("-- impersonation et routes du Hub sans sa signature")
        self.refuse("impersonate un compte hors de l'espace", "admin", "mutation($u:UUID!,$w:UUID!){impersonate(userId:$u,workspaceId:$w){loginToken{token}}}", {"u": next(x["user_id"] for x in self.c.utilisateurs() if x.get("user_id") and x["user_id"] != uid) if any(x.get("user_id") for x in self.c.utilisateurs()) else str(uuid.uuid4()), "w": wid})
        corps = json.dumps({"hub_user_id": str(uuid.uuid4()), "hub_user_email": mail("r"), "role": "member"}).encode()
        for nom, ent in (("sans signature", {}), ("signature fausse", {"X-Veridian-Timestamp": str(int(time.time() * 1000)), "X-Veridian-Hub-Signature": "0" * 64}), ("clé Admin de l'espace", {"Authorization": f"Bearer {self.cle}"})):
            self.http(f"attach-member {nom}", f"/api/veridian/workspaces/{wid}/attach-member", (401, 403), "POST", corps, {"Content-Type": "application/json", **ent}, self.c.base)
            self.http(f"issue-magic-link {nom}", "/api/sso/issue-magic-link", (401, 403), "POST", json.dumps({"hub_user_id": str(uuid.uuid4()), "email": mail("l")}).encode(), {"Content-Type": "application/json", **ent}, self.c.base)
        code, texte, _ = self.c.signe("/api/sso/issue-magic-link", {"hub_user_id": str(uuid.uuid4()), "email": mail("inconnu"), "next": self.origine + "/"})
        self.juger("issue-magic-link signé, compte inconnu : n'ajoute rien", code != 200, f"{code} {texte[:100]}")

        apres = self.compte()
        print("APRÈS", apres)
        self.juger("aucun accès, fiche, compte, espace ni invitation en plus", apres == avant, f"{avant} -> {apres}")

        print("-- contrôle positif : le Hub")
        hub, adr = str(uuid.uuid4()), mail("hub")
        try:
            code, texte, _ = self.c.signe(f"/api/veridian/workspaces/{wid}/attach-member", {"hub_user_id": hub, "hub_user_email": adr, "role": "member"})
            n = self.compte()
            self.juger("attach-member signé : un accès, une fiche, un compte de plus", code == 201 and (n["acces"], n["fiches"], n["comptes"]) == (avant["acces"] + 1, avant["fiches"] + 1, avant["comptes"] + 1), f"{code} {n}")
            try:
                self.c.session(adr, self.espace)
                self.juger("le membre ajouté par le Hub entre", True, "session ouverte")
            except ta.Echec as e:
                self.juger("le membre ajouté par le Hub entre", False, str(e))
        finally:
            self.c.signe(f"/api/tenants/{self.tenant}/remove-member", {"email": adr})
            self.c.signe("/api/hub/users/sync", {"hub_user_id": hub, "deleted": True})
        n = self.compte()
        self.juger("retiré par le Hub : accès et fiche reviennent", (n["acces"], n["fiches"]) == (avant["acces"], avant["fiches"]), str(n))


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    try:
        e = Epreuve(sys.argv[1])
        e.jouer()
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code
    print("VERDICT :", f"ÉCHEC {e.echecs}" if e.echecs else "porte close", f"; essais non concluants : {e.nuls}" if e.nuls else "")
    return 1 if e.echecs else 0


if __name__ == "__main__":
    sys.exit(main())
