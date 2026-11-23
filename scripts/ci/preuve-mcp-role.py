#!/usr/bin/env python3
"""Preuve qu'un membre à rôle restreint reste restreint par la porte MCP du Hub (VER-203), depuis le bastion.

Le rôle d'épreuve lit tout sauf les sociétés et n'écrit rien. L'Admin de l'espace sert de témoin à chaque contrôle :
un refus ne prouve rien si la même demande ne réussit pas pour lui.

  preparer  <ss-dom> --email <admin>                  crée ou réaligne le rôle d'épreuve
  repeter   <ss-dom> --email <admin> [--sabotage]     juge le rôle avec une clé API éphémère, puis la révoque
                                                      (--sabotage rouvre les sociétés le temps de l'épreuve : code 1)
  attribuer <ss-dom> --email <admin> --membre <email> [--role <nom>]
                                                      donne un rôle au membre attaché par le Hub
  juger     <ss-dom> --email <admin> --membre <email> juge le JWT du Hub lu sur stdin (jamais en argument)
  retirer   <ss-dom> --email <admin>                  supprime le rôle d'épreuve (refuse s'il est encore porté)

Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import base64
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

ROLE = "Preuve MCP restreint"
DROITS = {"canReadAllObjectRecords": True, "canUpdateAllObjectRecords": False, "canSoftDeleteAllObjectRecords": False,
          "canDestroyAllObjectRecords": False, "canUpdateAllSettings": False, "canAccessAllTools": True,
          "canBeAssignedToUsers": True, "canBeAssignedToAgents": False, "canBeAssignedToApiKeys": True}
SONDE = "SONDE ROLE MCP"
INTERDITS = ["find_many_companies", "find_one_company", "group_by_companies", "create_one_company",
             "update_one_company", "delete_one_company"]
ECRITURES = ("create_", "update_", "delete_", "upsert_", "merge_")
OBJETS = ("_person", "_people", "_company", "_companies", "_opportunity", "_opportunities")


class Epreuve:
    def __init__(self, a):
        self.a = a
        self.c = ta.Client(a.env)
        self.origine, self.jeton, self.ws = self.c.session(a.email, a.espace)
        self.echecs, self.nuls = [], []

    def gql(self, requete, **variables):
        return self.c.gql(self.origine, requete, variables, self.jeton)

    def role(self, nom=ROLE):
        roles = self.gql("{getRoles{id label workspaceMembers{id userEmail} "
                         "objectPermissions{objectMetadataId canReadObjectRecords}}}")["getRoles"]
        return next((r for r in roles if r["label"] == nom), None)

    def role_exige(self, nom=ROLE):
        r = self.role(nom)
        if not r:
            raise ta.Echec(f"rôle {nom!r} absent de {self.a.espace}", 2)
        return r

    def objet(self, nom):
        objets = self.gql("{objects(paging:{first:200}){edges{node{id nameSingular}}}}")["objects"]["edges"]
        return next(e["node"]["id"] for e in objets if e["node"]["nameSingular"] == nom)

    def mcp(self, jeton, methode, params=None):
        corps = json.dumps({"jsonrpc": "2.0", "id": 1, "method": methode, "params": params or {}}).encode()
        code, texte, _ = self.c.http(self.c.base + "/mcp", corps, {
            "Authorization": f"Bearer {jeton}", "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18"})
        charge = next((ligne[5:] for ligne in texte.splitlines() if ligne.startswith("data:")), texte)
        try:
            return code, json.loads(charge)
        except ValueError:
            return code, {"brut": texte[:200]}

    def outil(self, jeton, nom, **arguments):
        """Rend (état, texte) : ok, refus, ou nul quand la réponse ne permet pas de conclure."""
        code, rep = self.mcp(jeton, "tools/call", {"name": nom, "arguments": arguments})
        texte = json.dumps(rep, ensure_ascii=False)
        if code == 429 or code >= 500:
            return "nul", f"{code} {texte}"
        resultat = rep.get("result")
        if not resultat or resultat.get("isError") or "error" in rep:
            return "refus", f"{code} {texte}"
        try:
            contenu = json.loads(resultat["content"][0]["text"])
        except (KeyError, IndexError, ValueError):
            contenu = resultat.get("structuredContent")
        if isinstance(contenu, dict) and contenu.get("success") is False:
            return "refus", texte
        return "ok", texte

    def outils(self, jeton):
        code, rep = self.mcp(jeton, "tools/list")
        if code != 200 or not rep.get("result", {}).get("tools"):
            raise ta.Echec(f"tools/list {code} {json.dumps(rep)[:200]}", 2)
        return {o["name"] for o in rep["result"]["tools"]}

    def controle(self, nom, ok, detail=""):
        etat = "NUL  " if ok is None else "OK   " if ok else "ECHEC"
        print(f"{etat} {nom} : {detail}"[:330])
        if ok is None:
            self.nuls.append(nom)
        elif not ok:
            self.echecs.append(nom)

    def societes(self):
        d = self.c.gql(self.origine, "{companies(first:60){totalCount edges{node{id name}}}}", None, self.jeton, "/graphql")
        return d["companies"]["totalCount"], [e["node"] for e in d["companies"]["edges"]]

    def liees(self):
        d = self.c.gql(self.origine, "{people(first:60){edges{node{id company{id name}}}}}", None, self.jeton, "/graphql")
        return [e["node"] for e in d["people"]["edges"] if e["node"]["company"]]

    def juger(self, jeton):
        total, societes = self.societes()
        if not societes:
            raise ta.Echec(f"aucune société dans {self.a.espace} : un refus n'y prouverait rien", 2)
        noms = [s["name"] for s in societes if s["name"] and len(s["name"]) > 4]
        une = societes[0]

        temoin, vus = self.outils(self.jeton), self.outils(jeton)
        self.controle("témoin Admin : outils société présents", all(i in temoin for i in INTERDITS) or None,
                      f"{len(temoin)} outils")
        visibles = [i for i in INTERDITS if i in vus]
        self.controle("membre : aucun outil société listé", not visibles, f"{len(vus)} outils, visibles {visibles}")
        ecritures = sorted(o for o in vus if o.startswith(ECRITURES) and o.endswith(OBJETS))
        self.controle("membre : aucune écriture d'enregistrement listée", not ecritures, str(ecritures[:6]))
        etat, texte = self.outil(jeton, "find_many_people", limit=1, select=["id"])
        self.controle("membre : find_many_people répond", None if etat == "nul" else etat == "ok", texte[:140])

        for nom, arguments in (
                ("find_many_companies", {"limit": 5, "select": ["id", "name"]}),
                ("find_one_company", {"id": une["id"], "select": ["id", "name"]}),
                ("group_by_companies", {"groupBy": [{"createdAt": {"granularity": "YEAR", "timeZone": "UTC"}}]})):
            etat_t, texte_t = self.outil(self.jeton, nom, **arguments)
            if etat_t != "ok":
                self.controle(f"témoin Admin : {nom}", None, texte_t[:200])
                continue
            etat, texte = self.outil(jeton, nom, **arguments)
            fuite = [n for n in noms if n in texte]
            self.controle(f"membre : {nom} refusé (Admin accepté)",
                          None if etat == "nul" else etat == "refus" and not fuite,
                          f"{etat} fuite={fuite[:2]} {texte[:190]}")

        liees = self.liees()
        if liees:
            p = liees[0]
            arguments = {"id": p["id"], "select": ["id", "company"]}
            etat_t, texte_t = self.outil(self.jeton, "find_one_person", **arguments)
            temoin_ok = etat_t == "ok" and p["company"]["name"] in texte_t
            etat, texte = self.outil(jeton, "find_one_person", **arguments)
            self.controle("membre : pas de société par la relation d'une personne",
                          None if etat == "nul" or not temoin_ok else p["company"]["name"] not in texte,
                          f"{etat} témoin={temoin_ok} {texte[:190]}")
        else:
            self.controle("membre : pas de société par la relation d'une personne", None, "aucune personne liée")

        for nom, arguments in (("create_one_company", {"name": SONDE}),
                               ("update_one_company", {"id": une["id"], "name": SONDE})):
            etat, texte = self.outil(jeton, nom, **arguments)
            self.controle(f"membre : {nom} refusé", None if etat == "nul" else etat == "refus", texte[:200])
        apres = self.societes()[0]
        sondes = [x["node"] for x in self.c.gql(
            self.origine, "query($n:String!){companies(filter:{name:{eq:$n}}){edges{node{id}}}}", {"n": SONDE},
            self.jeton, "/graphql")["companies"]["edges"]]
        self.controle("aucune société écrite (relu par l'Admin)", apres == total and not sondes, f"{total} puis {apres}")
        for s in sondes:
            if s["id"] == une["id"]:
                self.c.gql(self.origine, "mutation($i:UUID!,$d:CompanyUpdateInput!){updateCompany(id:$i,data:$d){id}}",
                           {"i": s["id"], "d": {"name": une["name"]}}, self.jeton, "/graphql")
            else:
                self.c.gql(self.origine, "mutation($i:UUID!){destroyCompany(id:$i){id}}", {"i": s["id"]}, self.jeton, "/graphql")

    def verdict(self):
        if self.echecs:
            print("VERDICT : ÉCHEC", self.echecs, f"(non aboutis {self.nuls})" if self.nuls else "")
            return 1
        if self.nuls:
            print("VERDICT : NON ABOUTI", self.nuls)
            return 2
        print("VERDICT : rôle respecté")
        return 0


def droits_societe(e, role_id, ouvert):
    e.gql("mutation($i:UpsertObjectPermissionsInput!){upsertObjectPermissions(upsertObjectPermissionsInput:$i)"
          "{objectMetadataId}}", i={"roleId": role_id, "objectPermissions": [
              {"objectMetadataId": e.objet("company"), "canReadObjectRecords": ouvert, "canUpdateObjectRecords": ouvert,
               "canSoftDeleteObjectRecords": False, "canDestroyObjectRecords": False}]})


def preparer(e):
    r = e.role()
    if r:
        e.gql("mutation($i:UpdateRoleInput!){updateOneRole(updateRoleInput:$i){id}}", i={"id": r["id"], "update": DROITS})
    else:
        r = e.gql("mutation($i:CreateRoleInput!){createOneRole(createRoleInput:$i){id}}",
                  i={"label": ROLE, "description": "Épreuve VER-203, à retirer", **DROITS})["createOneRole"]
    societe = e.objet("company")
    droits_societe(e, r["id"], False)
    relu = e.role_exige()
    pose = any(p["objectMetadataId"] == societe and p["canReadObjectRecords"] is False for p in relu["objectPermissions"])
    print(f"rôle {relu['id']} sur {e.ws['subdomain']}, sociétés interdites relues : {pose}")
    return 0 if pose else 1


def repeter(e):
    r = e.role_exige()
    expire = (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    cle = e.gql("mutation($i:CreateApiKeyInput!){createApiKey(input:$i){id}}",
                i={"name": "preuve-mcp-role", "expiresAt": expire, "roleId": r["id"]})["createApiKey"]["id"]
    try:
        jeton = e.gql("mutation($a:UUID!,$x:String!){generateApiKeyToken(apiKeyId:$a,expiresAt:$x){token}}",
                      a=cle, x=expire)["generateApiKeyToken"]["token"]
        if e.a.sabotage:
            droits_societe(e, r["id"], True)
        e.juger(jeton)
    finally:
        if e.a.sabotage:
            droits_societe(e, r["id"], False)
        e.gql("mutation($i:RevokeApiKeyInput!){revokeApiKey(input:$i){id}}", i={"id": cle})
    return e.verdict()


def membre(e):
    d = e.c.gql(e.origine, "{workspaceMembers{edges{node{id userEmail}}}}", None, e.jeton, "/graphql")
    for x in d["workspaceMembers"]["edges"]:
        if (x["node"]["userEmail"] or "").lower() == e.a.membre.lower():
            return x["node"]["id"]
    raise ta.Echec(f"{e.a.membre} n'est pas membre de {e.a.espace} : le Hub doit d'abord l'y attacher", 2)


def attribuer(e):
    r, m = e.role_exige(e.a.role), membre(e)
    e.gql("mutation($m:UUID!,$r:UUID!){updateWorkspaceMemberRole(workspaceMemberId:$m,roleId:$r){id}}", m=m, r=r["id"])
    porteurs = [x["userEmail"].lower() for x in e.role_exige(e.a.role)["workspaceMembers"]]
    print(f"{e.a.role} porté par {porteurs}")
    return 0 if e.a.membre.lower() in porteurs else 1


def juger(e):
    porteurs = [x["userEmail"].lower() for x in e.role_exige()["workspaceMembers"]]
    if e.a.membre.lower() not in porteurs:
        raise ta.Echec(f"{e.a.membre} ne porte pas {ROLE} : lancer attribuer", 2)
    jeton = sys.stdin.read().strip()
    if jeton.count(".") != 2:
        raise ta.Echec("aucun JWT lu sur stdin", 2)
    charge = jeton.split(".")[1]
    claims = json.loads(base64.urlsafe_b64decode(charge + "=" * (-len(charge) % 4)))
    hub = next((u for u in e.c.utilisateurs() if (u.get("email") or "").lower() == e.a.membre.lower()), {})
    if not hub.get("hub_user_id") or claims.get("sub") != hub["hub_user_id"]:
        raise ta.Echec(f"le JWT n'est pas celui de {e.a.membre} (sub {claims.get('sub')})", 2)
    e.juger(jeton)
    return e.verdict()


def retirer(e):
    r = e.role()
    if not r:
        print("rôle déjà absent")
        return 0
    if r["workspaceMembers"]:
        raise ta.Echec(f"rôle encore porté par {[m['userEmail'] for m in r['workspaceMembers']]}")
    e.gql("mutation($r:UUID!){deleteOneRole(roleId:$r)}", r=r["id"])
    absent = e.role() is None
    print("rôle retiré" if absent else "rôle encore présent")
    return 0 if absent else 1


MODES = {"preparer": preparer, "repeter": repeter, "attribuer": attribuer, "juger": juger, "retirer": retirer}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("mode", choices=list(MODES))
    p.add_argument("espace")
    p.add_argument("--env", choices=["staging", "prod"], default="staging")
    p.add_argument("--email", required=True)
    p.add_argument("--membre")
    p.add_argument("--role", default=ROLE)
    p.add_argument("--sabotage", action="store_true")
    a = p.parse_args()
    if a.mode in ("attribuer", "juger") and not a.membre:
        p.error("--membre requis")
    try:
        return MODES[a.mode](Epreuve(a))
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code


if __name__ == "__main__":
    sys.exit(main())
