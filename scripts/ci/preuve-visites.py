#!/usr/bin/env python3
"""Preuve du dossier Visites d'une fiche (contrat Hub §5.26, Liaisons 0.8, VER-273) sur le staging : jeton `integration:<tenant>`,
act app:analytics, portée crm:visite.ecrire, signé avec la clé du Hub de staging, vers l'outil MCP app_evenements_visite.

  preuve-visites.py <espace jetable> [--captures <dossier>]

Épreuves : une visite d'une personne de l'espace donne une ligne ; le même lot rejoué n'ajoute rien ; une visite prolongée complète
la ligne sans la faire reculer ; un contact inconnu est ignoré (contact_inconnu) sans personne créée ; une mauvaise portée, un mauvais
act, un membre ou un outil d'un autre plugin sont refusés ; capture de l'onglet « Visites » de la fiche (Chromium sur node02).
Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import importlib.util
import json
import subprocess
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


reponse = charger("preuve-reponse-mail")
OUTIL = "app_evenements_visite"


class Epreuve(reponse.Epreuve):
    def jeton_visite(self, **plus):
        return self.jeton(**{"sub": f"integration:{self.a.tenant}", "email": None, "email_verified": None,
                             "act": {"sub": "app:analytics"}, "scope": "crm:visite.ecrire", **plus})

    def lot(self, visites, lot_id=None, jeton=None):
        return self.appel(jeton or self.jeton_visite(), OUTIL, {"kind": "visite", "lot_id": lot_id or str(uuid.uuid4()), "visites": visites})

    def visite(self, session, email, **plus):
        fin = time.time()
        return {"session_id": session, "contact_email": email,
                "debut": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(fin - 600)),
                "fin": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(fin - 60)),
                "duree_s": 540, "pages_vues": 2, "chemins": ["/tarifs", "/contact"], **plus}

    def fiches(self, session):
        d = self.gql("query($f:VisiteFilterInput){visites(filter:$f){edges{node{id hubExtId fin dureeS pagesVues chemins premierChemin personId origineVeridian}}}}",
                     f={"hubExtId": {"eq": f"analytics:visite:{session}"}})
        return [e["node"] for e in d["visites"]["edges"]]

    def personnes(self, email):
        d = self.gql("query($p:PersonFilterInput){people(filter:$p){edges{node{id}}}}", p={"emails": {"primaryEmail": {"eq": email}}})
        return [e["node"]["id"] for e in d["people"]["edges"]]

    def jouer(self):
        self.marie = f"marie@{self.dom}"
        d = self.gql("mutation($d:PersonCreateInput!){createPerson(data:$d){id}}",
                     d={"name": {"firstName": "Marie", "lastName": "Épreuve"},
                        "emails": {"primaryEmail": self.marie, "additionalEmails": []}})
        self.personne = d["createPerson"]["id"]
        # Liaisons posée à la naissance de l'espace : l'objet Visite existe sans aucun appel.
        fin, pose = time.monotonic() + 90, False
        while time.monotonic() < fin and not pose:
            try:
                self.gql("{visites(first:1){edges{node{id}}}}")
                pose = True
            except ta.Echec:
                time.sleep(5)
        self.controle("objet Visite posé à la naissance de l'espace", pose)

        session = f"sess-{uuid.uuid4().hex[:12]}"
        self.session_visite = session
        lot_id = str(uuid.uuid4())
        c, r = self.lot([self.visite(session, self.marie)], lot_id)
        self.controle("visite d'une personne de l'espace : une ligne", (r.get("lignes") or {}).get("creees") == 1 and r.get("ok") is True,
                      f"{c} {json.dumps(r, ensure_ascii=False)[:200]}")
        l = self.fiches(session)
        self.controle("la ligne est sous la fiche de Marie, avec son premier chemin", len(l) == 1 and l[0]["personId"] == self.personne
                      and l[0]["premierChemin"] == "/tarifs" and l[0]["dureeS"] == 540 and l[0]["pagesVues"] == 2 and l[0]["origineVeridian"] == "Analytics",
                      str(l)[:220])

        c, r = self.lot([self.visite(session, self.marie)], lot_id)
        self.controle("le même lot rejoué n'ajoute rien", r.get("ok") is True and len(self.fiches(session)) == 1 and
                      (r.get("lignes") or {}).get("creees", 0) == 0 and r.get("ignorees") == [{"session_id": session, "raison": "inchangee"}],
                      json.dumps(r, ensure_ascii=False)[:200])

        c, r = self.lot([self.visite(session, self.marie, duree_s=1200, pages_vues=5, chemins=["/tarifs", "/contact", "/devis"],
                                     fin=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 5)))])
        l = self.fiches(session)
        self.controle("visite prolongée : la ligne se complète (durée, pages, chemins)", (r.get("lignes") or {}).get("avancees") == 1 and
                      l and l[0]["dureeS"] == 1200 and l[0]["pagesVues"] == 5 and "/devis" in (l[0]["chemins"] or ""), str(l)[:240])
        fin_haute = l[0]["fin"]
        c, r = self.lot([self.visite(session, self.marie, duree_s=60, pages_vues=1, chemins=["/tarifs"])])
        l = self.fiches(session)
        self.controle("renvoi plus court : rien ne recule", r.get("ok") is True and l and l[0]["dureeS"] == 1200 and
                      l[0]["pagesVues"] == 5 and l[0]["fin"] == fin_haute and len(l) == 1, str(l)[:240])

        inconnu, s2 = f"inconnu@{self.dom}", f"sess-{uuid.uuid4().hex[:12]}"
        c, r = self.lot([self.visite(s2, inconnu)])
        self.controle("contact inconnu : ignoré (contact_inconnu), aucune personne, aucune ligne",
                      (r.get("lignes") or {}).get("ignorees") == 1 and r.get("ignorees") == [{"session_id": s2, "raison": "contact_inconnu"}]
                      and not self.personnes(inconnu) and not self.fiches(s2), json.dumps(r, ensure_ascii=False)[:200])

        s3 = f"sess-{uuid.uuid4().hex[:12]}"
        self.refus("refus : l'app Mail", self.jeton_visite(act={"sub": "app:notifuse"}), 403, "delegation_forbidden", outil=OUTIL,
                   arguments={"kind": "visite", "visites": [self.visite(s3, self.marie)]})
        self.refus("refus : la portée du journal Mail", self.jeton_visite(scope="crm:mail.ecrire"), 403, "delegation_forbidden", outil=OUTIL,
                   arguments={"kind": "visite", "visites": [self.visite(s3, self.marie)]})
        self.refus("refus : la portée des tâches seule", self.jeton_visite(scope="crm:tache.ecrire"), 403, "delegation_forbidden", outil=OUTIL,
                   arguments={"kind": "visite", "visites": [self.visite(s3, self.marie)]})
        self.refus("refus : un membre", self.jeton_visite(sub=self.sub), 403, "delegation_forbidden", outil=OUTIL,
                   arguments={"kind": "visite", "visites": [self.visite(s3, self.marie)]})
        self.refus("refus : l'outil d'un autre plugin", self.jeton_visite(), 403, "delegation_forbidden", outil="app_evenements_mail",
                   arguments={"kind": "visite", "visites": [self.visite(s3, self.marie)]})
        c, r = self.repondre({"kind": "visite", "visites": [self.visite(s3, self.marie)]}, self.jeton_visite(act=None))
        self.controle("sans act : refus", c == 401, f"{c} {json.dumps(r)[:120]}")
        self.controle("aucune ligne après les refus", not self.fiches(s3), str(self.fiches(s3))[:120])

    def repondre(self, args, jeton):
        return self.appel(jeton, OUTIL, args)

    def capture(self, dossier):
        code, texte, _ = self.c.signe("/api/sso/issue-magic-link", {"hub_user_id": self.hub_user, "email": self.a.email, "email_proven": True})
        lien = json.loads(texte).get("magic_link_url") if code == 200 else None
        if not lien:
            print(f"capture : lien magique refusé ({code})")
            return False
        subprocess.run(["scp", "-q", str(ICI / "capture-onglet.py"), "node02:/tmp/capture-onglet.py"], check=False)
        r = subprocess.run(["ssh", "node02", "rm -rf /tmp/capture-onglet-out; nice -n 10 $HOME/.cache/veridian-parcours-venv/bin/python "
                            f"/tmp/capture-onglet.py {self.origine} /object/person/{self.personne} Visites /tmp/capture-onglet-out /tarifs"],
                           input=lien + "\n", capture_output=True, text=True, timeout=600)
        Path(dossier).mkdir(parents=True, exist_ok=True)
        subprocess.run(["scp", "-q", "node02:/tmp/capture-onglet-out/*.png", dossier], check=False)
        vu = r.stdout.strip().startswith("VU")
        self.controle("onglet Visites de la fiche, la ligne visible à l'écran", vu, (r.stdout + r.stderr)[-200:])
        return vu

    def ranger(self):
        for q, f in (("delete", {"hubExtId": {"startsWith": "analytics:visite:"}}),):
            try:
                self.gql(f"mutation($f:VisiteFilterInput!){{{q}Visites(filter:$f){{id}}}}", f=f)
            except ta.Echec as e:
                print(f"nettoyage : {e}")
        if getattr(self, "personne", None):
            try:
                self.gql("mutation($id:UUID!){deletePerson(id:$id){id}}", id=self.personne)
            except ta.Echec as e:
                print(f"nettoyage personne : {e}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--captures", default="/tmp/preuve-visites")
    a = p.parse_args()
    a.autre_tenant = None
    e = None
    try:
        e = Epreuve(a)
        e.hub_user = ta.lire_creds()[f"{ta.prefixe('staging', a.espace)}_JETABLE_HUB_USER_ID"]
        e.jouer()
        e.capture(a.captures)
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code
    finally:
        if e:
            e.ranger()
    print(f"captures : {a.captures}")
    print("VERDICT :", "dossier Visites conforme" if not e.echecs else f"ÉCHEC {e.echecs}")
    return 0 if not e.echecs else 1


if __name__ == "__main__":
    sys.exit(main())
