#!/usr/bin/env python3
"""Preuve que les outils MCP de lecture et de rétablissement ne montrent pas plus qu'un find_many, sur le staging seulement.

Écrite pour un espace JETABLE (VER-203, VER-245) : un membre simple à rôle restreint est attaché pour l'épreuve (il lit tout
sauf les sociétés, n'écrit rien, n'a aucun réglage), puis retiré. L'Admin sert de témoin à chaque contrôle : un refus ne prouve
rien si la même demande ne réussit pas pour lui.

  preuve-outils-mcp.py <espace jetable> [--sabotage]

--sabotage rouvre les sociétés au membre le temps de l'épreuve : les contrôles de fuite doivent échouer (code 1).
Rien n'est lancé en workflow (effet irréversible) : run_workflow n'est éprouvé que par ses refus.

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

ROLE = "Preuve outils MCP restreint"
DROITS = {"canReadAllObjectRecords": True, "canUpdateAllObjectRecords": False, "canSoftDeleteAllObjectRecords": False,
          "canDestroyAllObjectRecords": False, "canUpdateAllSettings": False, "canAccessAllTools": True,
          "canBeAssignedToUsers": True, "canBeAssignedToAgents": False, "canBeAssignedToApiKeys": True}
LECTURE = {"search_records", "get_my_permissions", "get_record_email_threads", "get_record_calendar_events",
           "list_connected_accounts", "get_sync_status", "find_duplicate_records", "get_workspace_settings",
           "list_api_keys", "get_record_sharing"}
ECRITURE = {"restore_records", "retry_channel_sync", "run_workflow"}
RESERVES_ADMIN = {"list_api_keys", "run_workflow"}
# retry_channel_sync suit CONNECTED_ACCOUNTS, droit d'outil natif porté par le rôle d'épreuve, comme startChannelSync à l'écran.
DROITS_OUTILS = {"AI", "VIEWS", "UPLOAD_FILE", "DOWNLOAD_FILE", "SEND_EMAIL_TOOL", "CREATE_CALENDAR_EVENT_TOOL", "HTTP_REQUEST_TOOL",
                 "IMPORT_CSV", "EXPORT_CSV", "CONNECTED_ACCOUNTS", "PROFILE_INFORMATION", "CODE_INTERPRETER_TOOL"}
REGLAGES = {"id", "displayName", "subdomain", "customDomain", "isCustomDomainEnabled", "activationStatus",
            "trashRetentionDays", "workspaceMembersCount", "createdAt"}
FUITES = ("accessToken", "refreshToken", "connectionParameters", "syncCursor", "inviteHash")


class Epreuve:
    def __init__(self, a):
        self.a, self.c, self.echecs, self.nuls = a, ta.Client("staging"), [], []
        creds, p = ta.lire_creds(), ta.prefixe("staging", a.espace)
        self.tenant = creds.get(f"{p}_JETABLE_TENANT_ID")
        if not self.tenant:
            raise ta.Echec(f"{a.espace} n'est pas un espace jetable", 2)
        self.url, self.cle = ta._cle("staging", a.espace)
        self.origine, self.admin, self.ws = self.c.session(creds[f"{p}_EMAIL"], a.espace)

    def controle(self, nom, ok, detail=""):
        etat = "NUL  " if ok is None else "OK   " if ok else "ECHEC"
        print(f"{etat} {nom} : {detail}"[:300])
        if ok is None:
            self.nuls.append(nom)
        elif not ok:
            self.echecs.append(nom)

    def gql(self, requete, variables=None, chemin="/metadata"):
        return self.c.gql(self.origine, requete, variables, self.admin, chemin)

    def mcp(self, jeton, methode, params=None):
        corps = {"jsonrpc": "2.0", "id": 1, "method": methode, "params": params or {}}
        code, texte, _ = self.c.http(self.url + "/mcp", json.dumps(corps).encode(), {
            "Authorization": f"Bearer {jeton}", "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream"})
        try:
            return json.loads(next((x[5:] for x in texte.splitlines() if x.startswith("data:")), texte))
        except ValueError:
            raise ta.Echec(f"MCP {code} {texte[:100]}", 2)

    def catalogue(self, jeton):
        return {o["name"]: o for o in self.mcp(jeton, "tools/list")["result"]["tools"]}

    def outil(self, jeton, nom, **arguments):
        """Rend (ok, texte brut, contenu) ; ok est faux sur refus, erreur d'entrée ou success false."""
        r = self.mcp(jeton, "tools/call", {"name": nom, "arguments": arguments})
        texte = json.dumps(r, ensure_ascii=False)
        try:
            contenu = json.loads(r["result"]["content"][0]["text"])
        except (KeyError, IndexError, ValueError, TypeError):
            return False, texte, {}
        refus = "error" in r or r.get("result", {}).get("isError") or contenu.get("success") is False
        return (not refus), texte, contenu

    def role(self):
        roles = self.gql("{getRoles{id label}}")["getRoles"]
        return next((r for r in roles if r["label"] == ROLE), None)

    def societe_ouverte(self, role_id, ouvert):
        objets = self.gql("{objects(paging:{first:200}){edges{node{id nameSingular}}}}")["objects"]["edges"]
        societe = next(e["node"]["id"] for e in objets if e["node"]["nameSingular"] == "company")
        self.gql("mutation($i:UpsertObjectPermissionsInput!){upsertObjectPermissions(upsertObjectPermissionsInput:$i)"
                 "{objectMetadataId}}", {"i": {"roleId": role_id, "objectPermissions": [
                     {"objectMetadataId": societe, "canReadObjectRecords": ouvert, "canUpdateObjectRecords": False,
                      "canSoftDeleteObjectRecords": False, "canDestroyObjectRecords": False}]}})

    def preparer_role(self, membre_email):
        r = self.role()
        if not r:
            r = self.gql("mutation($i:CreateRoleInput!){createOneRole(createRoleInput:$i){id}}",
                         {"i": {"label": ROLE, "description": "Épreuve outils MCP, jetable", **DROITS}})["createOneRole"]
        self.societe_ouverte(r["id"], bool(self.a.sabotage))
        d = self.gql("{workspaceMembers{edges{node{id userEmail}}}}", None, "/graphql")
        m = next((x["node"]["id"] for x in d["workspaceMembers"]["edges"]
                  if (x["node"]["userEmail"] or "").lower() == membre_email.lower()), None)
        if not m:
            raise ta.Echec(f"{membre_email} n'est pas membre de {self.a.espace}", 2)
        self.gql("mutation($m:UUID!,$r:UUID!){updateWorkspaceMemberRole(workspaceMemberId:$m,roleId:$r){id}}",
                 {"m": m, "r": r["id"]})
        return r["id"]

    def jouer(self):
        hub, mail = str(uuid.uuid4()), f"e2e-outils-mcp-{int(time.time())}@veridian.site"
        code, texte, _ = self.c.signe(f"/api/veridian/workspaces/{self.ws['id']}/attach-member",
                                      {"hub_user_id": hub, "hub_user_email": mail, "role": "member"})
        if code != 201:
            raise ta.Echec(f"attach-member {code} {texte[:80]}", 2)
        graine = []
        try:
            _, membre, _ = self.c.session(mail, self.a.espace)
            role_id = self.preparer_role(mail)
            self.verifier(membre, role_id, graine)
        finally:
            for nom, i in graine:
                self.outil(self.admin, f"destroy_one_{nom}", id=i)
            self.c.signe(f"/api/tenants/{self.tenant}/remove-member", {"email": mail})
            self.c.signe("/api/hub/users/sync", {"hub_user_id": hub, "deleted": True})
            r = self.role()
            if r:
                self.societe_ouverte(r["id"], False)

    def verifier(self, membre, role_id, graine):
        sonde = f"PREUVE-OUTILS-{int(time.time())}"
        ok, _, soc = self.outil(self.admin, "create_one_company", name=sonde)
        societe = (soc.get("result") or {}).get("id")
        if not ok or not societe:
            raise ta.Echec(f"société témoin non créée : {json.dumps(soc)[:120]}", 2)
        graine.append(("company", societe))
        ok, _, per = self.outil(self.admin, "create_one_person", name={"firstName": "Preuve", "lastName": sonde})
        personne = (per.get("result") or {}).get("id")
        if personne:
            graine.append(("person", personne))

        admin_vu, membre_vu = self.catalogue(self.admin), self.catalogue(membre)
        self.controle("Admin : les 13 outils sont listés", (LECTURE | ECRITURE) <= set(admin_vu), f"{len(admin_vu)} outils")
        self.controle("membre : aucun outil réservé aux réglages listé", not (RESERVES_ADMIN & set(membre_vu)),
                      str(sorted(RESERVES_ADMIN & set(membre_vu))))
        self.controle("annotations : lectures en lecture seule, écritures non, run_workflow destructeur",
                      all(admin_vu[n]["annotations"]["readOnlyHint"] is True for n in LECTURE if n in admin_vu)
                      and all(admin_vu[n]["annotations"]["readOnlyHint"] is False for n in ECRITURE if n in admin_vu)
                      and admin_vu.get("run_workflow", {}).get("annotations", {}).get("destructiveHint") is True,
                      "tools/list de l'Admin")

        # Rien de plus qu'un find_many : la société n'est vue ni par la recherche, ni par les doublons, ni par le partage.
        ok_t, texte_t, _ = self.outil(self.admin, "search_records", query=sonde)
        self.controle("témoin Admin : la recherche voit la société", ok_t and societe in texte_t, texte_t[:120])
        ok_m, texte_m, _ = self.outil(membre, "search_records", query=sonde)
        self.controle("membre : la recherche ne rend pas la société", ok_m and societe not in texte_m, texte_m[-160:])
        if personne:
            ok_p, texte_p, _ = self.outil(membre, "search_records", query=sonde)
            self.controle("membre : la recherche voit encore la personne (témoin de méthode)", ok_p and "Preuve" in texte_p, texte_p[:120])
        else:
            self.controle("membre : la recherche voit encore la personne (témoin de méthode)", None, "personne non créée")

        ok_t, _, _ = self.outil(self.admin, "find_duplicate_records", objectNameSingular="company", ids=[societe])
        ok_m, texte_m, _ = self.outil(membre, "find_duplicate_records", objectNameSingular="company", ids=[societe])
        self.controle("doublons de sociétés : Admin oui, membre non", ok_t and not ok_m, f"admin {ok_t} membre {ok_m} {texte_m[:100]}")

        ok_t, _, _ = self.outil(self.admin, "get_record_sharing", objectNameSingular="company", recordId=societe)
        ok_m, texte_m, _ = self.outil(membre, "get_record_sharing", objectNameSingular="company", recordId=societe)
        self.controle("partage d'une société : Admin oui, membre non", ok_t and not ok_m, f"admin {ok_t} membre {ok_m} {texte_m[:100]}")

        for nom, outil in (("fils de mails", "get_record_email_threads"), ("agenda", "get_record_calendar_events")):
            ok_m, texte_m, contenu = self.outil(membre, outil, objectNameSingular="company", recordId=societe)
            vide = ((contenu.get("result") or {}).get("relatedPersonIds") or []) == []
            self.controle(f"{nom} d'une société : rien pour le membre", None if ok_m and vide else (not ok_m or vide),
                          "aucune boîte ni agenda branchés dans un espace jetable : la visibilité du service n'est pas éprouvée"
                          if ok_m and vide else texte_m[:120])

        # Restaurer ce qu'on n'a pas le droit de supprimer.
        self.outil(self.admin, "delete_one_company", id=societe)
        ok_m, texte_m, _ = self.outil(membre, "restore_records", objectNameSingular="company", ids=[societe])
        ok_t, texte_t, contenu_t = self.outil(self.admin, "restore_records", objectNameSingular="company", ids=[societe])
        self.controle("restauration : membre refusé, Admin accepté", (not ok_m) and ok_t and societe in texte_t,
                      f"membre {ok_m} {texte_m[:80]} admin {texte_t[:80]}")
        ok_m, _, _ = self.outil(membre, "restore_records", objectNameSingular="company", ids=[societe] * 101)
        self.controle("restauration : plus de 100 identifiants refusés", not ok_m, "")

        # Réglages, droits, clés : listes blanches et jamais de secret.
        ok_a, _, r_a = self.outil(self.admin, "get_workspace_settings")
        ok_m, _, r_m = self.outil(membre, "get_workspace_settings")
        self.controle("réglages : seules les clés de la liste blanche, pour l'Admin et le membre",
                      ok_a and ok_m and set(r_a["result"]) == REGLAGES and set(r_m["result"]) == REGLAGES,
                      f"{sorted(set((r_a.get('result') or {}))) } ")
        ok_a, _, r_a = self.outil(self.admin, "get_my_permissions")
        ok_m, _, r_m = self.outil(membre, "get_my_permissions")
        res_m = r_m.get("result") or {}
        self.controle("mes droits : le membre porte le rôle d'épreuve et aucun réglage",
                      ok_a and ok_m and role_id in res_m.get("roleIds", []) and res_m.get("permissionFlags")
                      and not [k for k, v in res_m["permissionFlags"].items() if v and k not in DROITS_OUTILS],
                      str([k for k, v in res_m.get("permissionFlags", {}).items() if v]))
        ok_a, texte_a, _ = self.outil(self.admin, "list_api_keys")
        ok_m, _, _ = self.outil(membre, "list_api_keys")
        self.controle("clés : l'Admin les liste sans jamais la valeur, le membre est refusé",
                      ok_a and self.cle not in texte_a and not ok_m, f"admin {ok_a} membre {ok_m}")
        for outil in ("list_connected_accounts", "get_sync_status"):
            ok_a, texte_a, _ = self.outil(self.admin, outil)
            fuite = [f for f in FUITES if f in texte_a]
            self.controle(f"{outil} : répond sans champ sensible", ok_a and not fuite, str(fuite))

        # Écritures : refus du membre, refus de l'Admin sur l'invalide. Aucun workflow n'est lancé.
        ok_m, _, _ = self.outil(membre, "run_workflow", workflowVersionId=str(uuid.uuid4()))
        ok_a, texte_a, _ = self.outil(self.admin, "run_workflow", workflowVersionId=str(uuid.uuid4()))
        self.controle("run_workflow : membre refusé, version inconnue refusée pour l'Admin, rien lancé",
                      not ok_m and not ok_a and "active version" in texte_a, texte_a[:120])
        ok_m, _, _ = self.outil(membre, "retry_channel_sync", connectedAccountId=str(uuid.uuid4()))
        ok_a, texte_a, _ = self.outil(self.admin, "retry_channel_sync", connectedAccountId=str(uuid.uuid4()))
        self.controle("retry_channel_sync : compte d'autrui ou inconnu refusé, membre comme Admin", not ok_m and not ok_a, texte_a[:120])
        self.controle("retry_channel_sync : une relance par compte et par minute", None,
                      "aucun compte connecté dans un espace jetable : à jouer sur un vrai compte")
        self.controle("run_workflow : lancer une version active", None, "effet irréversible, jamais rejoué ici")

    def verdict(self):
        if self.echecs:
            print("VERDICT : ÉCHEC", self.echecs, f"(non aboutis {self.nuls})" if self.nuls else "")
            return 1
        if self.nuls:
            print("VERDICT : NON ABOUTI", self.nuls)
            return 2
        print("VERDICT : rien de plus qu'un find_many")
        return 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--sabotage", action="store_true")
    try:
        e = Epreuve(p.parse_args())
        e.jouer()
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code
    return e.verdict()


if __name__ == "__main__":
    sys.exit(main())
