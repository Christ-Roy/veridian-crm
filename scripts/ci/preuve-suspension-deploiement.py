#!/usr/bin/env python3
"""Preuve que le 200 de suspend (et de resume) vaut dans tous les serveurs pendant un déploiement, sur un espace jetable.

  preuve-suspension-deploiement.py <espace jetable> --duree <secondes> [--env staging] [--sabotage]

Cycles suspension et reprise à lancer AVANT le déploiement : lecture et geste (createApiKey) tentés sans cesse, chacun sur une
connexion neuve, après chaque 200. --sabotage : la suspension n'est pas envoyée, l'épreuve doit sortir en 1.
Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import json
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

GESTE = "mutation($i:CreateApiKeyInput!){createApiKey(input:$i){id}}"
OUVERT, FERME, MUET = "ouvert", "fermé", "sans réponse"


class Epreuve:
    def __init__(self, a):
        self.a, self.c = a, ta.Client(a.env)
        acces, p = ta.lire_creds(), ta.prefixe(a.env, a.espace)
        self.tenant = acces.get(f"{p}_JETABLE_TENANT_ID")
        if not self.tenant:
            raise ta.Echec(f"{a.espace} n'est pas un espace jetable", 2)
        self.email = acces[f"{p}_EMAIL"]
        self.entrer()
        roles = self.c.gql(self.origine, "{getApiKeyRoles{id label}}", jeton=self.jeton)["getApiKeyRoles"]
        self.role = next(r["id"] for r in roles if r["label"] == "Admin")
        self.compte = {}

    def entrer(self):
        self.origine, self.jeton, _ = self.c.session(self.email, self.a.espace)
        self.entree = time.time()

    def tenter(self, chemin, requete, variables=None):
        try:
            code, texte, _ = self.c.http(self.origine + chemin, json.dumps({"query": requete, "variables": variables or {}}).encode(),
                                         {"Content-Type": "application/json", "Origin": self.origine, "Authorization": f"Bearer {self.jeton}"})
            d = json.loads(texte)
        except (ta.Echec, ValueError, OSError):
            return MUET
        if code == 200 and d.get("data") and not d.get("errors"):
            return OUVERT
        return FERME if "suspended" in texte.lower() else MUET

    def lecture(self):
        return self.tenter("/graphql", "{companies{totalCount}}")

    def geste(self):
        expire = (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        return self.tenter("/metadata", GESTE, {"i": {"name": "epreuve", "expiresAt": expire, "roleId": self.role}})

    def sonder(self, secondes, attendu, phase):
        """Rend les écarts : réponses contraires à l'attendu, avec leur délai après le 200."""
        t0, ecarts, verrou = time.time(), [], threading.Lock()

        def boucle(nom, essai):
            while time.time() - t0 < secondes:
                depart = time.time() - t0
                r = essai()
                with verrou:
                    self.compte[(phase, nom, r)] = self.compte.get((phase, nom, r), 0) + 1
                    if r not in (attendu, MUET):
                        ecarts.append((nom, round(depart, 2)))
                time.sleep(0.1)

        fils = [threading.Thread(target=boucle, args=x) for x in (("lecture", self.lecture), ("lecture", self.lecture), ("geste", self.geste))]
        for f in fils:
            f.start()
        for f in fils:
            f.join()
        return ecarts

    def ordre(self, chemin, corps):
        for _ in range(5):
            try:
                code, _, _ = self.c.signe(chemin, corps)
            except ta.Echec:
                code = 0
            if code == 200:
                return
            time.sleep(2)
        raise ta.Echec(f"{chemin} sans 200", 2)

    def jouer(self):
        fin, cycles, faux = time.time() + self.a.duree, 0, []
        try:
            while time.time() < fin:
                if time.time() - self.entree > 600:
                    self.entrer()
                if not self.a.sabotage:
                    self.ordre("/api/tenants/suspend", {"tenant_id": self.tenant, "reason": "admin_action"})
                h = datetime.now(timezone.utc).strftime("%T")
                apres = self.sonder(5, FERME, "suspendu")
                self.ordre("/api/tenants/resume", {"tenant_id": self.tenant})
                rendu = self.sonder(1.5, OUVERT, "repris")
                cycles += 1
                faux += apres + rendu
                print(f"{h} cycle {cycles} : {len(apres)} ouverture(s) après le 200 de suspend {apres[-3:]}, "
                      f"{len(rendu)} refus après le 200 de resume {rendu[-3:]}", flush=True)
        finally:
            self.ordre("/api/tenants/resume", {"tenant_id": self.tenant})
        for k, n in sorted(self.compte.items()):
            print(*k, n)
        manque = [(p, n) for p, n, r in (("suspendu", "lecture", FERME), ("suspendu", "geste", FERME), ("repris", "lecture", OUVERT),
                                         ("repris", "geste", OUVERT)) if not self.compte.get((p, n, r))]
        if faux:
            print(f"FAUX : {len(faux)} écart(s), le plus tardif {max(t for _, t in faux)} s après le 200")
            return 1
        if manque:
            print(f"NON ABOUTI : jamais vu {manque}")
            return 2
        print(f"VRAI : {cycles} cycles, aucun écart après un 200")
        return 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--duree", type=int, required=True)
    p.add_argument("--env", default="staging", choices=("staging", "prod"))
    p.add_argument("--sabotage", action="store_true")
    try:
        return Epreuve(p.parse_args()).jouer()
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code


if __name__ == "__main__":
    sys.exit(main())
