#!/usr/bin/env python3
"""Preuve que le premier jeton d'action valide installe Liaisons, sous les gardes d'installation, sur le staging seulement.

  preuve-app-deleguee.py <espace jetable sans Liaisons> --admin-instance <email> --editeur <ss-dom de l'éditeur>

Épreuves : app fermée (refus nommé, rien d'installé), app ouverte et trois premiers appels simultanés (une installation, un
envoi sans doublon), désinstallée par un admin (ne revient pas seule), réinstallée à la main (l'envoi repart).
Le drapeau d'instance est remis comme trouvé. Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import importlib.util
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ICI = Path(__file__).parent
sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

LIAISONS = "1a1ab23e-60e5-4eca-be1f-718c96055c79"


def charger(nom):
    spec = importlib.util.spec_from_file_location(nom.replace("-", "_"), ICI / f"{nom}.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


envoi = charger("preuve-envoi-crm")


class Epreuve(envoi.Epreuve):
    def __init__(self, a):
        creds, p = ta.lire_creds(), ta.prefixe("staging", a.espace)
        a.tenant, a.email = creds.get(f"{p}_JETABLE_TENANT_ID"), creds.get(f"{p}_EMAIL")
        if not a.tenant:
            raise ta.Echec(f"{a.espace} n'est pas un espace jetable", 2)
        super().__init__(a)
        self.url_cle, self.cle_api = ta._cle("staging", a.espace)
        url_ed, cle_ed = ta._cle("staging", a.editeur)
        self.o_inst, self.s_inst, _ = self.c.session(a.admin_instance, a.editeur)
        self.reg = ta._registre(self.c, url_ed, cle_ed, LIAISONS)
        self.depart = self.ouverte()

    def ouverte(self):
        return self.c.gql(self.o_inst, "query($i:String!){findOneAdminApplicationRegistration(id:$i){isListed}}",
                          {"i": self.reg["id"]}, self.s_inst, "/admin-panel")["findOneAdminApplicationRegistration"]["isListed"]

    def ouvrir(self, valeur):
        self.c.gql(self.o_inst, "mutation($i:AdminUpdateApplicationRegistrationInput!){updateAdminApplicationRegistration(input:$i){id}}",
                   {"i": {"id": self.reg["id"], "update": {"isListed": valeur}}}, self.s_inst, "/admin-panel")
        if self.ouverte() is not valeur:
            raise ta.Echec("le drapeau n'a pas pris", 2)

    def version(self):
        return (ta._installees(self.c, self.url_cle, self.cle_api).get(LIAISONS) or {}).get("version")

    def meta(self, q, **v):
        return ta._gql_cle(self.c, self.url_cle, self.cle_api, q, v, "/metadata")

    def jouer(self):
        if self.version():
            raise ta.Echec("Liaisons est déjà installée : il faut un espace neuf", 2)
        self.ouvrir(False)
        self.refus("app fermée : refus nommé", self.jeton(), 403, "app_not_available")
        self.controle("app fermée : rien d'installé", self.version() is None, str(self.version()))

        self.ouvrir(True)
        self.refus("autre outil : rien d'installé", self.jeton(), 403, "delegation_forbidden", outil="delete_many_companies", arguments={})
        self.controle("toujours rien après un jeton refusé", self.version() is None, str(self.version()))
        t = time.time()
        with ThreadPoolExecutor(3) as pool:
            r = list(pool.map(lambda j: self.appel(j), [self.jeton() for _ in range(3)]))
        dur = time.time() - t
        bons = [x for x in r if x[1].get("ok") is True]
        autres = [x for x in r if x[1].get("ok") is not True and x[1].get("error") != "app_installing"]
        self.controle("trois premiers appels : l'app se pose, l'envoi passe", bool(bons) and not autres,
                      f"{dur:.0f} s {json.dumps(r, ensure_ascii=False)[:220]}")
        self.controle("installée une fois", bool(self.version()), str(self.version()))
        self.controle("1 société, 1 contact, 1 tâche, deux liens", self.compte() == [1, 1, 1, 2], str(self.compte()))
        lignes = self.gql("{liaisons{edges{node{app}}}}")["liaisons"]["edges"]
        self.controle("une seule ligne de réglages", len(lignes) == 1, str(lignes))
        c, r = self.appel(self.jeton())
        self.controle("second appel : déjà là, sans doublon", r.get("ok") is True and r.get("rejoue") is True and
                      self.compte() == [1, 1, 1, 2], json.dumps(r, ensure_ascii=False)[:160])
        self.nettoyer()

        self.meta("mutation($u:String!){uninstallApplication(universalIdentifier:$u)}", u=LIAISONS)
        for _ in range(30):
            if not self.version():
                break
            time.sleep(2)
        self.refus("désinstallée par un admin : ne revient pas seule", self.jeton(), 403, "app_uninstalled")
        self.controle("toujours désinstallée", self.version() is None, str(self.version()))
        self.meta("mutation($u:String!){installApplication(universalIdentifier:$u){id version}}", u=LIAISONS)
        self.siren = "8" + self.siren[1:]
        fin = time.time() + 90
        while time.time() < fin:
            c, r = self.appel(self.jeton())
            if r.get("ok") is True:
                break
            time.sleep(5)
        self.controle("réinstallée à la main : l'envoi repart", r.get("ok") is True, json.dumps(r, ensure_ascii=False)[:160])


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--admin-instance", required=True)
    p.add_argument("--editeur", required=True)
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
            try:
                e.nettoyer()
            finally:
                e.ouvrir(e.depart)
    print("VERDICT :", "installation au premier appel conforme" if not e.echecs else f"ÉCHEC {e.echecs}")
    return 0 if not e.echecs else 1


if __name__ == "__main__":
    sys.exit(main())
