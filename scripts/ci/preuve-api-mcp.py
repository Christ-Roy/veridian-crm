#!/usr/bin/env python3
"""Preuve des outils api_lire, api_ecrire, api_supprimer (VER-253), sur le staging seulement.

  preuve-api-mcp.py <espace jetable>

Épreuves : une clé ne les a pas ; l'Admin lit, crée, modifie, supprime ; chaque outil refuse le métier des autres et tout ce
qui n'est pas une fiche ; un membre privé des sociétés ne lit, n'écrit ni ne supprime rien de plus que par find_many.
Fiches détruites à la fin. Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import importlib.util
import json
import sys
import time
import uuid
from pathlib import Path

ICI = Path(__file__).parent
sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

spec = importlib.util.spec_from_file_location("preuve_outils_mcp", ICI / "preuve-outils-mcp.py")
outils = importlib.util.module_from_spec(spec)
spec.loader.exec_module(outils)
TROIS = {"api_lire", "api_ecrire", "api_supprimer"}


class Epreuve(outils.Epreuve):
    def api(self, jeton, outil, query, **variables):
        ok, texte, d = self.outil(jeton, outil, query=query, variables=variables)
        return bool(d.get("success")), texte, d.get("result") or {}

    def refuse(self, nom, jeton, outil, query, **variables):
        ok, texte, _ = self.api(jeton, outil, query, **variables)
        self.controle(f"{outil} refuse : {nom}", not ok, texte[-170:])

    def verifier(self, membre, role_id, graine):
        s = f"PREUVE-API-{int(time.time())}"
        self.controle("une clé API ne les voit pas", not (TROIS & set(self.catalogue(self.cle))), "")
        vus = self.catalogue(self.admin)
        self.controle("un membre les voit, annotés vrais", TROIS <= set(vus) and vus["api_lire"]["annotations"]["readOnlyHint"] is True
                      and vus["api_ecrire"]["annotations"]["readOnlyHint"] is False
                      and vus["api_supprimer"]["annotations"]["destructiveHint"] is True, "")
        ok, t, r = self.api(self.admin, "api_ecrire", "mutation($d:[CompanyCreateInput!]!){createCompanies(data:$d){id name}}",
                            d=[{"name": f"{s}-1"}, {"name": f"{s}-2"}])
        ids = [x["id"] for x in r.get("createCompanies", [])]
        graine.extend(("company", i) for i in ids)
        self.controle("Admin : crée deux sociétés d'un coup", ok and len(ids) == 2, t[-150:])
        if len(ids) != 2:
            return
        lire = "query($f:CompanyFilterInput){companies(filter:$f,first:5){totalCount edges{node{id name createdBy{source name}}}}}"
        ok, t, r = self.api(self.admin, "api_lire", lire, f={"name": {"like": f"{s}%"}})
        self.controle("Admin : les lit, filtre et variables", ok and r["companies"]["totalCount"] == 2, t[-150:])
        ok, t, _ = self.api(self.admin, "api_ecrire", "mutation($f:CompanyFilterInput!,$d:CompanyUpdateInput!){updateCompanies(filter:$f,data:$d){id}}",
                            f={"id": {"in": ids}}, d={"name": f"{s}-x"})
        self.controle("Admin : modifie par identifiants", ok, t[-150:])

        sup = "mutation($i:UUID!){deleteCompany(id:$i){id}}"
        self.refuse("une suppression", self.admin, "api_ecrire", sup, i=ids[0])
        self.refuse("une suppression sous l'alias d'une création", self.admin, "api_ecrire",
                    "mutation($i:UUID!){createCompany:destroyCompany(id:$i){id}}", i=ids[0])
        self.refuse("deletedAt", self.admin, "api_ecrire", "mutation($i:UUID!,$d:CompanyUpdateInput!){updateCompany(id:$i,data:$d){id}}",
                    i=ids[0], d={"deletedAt": "2026-11-25T00:00:00Z"})
        self.refuse("tout l'objet", self.admin, "api_ecrire", "mutation{updateCompanies(filter:{},data:{name:\"x\"}){id}}")
        self.refuse("un membre", self.admin, "api_ecrire", "mutation($i:UUID!){updateWorkspaceMember(id:$i,data:{locale:\"en\"}){id}}", i=str(uuid.uuid4()))
        self.refuse("retirer un membre", self.admin, "api_supprimer", "mutation($i:UUID!){deleteWorkspaceMember(id:$i){id}}", i=str(uuid.uuid4()))
        self.refuse("un membre sous un alias", self.admin, "api_ecrire", "mutation($i:UUID!){createCompany:updateWorkspaceMember(id:$i,data:{locale:\"en\"}){id}}", i=str(uuid.uuid4()))
        self.refuse("les mails", self.admin, "api_lire", "{messages{totalCount}}")
        self.refuse("les mails par une fiche", self.admin, "api_lire", "{people(first:1){edges{node{messageParticipants{edges{node{id}}}}}}}")
        ok, t, _ = self.api(self.admin, "api_lire", "{people(first:1){edges{node{id name{firstName} company{id name accountOwner{id}} taskTargets{edges{node{task{id title} targetCompany{id}}}}}}} workspaceMembers(first:1){edges{node{id}}}}")
        self.controle("Admin : relations utiles lisibles", ok, t[-170:])
        self.refuse("une écriture", self.admin, "api_lire", "mutation{createCompany(data:{name:\"x\"}){id}}")
        for nom, q in (("les rôles", "{getRoles{id}}"), ("les clés", "{apiKeys{id}}"), ("moi", "{currentUser{id}}"),
                       ("le schéma", "{__schema{types{name}}}"), ("les workflows", "{workflows{totalCount}}")):
            self.refuse(nom, self.admin, "api_lire", q)
        self.refuse("une création", self.admin, "api_supprimer", "mutation{createCompany(data:{name:\"x\"}){id}}")
        self.refuse("tout l'objet", self.admin, "api_supprimer", "mutation{destroyCompanies(filter:{}){id}}")
        ok, _, r = self.api(self.admin, "api_lire", lire, f={"name": {"eq": f"{s}-x"}})
        self.controle("rien n'a bougé après les refus", ok and r["companies"]["totalCount"] == 2, str(r)[:120])

        ok, t, r = self.api(membre, "api_lire", lire, f={"name": {"eq": f"{s}-x"}})
        self.controle("membre sans droit : ne lit pas les sociétés", not ok and ids[0] not in t, t[-150:])
        ok, t, _ = self.api(membre, "api_lire", "{people(first:1){totalCount}}")
        self.controle("membre : lit ce qu'il peut lire (témoin)", ok, t[-120:])
        self.refuse("au membre, créer", membre, "api_ecrire", "mutation{createCompany(data:{name:\"MEMBRE\"}){id}}")
        self.refuse("au membre, supprimer", membre, "api_supprimer", sup, i=ids[0])

        ok, t, _ = self.api(self.admin, "api_supprimer", "mutation($f:CompanyFilterInput!){deleteCompanies(filter:$f){id}}", f={"id": {"in": ids}})
        ok2, _, r = self.api(self.admin, "api_lire", lire, f={"name": {"eq": f"{s}-x"}})
        self.controle("Admin : supprime par identifiants", ok and ok2 and r["companies"]["totalCount"] == 0, t[-120:])


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    a = p.parse_args()
    a.sabotage = False
    try:
        e = Epreuve(a)
        e.jouer()
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code
    print("VERDICT :", "outils d'API conformes" if not e.echecs else f"ÉCHEC {e.echecs}")
    return 0 if not e.echecs else 1


if __name__ == "__main__":
    sys.exit(main())
