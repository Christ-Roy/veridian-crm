#!/usr/bin/env python3
"""Preuve de la réponse humaine relayée par le Hub (Mail vers CRM), sur le staging seulement : jeton `integration:<tenant>`
sans membre ni email, signé avec la clé du Hub de staging, vers l'outil MCP app_reponse_humaine.

  preuve-reponse-mail.py <espace jetable> [--chemin nomad/jobs/hub-staging/stack/hub-staging]

Épreuves : refus (membre, autre espace, autre outil, portée, rejeu), une réponse, le même message, dix livraisons simultanées,
personne inconnue créée une fois et reliée à la société de son domaine, ligne « Reçu » du dossier Mail, un autre expéditeur
qui rejoint la tâche ouverte, espace étranger intact. Fiches d'épreuve détruites.
Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import importlib.util
import json
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
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
OUTIL = "app_reponse_humaine"


class Epreuve(envoi.Epreuve):
    def __init__(self, a):
        creds, p = ta.lire_creds(), ta.prefixe("staging", a.espace)
        a.tenant, a.email = creds.get(f"{p}_JETABLE_TENANT_ID"), creds.get(f"{p}_EMAIL")
        if not a.tenant:
            raise ta.Echec(f"{a.espace} n'est pas un espace jetable", 2)
        super().__init__(a)
        self.dom = f"epreuve-{uuid.uuid4().hex[:8]}.fr"
        self.mail = f"jeanne@{self.dom}"
        self.fil = f"t_{uuid.uuid4().hex[:10]}"

    def jeton_mail(self, **plus):
        return self.jeton(**{"sub": f"integration:{self.a.tenant}", "email": None, "email_verified": None,
                             "act": {"sub": "app:notifuse"}, "scope": "crm:tache.ecrire", **plus})

    def args(self, **plus):
        m = str(uuid.uuid4())
        return {"email": self.mail, "workspace_id": "epreuve", "thread_id": self.fil, "message_id": m,
                "rfc_message_id": f"<{m}@{self.dom}>", "survenu_le": "2026-11-25T00:10:00Z", "idempotency_key": m,
                "chaine": [f"notifuse>crm:{m}"], **plus}

    def repondre(self, args, jeton=None):
        return self.appel(jeton or self.jeton_mail(), OUTIL, args)

    def taches(self):
        d = self.gql("query($t:TaskFilterInput,$p:PersonFilterInput){tasks(filter:$t){edges{node{id title origineVeridian bodyV2{markdown} "
                     "assigneeId taskTargets{edges{node{id}}} createdBy{source name}}}} "
                     "people(filter:$p){edges{node{id companyId origineVeridian name{firstName lastName}}}}}",
                     t={"hubExtId": {"startsWith": f"notifuse:reponse:{self.fil}"}}, p={"emails": {"primaryEmail": {"eq": self.mail}}})
        return [e["node"] for e in d["tasks"]["edges"]], [e["node"] for e in d["people"]["edges"]]

    def lignes(self, rfc):
        d = self.gql("query($f:EchangeMailFilterInput){echangeMails(filter:$f){edges{node{id sens nature personId objet threadId}}}}",
                     f={"hubExtId": {"eq": f"notifuse:mail:{rfc}"}})
        return [e["node"] for e in d["echangeMails"]["edges"]]

    def jouer(self):
        # Le premier appel valide pose Liaisons si elle manque : il sert ici de mise en place, sur un fil à part.
        c, r = self.repondre(self.args(thread_id="t_mise_en_place", email=f"mise@{self.dom}"))
        self.controle("sans membre ni email : accepté", r.get("ok") is True, f"{c} {json.dumps(r, ensure_ascii=False)[:180]}")
        soc = self.gql("mutation($d:CompanyCreateInput!){createCompany(data:$d){id}}",
                       d={"name": f"EPREUVE {self.dom}", "domainName": {"primaryLinkUrl": f"https://{self.dom}"}})["createCompany"]["id"]
        self.societe = soc
        a = self.args(nom="Jeanne Épreuve")
        for nom, jeton, code, erreur, outil in (
                ("un membre", self.jeton_mail(sub=self.sub), 403, "delegation_forbidden", OUTIL),
                ("un autre espace que le sien", self.jeton_mail(sub=f"integration:{uuid.uuid4()}"), 403, "tenant_forbidden", OUTIL),
                ("une autre app", self.jeton_mail(act={"sub": "app:prospection"}), 403, "delegation_forbidden", OUTIL),
                ("une autre portée", self.jeton_mail(scope="crm:societe.ecrire"), 403, "delegation_forbidden", OUTIL),
                ("l'outil d'un membre", self.jeton_mail(), 403, "delegation_forbidden", "app_envoyer_au_crm"),
                ("un outil natif", self.jeton_mail(), 403, "delegation_forbidden", "delete_many_companies")):
            self.refus(f"refus : {nom}", jeton, code, erreur, outil=outil, arguments=a)
        c, r = self.repondre(a, self.jeton_mail(act=None))
        self.controle("sans act : refus", c == 401, f"{c} {json.dumps(r)[:120]}")
        t, p = self.taches()
        self.controle("aucune tâche ni personne après les refus", not t and not p, f"{len(t)} {len(p)}")

        j = self.jeton_mail()
        c, r = self.repondre(a, j)
        t, p = self.taches()
        self.controle("une réponse : une tâche, une personne, deux liens", r.get("ok") is True and len(t) == 1 and len(p) == 1 and
                      len(t[0]["taskTargets"]["edges"]) == 2, json.dumps(r, ensure_ascii=False)[:180])
        self.controle("personne reliée à la société de son domaine", p and p[0]["companyId"] == soc, str(p))
        self.controle("personne nommée depuis le nom affiché (VER-247)", bool(p) and p[0].get("name") == {"firstName": "Jeanne", "lastName": "Épreuve"},
                      str(p and p[0].get("name")))
        if t:
            self.controle("titre, origine, lien de la conversation", t[0]["title"] == f"Répondre à {self.mail}" and
                          t[0]["origineVeridian"] == "Mail" and f"inbox?message={a['message_id']}" in (t[0]["bodyV2"] or {}).get("markdown", ""),
                          json.dumps(t[0], ensure_ascii=False)[:220])
        l = self.lignes(a["rfc_message_id"])
        self.controle("ligne « Reçu » du dossier Mail sur la fiche, sans attendre le lot", len(l) == 1 and p and l[0]["personId"] == p[0]["id"] and
                      l[0]["sens"] == "RECU" and l[0]["nature"] == "REPONSE_HUMAINE" and l[0]["threadId"] == self.fil, str(l)[:200])
        c, r = self.repondre(a, j)
        self.controle("le même jeton : refus", "token_replayed" in json.dumps(r), f"{c} {json.dumps(r)[:100]}")
        c, r = self.repondre(a)
        self.controle("le même message : rejoué, rien de plus", r.get("rejoue") is True and len(self.taches()[0]) == 1, json.dumps(r, ensure_ascii=False)[:140])
        self.controle("le même message : toujours une seule ligne Mail", len(self.lignes(a["rfc_message_id"])) == 1, "")
        jeanne, camille = self.mail, f"camille@{self.dom}"
        c, r = self.repondre(self.args(email=camille, nom="Camille Épreuve-Deux"))
        self.mail = camille
        t, p = self.taches()
        self.mail = jeanne
        cibles = len(t[0]["taskTargets"]["edges"]) if t else 0
        self.controle("un autre expéditeur dans le fil ouvert : sa fiche, aucune seconde tâche, la tâche lui est liée",
                      r.get("raison") == "tache_deja_ouverte" and len(t) == 1 and len(p) == 1 and
                      p[0].get("name") == {"firstName": "Camille", "lastName": "Épreuve-Deux"} and cibles == 3,
                      f"{json.dumps(r, ensure_ascii=False)[:120]} cibles={cibles} {p}")
        self.fil = f"t_{uuid.uuid4().hex[:10]}"
        b = self.args(email=f"paul@{self.dom}")
        self.mail = b["email"]
        with ThreadPoolExecutor(10) as pool:
            rs = list(pool.map(lambda _: self.repondre(b)[1], range(10)))
        t, p = self.taches()
        self.controle("dix livraisons simultanées : une tâche, une personne", all(x.get("ok") for x in rs) and len(t) == 1 and len(p) == 1,
                      f"{len(t)} {len(p)} {[x.get('erreur') for x in rs if not x.get('ok')]}")
        self.controle("dix livraisons simultanées : une seule ligne Mail", len(self.lignes(b["rfc_message_id"])) == 1, "")
        c, r = self.repondre(self.args(email="pas une adresse"))
        self.controle("échec lisible par le Hub (success false)", r.get("success") is False, json.dumps(r, ensure_ascii=False)[:140])

    def ranger(self):
        for mut, ty, f in (("Tasks", "TaskFilterInput", {"hubExtId": {"startsWith": "notifuse:reponse:t_"}}),
                           ("EchangeMails", "EchangeMailFilterInput", {"hubExtId": {"startsWith": "notifuse:mail:<"}}),
                           ("People", "PersonFilterInput", {"hubExtId": {"startsWith": "notifuse:contact:"}}),
                           ("Companies", "CompanyFilterInput", {"name": {"eq": f"EPREUVE {self.dom}"}})):
            for q, g in (("delete", f), ("destroy", {"and": [f, {"deletedAt": {"is": "NOT_NULL"}}]})):
                try:
                    self.gql(f"mutation($f:{ty}!){{{q}{mut}(filter:$f){{id}}}}", f=g)
                except ta.Echec as e:
                    print(f"nettoyage {mut} : {e}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--chemin", default="nomad/jobs/hub-staging/stack/hub-staging")
    a = p.parse_args()
    a.autre_tenant = None
    e = None
    try:
        e = Epreuve(a)
        e.jouer()
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code
    finally:
        if e:
            e.ranger()
    print("VERDICT :", "réponse Mail conforme" if not e.echecs else f"ÉCHEC {e.echecs}")
    return 0 if not e.echecs else 1


if __name__ == "__main__":
    sys.exit(main())
