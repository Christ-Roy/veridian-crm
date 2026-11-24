#!/usr/bin/env python3
"""Preuve de « Envoyer au CRM » (VER-246) sur le staging : jeton d'action à `act`, signé localement avec la clé du Hub de
staging (lue dans Nomad comme preuve-mcp-hub.py, jamais affichée), vers l'outil MCP app_envoyer_au_crm.

  preuve-envoi-crm.py <ss-dom> --email <admin> --tenant <tenant Hub> [--chemin nomad/jobs/hub-staging/stack/hub-staging]

Épreuves : sans act (refus), forge de l'origine, portée et outil étrangers, autre espace, rejeu du jeton, un clic, le même
clic, dix clics simultanés, saisie humaine gardée, corbeille. Les fiches d'épreuve sont détruites à la fin.
Refuse tout autre environnement que le staging. Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import base64
import json
import random
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import jwt

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

ISS = "https://hub.staging.veridian.site"
SCOPE = "crm:societe.ecrire crm:tache.ecrire"
OUTIL = "app_envoyer_au_crm"


def cle_du_hub(chemin):
    brut = subprocess.run(["nomad-v", "raw", "var", "get", "-item", "MCP_SIGNING_JWK", chemin],
                          capture_output=True, text=True, check=True).stdout.strip()
    jwk = json.loads(brut if brut.startswith("{") else base64.b64decode(brut).decode())
    return jwt.algorithms.ECAlgorithm.from_jwk(json.dumps(jwk)), jwk["kid"]


class Epreuve:
    def __init__(self, a):
        self.a = a
        self.c = ta.Client("staging")
        self.origine, self.session, self.ws = self.c.session(a.email, a.espace)
        self.url = self.c.base + "/mcp"
        self.cle, self.kid = cle_du_hub(a.chemin)
        hub = next(u for u in self.c.utilisateurs() if (u["email"] or "").lower() == a.email.lower())
        self.sub = hub["hub_user_id"]
        self.siren = "9" + "".join(random.choice("0123456789") for _ in range(8))
        self.echecs, self.nuls = [], []

    def jeton(self, **plus):
        t = int(time.time())
        claims = {"iss": ISS, "aud": self.url, "sub": self.sub, "email": self.a.email, "email_verified": True, "iat": t,
                  "exp": t + 120, "jti": str(uuid.uuid4()), "tenant_id": self.a.tenant, "scope": SCOPE,
                  "act": {"sub": "app:prospection"}, **plus}
        return jwt.encode({k: v for k, v in claims.items() if v is not None}, self.cle, algorithm="ES256",
                          headers={"kid": self.kid})

    def appel(self, jeton, outil=OUTIL, arguments=None, methode="tools/call"):
        corps = {"jsonrpc": "2.0", "id": 1, "method": methode, "params": {"name": outil, "arguments": arguments or self.envoi()}}
        code, texte, _ = self.c.http(self.url, json.dumps(corps).encode(), {
            "Authorization": f"Bearer {jeton}", "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream"})
        charge = next((x[5:] for x in texte.splitlines() if x.startswith("data:")), texte)
        try:
            d = json.loads(charge)
        except ValueError:
            return code, {"brut": texte[:200]}
        if "result" not in d:
            return code, (d.get("error") or {}).get("data") or d
        try:
            r = json.loads(d["result"]["content"][0]["text"])
        except (KeyError, ValueError):
            return code, d
        return code, r.get("result", r) if isinstance(r, dict) else r

    def envoi(self):
        return {"siren": self.siren,
                "societe": {"nom": f"EPREUVE {self.siren}", "domaine": f"epreuve-{self.siren}.fr", "ville": "Lyon"},
                "contact": {"prenom": "Jean", "nom": "Épreuve", "email": f"jean@epreuve-{self.siren}.fr"},
                "tache": {"note": "Rappel d'épreuve"}}

    def gql(self, q, **v):
        return self.c.gql(self.origine, q, v, self.session, "/graphql")

    def fiches(self):
        d = self.gql("query($s:CompanyFilterInput,$p:PersonFilterInput,$t:TaskFilterInput){"
                     "companies(filter:$s){edges{node{id name hubExtId origineVeridian address{addressCity} createdBy{source name}}}} "
                     "people(filter:$p){edges{node{id companyId hubExtId origineVeridian jobTitle}}} "
                     "tasks(filter:$t){edges{node{id title hubExtId origineVeridian assigneeId taskTargets{edges{node{id}}}}}}}",
                     s={"hubExtId": {"eq": f"prospection:siren:{self.siren}"}},
                     p={"hubExtId": {"startsWith": f"prospection:contact:{self.siren}:"}},
                     t={"hubExtId": {"eq": f"prospection:appel:{self.siren}"}})
        return {k: [e["node"] for e in d[k]["edges"]] for k in ("companies", "people", "tasks")}

    def compte(self):
        f = self.fiches()
        liens = sum(len(t["taskTargets"]["edges"]) for t in f["tasks"])
        return [len(f["companies"]), len(f["people"]), len(f["tasks"]), liens]

    def controle(self, nom, ok, detail=""):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:300])
        if not ok:
            self.echecs.append(nom)

    def refus(self, nom, jeton, code, erreur, **kw):
        c, r = self.appel(jeton, **kw)
        self.controle(nom, c == code and erreur in json.dumps(r), f"{c} {json.dumps(r, ensure_ascii=False)[:150]}")

    def jouer(self):
        c, r = self.appel(self.jeton(act=None, scope="veridian"))
        if "not found" in json.dumps(r):
            raise ta.Echec(f"{OUTIL} absent de {self.a.espace} : plugin liaisons non installé", 2)
        self.controle("sans act : l'action refuse", r.get("erreur") == "act_requis", json.dumps(r, ensure_ascii=False)[:150])
        c, r = self.appel(self.jeton(act=None, scope="veridian"),
                          arguments={**self.envoi(), "_veridian": {"app": "app:prospection", "jti": "forge"}})
        self.controle("sans act, origine forgée : refus", r.get("erreur") == "act_requis", json.dumps(r, ensure_ascii=False)[:150])
        self.refus("act : autre outil", self.jeton(), 403, "delegation_forbidden", outil="delete_many_companies", arguments={})
        self.refus("act : liste des outils", self.jeton(), 403, "delegation_forbidden", methode="tools/list")
        self.refus("act : portée incomplète", self.jeton(scope="crm:societe.ecrire"), 403, "delegation_forbidden")
        self.refus("act : autre app", self.jeton(act={"sub": "app:notifuse"}), 403, "delegation_forbidden")
        self.refus("act : sans espace", self.jeton(tenant_id=None), 403, "tenant_required")
        self.refus("act : espace inconnu", self.jeton(tenant_id=str(uuid.uuid4())), 403, "tenant_not_linked")
        self.refus("act : jeton trop long", self.jeton(exp=int(time.time()) + 300), 401, "invalid_act")
        if self.a.autre_tenant:
            self.refus("act : espace dont il n'est pas membre", self.jeton(tenant_id=self.a.autre_tenant), 403, "tenant_forbidden")
        self.controle("aucune fiche après les refus", self.compte() == [0, 0, 0, 0], str(self.compte()))

        unique = self.jeton()
        c, r = self.appel(unique)
        self.controle("un clic : société, contact, tâche", r.get("ok") is True and r.get("rejoue") is False, json.dumps(r, ensure_ascii=False)[:200])
        self.controle("un clic : 1, 1, 1 et deux liens", self.compte() == [1, 1, 1, 2], str(self.compte()))
        self.refus("le même jeton : refus", unique, 401, "token_replayed")
        f = self.fiches()
        tout = f["companies"] + f["people"] + f["tasks"]
        self.controle("origine visible sur les trois fiches", len(tout) == 3 and all(x["origineVeridian"] == "Prospection" for x in tout),
                      str(f["companies"][0]["createdBy"] if f["companies"] else ""))
        c, r = self.appel(self.jeton())
        self.controle("le même clic ne crée rien", r.get("rejoue") is True and self.compte() == [1, 1, 1, 2], json.dumps(r, ensure_ascii=False)[:200])

        if len(tout) == 3:
            self.gql("mutation($i:UUID!,$d:CompanyUpdateInput!){updateCompany(id:$i,data:$d){id}}", i=f["companies"][0]["id"],
                     d={"name": "SAISI PAR UN HUMAIN", "address": {"addressCity": "Paris"}})
            self.gql("mutation($i:UUID!,$d:TaskUpdateInput!){updateTask(id:$i,data:$d){id}}", i=f["tasks"][0]["id"],
                     d={"title": "Tâche reprise", "assigneeId": None})
            c, r = self.appel(self.jeton())
            g = self.fiches()
            garde = (g["companies"][0]["name"] == "SAISI PAR UN HUMAIN" and g["companies"][0]["address"]["addressCity"] == "Paris"
                     and g["tasks"][0]["title"] == "Tâche reprise" and g["tasks"][0]["assigneeId"] is None)
            self.controle("la saisie humaine reste", garde, json.dumps(r, ensure_ascii=False)[:160])
            self.gql("mutation($i:UUID!){deleteCompany(id:$i){id}}", i=f["companies"][0]["id"])
            c, r = self.appel(self.jeton())
            self.controle("corbeille : ni recréée ni restaurée", r.get("societe", {}).get("etat") == "corbeille" and not self.fiches()["companies"],
                          json.dumps(r, ensure_ascii=False)[:160])
        self.nettoyer()

        self.siren = "8" + self.siren[1:]
        with ThreadPoolExecutor(10) as ex:
            rs = list(ex.map(lambda _: self.appel(self.jeton()), range(10)))
        bons = [r for c, r in rs if c == 200 and r.get("ok") is True]
        self.controle("dix clics simultanés : 1, 1, 1 et deux liens", self.compte() == [1, 1, 1, 2] and bool(bons),
                      f"{self.compte()} ; {len(bons)}/10 abouties")
        self.controle("dix clics simultanés : aucun échec rendu", len(bons) == 10, str([r for c, r in rs if r not in bons][:1])[:200])

    def nettoyer(self):
        for objet, mut, filtre in (("tasks", "destroyTasks", "TaskFilterInput"), ("people", "destroyPeople", "PersonFilterInput"),
                                   ("companies", "destroyCompanies", "CompanyFilterInput")):
            cle = {"tasks": f"prospection:appel:{self.siren}", "people": f"prospection:contact:{self.siren}:",
                   "companies": f"prospection:siren:{self.siren}"}[objet]
            f = {"hubExtId": {"startsWith": cle}}
            supprime = mut.replace("destroy", "delete")
            for m in (supprime, mut):
                g = f if m == supprime else {"and": [f, {"deletedAt": {"is": "NOT_NULL"}}]}
                try:
                    self.gql(f"mutation($f:{filtre}!){{{m}(filter:$f){{id}}}}", f=g)
                except ta.Echec as e:
                    print(f"nettoyage {objet} : {e}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--email", required=True)
    p.add_argument("--tenant", required=True)
    p.add_argument("--autre-tenant")
    p.add_argument("--chemin", default="nomad/jobs/hub-staging/stack/hub-staging")
    a = p.parse_args()
    e = None
    try:
        e = Epreuve(a)
        e.jouer()
    except ta.Echec as err:
        print(f"{'NON ABOUTI' if err.code == 2 else 'ECHEC'} {err}")
        return err.code
    except subprocess.CalledProcessError:
        print("NON ABOUTI clé du Hub de staging illisible")
        return 2
    finally:
        if e:
            e.nettoyer()
    print("VERDICT :", "envoi conforme" if not e.echecs else f"ÉCHEC {e.echecs}")
    return 0 if not e.echecs else 1


if __name__ == "__main__":
    sys.exit(main())
