#!/usr/bin/env python3
"""Preuve du dossier Mail d'une fiche (contrat Hub §5.25, Liaisons 0.7) sur le staging : jeton `integration:<tenant>`, act
app:notifuse, portée crm:mail.ecrire, signé avec la clé du Hub de staging, vers l'outil MCP app_evenements_mail.

  preuve-journal-mail.py <espace jetable> [--captures <dossier>]

Épreuves : une personne de l'espace reçoit un envoi (une ligne), ouvert (le statut avance), un « remis » arrivé en retard
(le statut ne recule pas), le même lot rejoué (rien de plus) ; un destinataire inconnu (ignoré, aucune personne créée) ;
portée des tâches seule ou membre : refus. Capture de l'onglet Mail de la fiche (Chromium sur node02).
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
OUTIL = "app_evenements_mail"


class Epreuve(reponse.Epreuve):
    def jeton_journal(self, **plus):
        return self.jeton_mail(**{"scope": "crm:mail.ecrire", **plus})

    def lot(self, evenements, lot_id=None, jeton=None):
        return self.appel(jeton or self.jeton_journal(), OUTIL,
                          {"workspace_id": "epreuve", "lot_id": lot_id or str(uuid.uuid4()), "evenements": evenements})

    def ev(self, event, email, rfc, **plus):
        return {"event": event, "occurred_at": "2026-11-26T20:00:00Z", "rfc_message_id": rfc, "thread_id": self.fil,
                "recipient_email": email, "from_email": f"envoi@{self.dom}", "subject": "Épreuve du dossier Mail",
                "nature": "campaign", "list_id": "epreuve", **plus}

    def lignes(self, rfc):
        d = self.gql("query($f:EchangeMailFilterInput){echangeMails(filter:$f){edges{node{id statut sens nature objet personId}}}}",
                     f={"hubExtId": {"eq": f"notifuse:mail:{rfc}"}})
        return [e["node"] for e in d["echangeMails"]["edges"]]

    def personnes(self, email):
        d = self.gql("query($p:PersonFilterInput){people(filter:$p){edges{node{id}}}}",
                     p={"emails": {"primaryEmail": {"eq": email}}})
        return [e["node"]["id"] for e in d["people"]["edges"]]

    def jouer(self):
        self.marie = f"marie@{self.dom}"
        d = self.gql("mutation($d:PersonCreateInput!){createPerson(data:$d){id}}",
                     d={"name": {"firstName": "Marie", "lastName": "Épreuve"},
                        "emails": {"primaryEmail": self.marie, "additionalEmails": []}})
        self.personne = d["createPerson"]["id"]
        rfc = f"<{uuid.uuid4()}@{self.dom}>"
        lot_id = str(uuid.uuid4())

        # Liaisons posée à la naissance (VERIDIAN_BASE_APPS, job d'installation d'environ 30 s) : l'objet Mail existe sans aucun appel.
        fin, pose = time.monotonic() + 90, False
        while time.monotonic() < fin and not pose:
            try:
                self.gql("{echangeMails(first:1){edges{node{id}}}}")
                pose = True
            except ta.Echec:
                time.sleep(5)
        self.controle("Liaisons posée à la naissance de l'espace, avant tout appel", pose)
        debut = time.monotonic()
        c, r = self.lot([self.ev("message.sent", self.marie, rfc)], lot_id)
        duree = time.monotonic() - debut
        # Parente, 26/11 : Liaisons est posée à la naissance de l'espace ; un premier appel qui l'installe (16 s) fait un 503 chez Mail.
        self.controle("premier appel sous 2 s (rien à installer)", duree < 2, f"{duree:.1f} s")
        self.controle("envoi à une personne de l'espace : une ligne créée", (r.get("lignes") or {}).get("creees") == 1,
                      f"{c} {json.dumps(r, ensure_ascii=False)[:180]}")
        debut = time.monotonic()
        c, r = self.lot([self.ev("message.sent", self.marie, rfc)], lot_id)
        print(f"mesure : premier appel {duree:.1f} s, deuxième {time.monotonic() - debut:.1f} s")
        self.controle("le même lot rejoué : ok, rien de plus (le Hub ne réessaie pas)", r.get("ok") is True and len(self.lignes(rfc)) == 1 and
                      (r.get("lignes") or {}).get("creees", 0) == 0,
                      json.dumps(r, ensure_ascii=False)[:160])
        c, r = self.lot([self.ev("message.opened", self.marie, rfc)])
        self.controle("ouvert : le statut avance", (r.get("lignes") or {}).get("avancees") == 1 and self.lignes(rfc)[0]["statut"] == "OUVERT",
                      json.dumps(r, ensure_ascii=False)[:160])
        c, r = self.lot([self.ev("message.delivered", self.marie, rfc)])
        l = self.lignes(rfc)
        self.controle("« remis » arrivé en retard : le statut ne recule pas", len(l) == 1 and l[0]["statut"] == "OUVERT", str(l)[:160])
        self.controle("le bilan dit pourquoi : « inchangee » pour ce message", r.get("ignorees") == [{"rfc_message_id": rfc, "raison": "inchangee"}],
                      json.dumps(r, ensure_ascii=False)[:200])
        self.controle("la ligne est sur la fiche de Marie, envoyée, campagne", l and l[0]["personId"] == self.personne and
                      l[0]["sens"] == "ENVOYE" and l[0]["nature"] == "CAMPAGNE", str(l)[:200])

        rfc3 = f"<{uuid.uuid4()}@{self.dom}>"
        self.lot([self.ev("message.received", self.marie, rfc3, from_email=self.marie, nature="reply_human")])
        c, r = self.lot([self.ev("message.sent", self.marie, rfc3)])
        l = self.lignes(rfc3)
        self.controle("une ligne reçue ne prend pas de statut d'envoi (message.sent au même Message-ID)",
                      len(l) == 1 and l[0]["sens"] == "RECU" and l[0]["statut"] is None, str(l)[:160])
        rfc4 = f"<{uuid.uuid4()}@{self.dom}>"
        self.lot([self.ev("message.sent", self.marie, rfc4, subject=None)])
        self.lot([self.ev("message.opened", self.marie, rfc4, subject="Objet arrivé après")])
        l = self.lignes(rfc4)
        self.controle("objet manquant complété par l'événement suivant", len(l) == 1 and l[0]["objet"] == "Objet arrivé après" and
                      l[0]["statut"] == "OUVERT", str(l)[:160])

        inconnu, rfc2 = f"inconnu@{self.dom}", f"<{uuid.uuid4()}@{self.dom}>"
        c, r = self.lot([self.ev("message.sent", inconnu, rfc2)])
        self.controle("destinataire inconnu : ignoré, aucune personne, aucune ligne",
                      (r.get("lignes") or {}).get("ignorees") == 1 and not self.personnes(inconnu) and not self.lignes(rfc2) and
                      r.get("ignorees") == [{"rfc_message_id": rfc2, "raison": "destinataire_inconnu"}],
                      json.dumps(r, ensure_ascii=False)[:160])

        for nom, jeton in (("portée des tâches seule", self.jeton_mail()),
                           ("un membre", self.jeton(scope="crm:mail.ecrire", act={"sub": "app:notifuse"}))):
            c, r = self.lot([self.ev("message.clicked", self.marie, rfc)], jeton=jeton)
            self.controle(f"refus : {nom}", "delegation_forbidden" in json.dumps(r) and self.lignes(rfc)[0]["statut"] == "OUVERT",
                          f"{c} {json.dumps(r)[:120]}")

    def capture(self, dossier):
        code, texte, _ = self.c.signe("/api/sso/issue-magic-link", {"hub_user_id": self.hub_user, "email": self.a.email,
                                                                   "email_proven": True})
        lien = json.loads(texte).get("magic_link_url") if code == 200 else None
        if not lien:
            print(f"capture : lien magique refusé ({code})")
            return False
        script = ICI / "capture-onglet.py"
        subprocess.run(["scp", "-q", str(script), "node02:/tmp/capture-onglet.py"], check=False)
        r = subprocess.run(["ssh", "node02", "rm -rf /tmp/capture-onglet-out; nice -n 10 $HOME/.cache/veridian-parcours-venv/bin/python "
                            f"/tmp/capture-onglet.py {self.origine} /object/person/{self.personne} Mail /tmp/capture-onglet-out Ouvert"],
                           input=lien + "\n", capture_output=True, text=True, timeout=600)
        Path(dossier).mkdir(parents=True, exist_ok=True)
        subprocess.run(["scp", "-q", "node02:/tmp/capture-onglet-out/*.png", dossier], check=False)
        vu = r.stdout.strip().startswith("VU")
        self.controle("onglet Mail de la fiche, la ligne visible à l'écran", vu, (r.stdout + r.stderr)[-200:])
        return vu

    def ranger(self):
        for q, f in (("delete", {"hubExtId": {"startsWith": "notifuse:mail:<"}}),):
            try:
                self.gql(f"mutation($f:EchangeMailFilterInput!){{{q}EchangeMails(filter:$f){{id}}}}", f=f)
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
    p.add_argument("--chemin", default="nomad/jobs/hub-staging/stack/hub-staging")
    p.add_argument("--captures", default="/tmp/preuve-journal-mail")
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
    print("VERDICT :", "dossier Mail conforme" if not e.echecs else f"ÉCHEC {e.echecs}")
    return 0 if not e.echecs else 1


if __name__ == "__main__":
    sys.exit(main())
