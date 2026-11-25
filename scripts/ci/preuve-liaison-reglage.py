#!/usr/bin/env python3
"""Preuve que « Envoyer au CRM » se règle par MCP (VER-246), sur le staging seulement : l'objet natif Liaison, lu et écrit
par les outils MCP natifs, change vraiment l'envoi suivant ; l'admin qui le réserve par le droit natif du rôle (Paramètres >
Rôles) ferme l'écriture au membre simple, sans toucher à ses autres droits.

  preuve-liaison-reglage.py <ss-dom> --email <admin> --tenant <tenant Hub>

Crée un membre jetable (route signée du Hub), remet les réglages d'origine, détruit les fiches et le compte.
Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import importlib.util
import json
import random
import sys
import time
import uuid
from pathlib import Path

ICI = Path(__file__).parent
sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402


def charger(nom):
    spec = importlib.util.spec_from_file_location(nom.replace("-", "_"), ICI / f"{nom}.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


envoi = charger("preuve-envoi-crm")
CHAMPS = ["id", "nom", "app", "creerTache", "titreTache", "delaiJours"]


class Epreuve(envoi.Epreuve):
    def outil(self, jeton, nom, **arguments):
        return self.appel(jeton, outil=nom, arguments=arguments)

    def liaisons(self, jeton):
        code, r = self.outil(jeton, "find_many_liaisons", limit=10, select=CHAMPS)
        texte = json.dumps(r, ensure_ascii=False)
        return r, texte

    def regler(self, jeton, **champs):
        return self.outil(jeton, "update_one_liaison", id=self.liaison["id"], **champs)[1]

    def lue(self):
        d = self.gql("query($f:LiaisonFilterInput){liaisons(filter:$f){edges{node{" + " ".join(CHAMPS) + "}}}}", f={})
        l = [e["node"] for e in d["liaisons"]["edges"]]
        if not l:
            raise ta.Echec("aucune liaison : le post-install n'a pas posé la ligne", 1)
        return l[0]

    def tache(self):
        f = self.fiches()
        return f["companies"], f["tasks"]

    def meta(self, q, **v):
        return self.c.gql(self.origine, q, v, self.session)

    def reserver(self, role):
        """Droit natif : lecture seule sur Liaison pour le rôle. La mutation remplace tout : on renvoie aussi l'existant."""
        objets = self.meta("{objects(paging:{first:200}){edges{node{id nameSingular}}}}")["objects"]["edges"]
        liaison = next(e["node"]["id"] for e in objets if e["node"]["nameSingular"] == "liaison")
        autres = [p for p in role["objectPermissions"] if p["objectMetadataId"] != liaison]
        self.permettre(role, autres + [{"objectMetadataId": liaison, "canReadObjectRecords": True, "canUpdateObjectRecords": False,
                                        "canSoftDeleteObjectRecords": False, "canDestroyObjectRecords": False}])
        return liaison

    def permettre(self, role, droits):
        self.meta("mutation($i:UpsertObjectPermissionsInput!){upsertObjectPermissions(upsertObjectPermissionsInput:$i)"
                  "{objectMetadataId}}", i={"roleId": role["id"], "objectPermissions": droits})

    def role(self, nom):
        return next(r for r in self.meta("{getRoles{id label objectPermissions{objectMetadataId canReadObjectRecords "
                    "canUpdateObjectRecords canSoftDeleteObjectRecords canDestroyObjectRecords}}}")["getRoles"] if r["label"] == nom)

    def jouer(self):
        url, cle = ta._cle("staging", self.a.espace)
        self.liaison = self.lue()
        depart = {k: self.liaison[k] for k in ("creerTache", "titreTache", "delaiJours")}
        membre = f"e2e-liaison-{int(time.time())}@veridian.site"
        hub, verrou = str(uuid.uuid4()), None
        try:
            r, texte = self.liaisons(cle)
            self.controle("Admin lit les liaisons par MCP", self.liaison["id"] in texte, texte[:160])

            titre = f"Appel réglé par MCP {random.randint(1000, 9999)}"
            self.regler(cle, titreTache=titre, creerTache=True)
            self.controle("Admin écrit le réglage par MCP", self.lue()["titreTache"] == titre, self.lue()["titreTache"])
            self.appel(self.jeton())
            s, t = self.tache()
            self.controle("l'envoi suivant en tient compte (titre)", len(t) == 1 and titre in t[0]["title"], str([x["title"] for x in t]))
            self.nettoyer()

            self.siren = "7" + self.siren[1:]
            self.regler(cle, creerTache=False)
            _, r = self.appel(self.jeton())
            s, t = self.tache()
            self.controle("tâche coupée : société créée, aucune tâche", len(s) == 1 and not t, json.dumps(r, ensure_ascii=False)[:160])
            self.nettoyer()

            code, texte, _ = self.c.signe(f"/api/veridian/workspaces/{self.ws['id']}/attach-member",
                                          {"hub_user_id": hub, "hub_user_email": membre, "role": "member"})
            if code != 201:
                raise ta.Echec(f"attach-member {code} {texte[:100]}", 2)
            _, jeton, _ = self.c.session(membre, self.a.espace)
            r, texte = self.liaisons(jeton)
            self.controle("membre simple : lit les liaisons", self.liaison["id"] in texte, texte[:160])
            depart_role = self.role("Member")
            verrou = self.reserver(depart_role)
            avant = self.lue()
            r = self.regler(jeton, titreTache="ECRIT PAR UN MEMBRE")
            self.controle("membre simple : écriture MCP refusée", self.lue() == avant, json.dumps(r, ensure_ascii=False)[:200])
            try:
                self.c.gql(self.origine, "mutation($i:UUID!,$d:LiaisonUpdateInput!){updateLiaison(id:$i,data:$d){id}}",
                           {"i": self.liaison["id"], "d": {"titreTache": "ECRIT PAR UN MEMBRE"}}, jeton, "/graphql")
                self.controle("membre simple : écriture GraphQL refusée", False, "acceptée")
            except ta.Echec as e:
                self.controle("membre simple : écriture GraphQL refusée", self.lue() == avant, str(e))
            code, r = self.outil(jeton, "create_one_task", title="Droits ordinaires")
            ok = bool(r.get("id"))
            self.controle("membre simple : garde ses droits ordinaires (créer une tâche)", ok, json.dumps(r, ensure_ascii=False)[:160])
            self.gql("mutation($f:TaskFilterInput!){deleteTasks(filter:$f){id}}", f={"title": {"eq": "Droits ordinaires"}})
            self.gql("mutation($f:TaskFilterInput!){destroyTasks(filter:$f){id}}",
                     f={"and": [{"title": {"eq": "Droits ordinaires"}}, {"deletedAt": {"is": "NOT_NULL"}}]})
            r, texte = self.liaisons(jeton)
            self.controle("membre simple : lit toujours les liaisons", self.liaison["id"] in texte, texte[:100])
        finally:
            if verrou:
                d = [p for p in depart_role["objectPermissions"] if p["objectMetadataId"] != verrou]
                tout = {k: True for k in ("canReadObjectRecords", "canUpdateObjectRecords", "canSoftDeleteObjectRecords", "canDestroyObjectRecords")}
                self.permettre(depart_role, d or [{"objectMetadataId": verrou, **tout}])
            self.gql("mutation($i:UUID!,$d:LiaisonUpdateInput!){updateLiaison(id:$i,data:$d){id}}", i=self.liaison["id"], d=depart)
            self.c.signe(f"/api/tenants/{self.a.tenant}/remove-member", {"hub_user_id": hub, "email": membre})
            self.c.signe("/api/hub/users/sync", {"hub_user_id": hub, "deleted": True})
        fin = self.lue()
        self.controle("réglages d'origine remis", all(fin[k] == v for k, v in depart.items()), str(depart))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--email", required=True)
    p.add_argument("--tenant", required=True)
    p.add_argument("--chemin", default="nomad/jobs/hub-staging/stack/hub-staging")
    a = p.parse_args()
    e = None
    try:
        e = Epreuve(a)
        e.jouer()
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code
    finally:
        if e:
            e.nettoyer()
    print("VERDICT :", "réglage conforme" if not e.echecs else f"ÉCHEC {e.echecs}")
    return 0 if not e.echecs else 1


if __name__ == "__main__":
    sys.exit(main())
