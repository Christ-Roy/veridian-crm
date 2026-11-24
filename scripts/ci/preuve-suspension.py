#!/usr/bin/env python3
"""Preuve de la suspension d'un espace (CONTRAT-HUB §5.4), staging seulement.

Espace jetable A suspendu puis repris, espace témoin B jamais touché. Contrôles : suspension signée, idempotence,
by-email qui rend « suspended », lecture refusée sur A pendant la suspension, données de A comptées avant et après
(aller, retour), B lisible et inchangé pendant toute la suspension, reprise qui rend A lisible.

  preuve-suspension.py <espace jetable A> <espace témoin B>

Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
Le webhook sortant silencieux pendant la suspension n'est pas couvert ici (voir le rapport du patch).
"""
import argparse
import sys
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

COMPTE = "{ people { totalCount } }"  # gql() rend (statut, corps, entêtes) : à vérifier au premier passage


class Epreuve:
    def __init__(self, a):
        self.a = a
        self.c = ta.Client("staging")
        creds = ta.lire_creds()
        pa, pb = ta.prefixe("staging", a.espace), ta.prefixe("staging", a.temoin)
        self.tenant = creds.get(f"{pa}_JETABLE_TENANT_ID")
        self.tenant_b = creds.get(f"{pb}_JETABLE_TENANT_ID")
        if not self.tenant or not self.tenant_b:
            raise ta.Echec("deux espaces jetables attendus (A et témoin B)", 2)
        self.email = creds[f"{pa}_EMAIL"]
        self.email_b = creds[f"{pb}_EMAIL"]
        self.origine, self.admin, _ = self.c.session(self.email, a.espace)
        self.origine_b, self.admin_b, _ = self.c.session(self.email_b, a.temoin)
        self.echecs = []

    def controle(self, nom, ok, detail=""):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:230])
        if not ok:
            self.echecs.append(nom)

    def compte(self, origine, jeton):
        status, corps, _ = self.c.gql(origine, COMPTE, jeton=jeton)
        return corps if status == 200 else None

    def suspendre(self, tenant, raison="admin_action"):
        return self.c.signe("/api/tenants/suspend", {"tenant_id": tenant, "reason": raison})

    def reprendre(self, tenant):
        return self.c.signe("/api/tenants/resume", {"tenant_id": tenant})

    def jouer(self):
        avant_a = self.compte(self.origine, self.admin)
        avant_b = self.compte(self.origine_b, self.admin_b)
        self.controle("comptes avant (A et B) lisibles", avant_a is not None and avant_b is not None,
                      f"A={avant_a} B={avant_b}")
        if avant_a is None or avant_b is None:
            raise ta.Echec("comptes initiaux illisibles, rien n'a été suspendu", 2)

        st, corps, _ = self.suspendre(self.tenant)
        self.controle("suspension signée rend 200 et suspended_at", st == 200 and "suspended_at" in corps, f"HTTP {st}")
        st2, corps2, _ = self.suspendre(self.tenant)
        self.controle("suspension rejouée, idempotente", st2 == 200, f"HTTP {st2}")

        st3, corps3, _ = self.c.signe("/api/users/by-email?email=" + quote(self.email), None, "GET")
        self.controle("by-email rend suspended pour A", st3 == 200 and "suspended" in corps3, f"HTTP {st3}")

        pendant_a = self.compte(self.origine, self.admin)
        self.controle("lecture refusée sur A pendant la suspension", pendant_a is None, f"réponse={pendant_a}")
        pendant_b = self.compte(self.origine_b, self.admin_b)
        self.controle("témoin B lisible et inchangé pendant la suspension", pendant_b == avant_b, f"B={pendant_b}")

        st4, _, _ = self.reprendre(self.tenant)
        self.controle("reprise rend 200", st4 == 200, f"HTTP {st4}")
        apres_a = self.compte(self.origine, self.admin)
        self.controle("comptes après reprise identiques à avant", apres_a == avant_a, f"A={apres_a} avant={avant_a}")
        apres_b = self.compte(self.origine_b, self.admin_b)
        self.controle("témoin B identique après l'aller-retour", apres_b == avant_b, f"B={apres_b}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("espace")
    p.add_argument("temoin")
    a = p.parse_args()
    try:
        e = Epreuve(a)
        e.jouer()
    except ta.Echec as err:
        print(f"NON ABOUTI : {err}")
        return err.code
    if e.echecs:
        print(f"FAUX : {len(e.echecs)} contrôle(s) en échec")
        return 1
    print("VRAI : suspension et reprise sans perte, témoin intact")
    return 0


if __name__ == "__main__":
    sys.exit(main())
