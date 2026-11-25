#!/usr/bin/env python3
"""Preuve qu'un redémarrage de Redis ne perd rien, et durée de la coupure vue par un utilisateur, sur un espace jetable.

  preuve-redemarrage-redis.py <espace jetable> [--env staging] --declencher "<commande>" [--apres 150] [--sabotage]

Avant : fiche, webhook signé, tâche différée posée en file (webhook reporté par une suspension, 5 min), workflow planifié chaque
minute, écran ouvert. Pendant, sans arrêt : écriture REST, lecture GraphQL, rafraîchissement de session, écran rechargé.
Après : chaque fiche acceptée existe une seule fois, son webhook est arrivé, la tâche différée aussi, le planifié n'a sauté aucune
minute, les sessions d'avant servent encore. --sabotage : le récepteur jette un webhook sur dix, l'épreuve doit sortir en 1.
Codes : 0 vrai (et coupure sous --borne), 1 faux, 2 mesure non aboutie.
"""
import argparse
import importlib.util
import json
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

spec = importlib.util.spec_from_file_location("preuve_suspension", Path(__file__).with_name("preuve-suspension.py"))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

PAGE = 60
ERREURS = ("Unable to", "went wrong", "back-end", "Reload", "Erreur", "Error")


class Recepteur(ta._Recepteur):
    """Comme celui de twenty-admin, plus l'identifiant de la fiche portée par chaque webhook."""
    fiches, sabotage, vus = [], False, 0

    def do_POST(self):
        corps = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        type(self).vus += 1
        if self.sabotage and self.vus % 10 == 0:
            self.send_response(200)
            self.end_headers()
            return
        attendu = ta.hmac.new(ta._Recepteur.secret.encode(), f"{self.headers.get('X-Twenty-Webhook-Timestamp', '')}:".encode() + corps,
                              ta.hashlib.sha256).hexdigest()
        valide = ta.hmac.compare_digest(attendu, self.headers.get("X-Twenty-Webhook-Signature", ""))
        charge = json.loads(corps)
        ta._Recepteur.recus.append((charge.get("eventName"), valide))
        self.fiches.append((charge.get("eventName"), (charge.get("record") or {}).get("id"), valide))
        self.send_response(200 if valide else 401)
        self.end_headers()


class Redemarrage(base.Epreuve):
    def mcp_appel(self, outil, arguments):
        code, texte, _ = self.c.http(self.origine + "/mcp", json.dumps({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": outil, "arguments": arguments}}).encode(),
            {"Authorization": f"Bearer {self.session_a}", "Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
        lignes = [json.loads(x[5:]) for x in texte.splitlines() if x.startswith("data:")] or [json.loads(texte)]
        return code, lignes[-1]

    def planifier(self):
        etape = str(uuid.uuid4())
        _, r = self.mcp_appel("create_complete_workflow", {
            "name": "Épreuve Redis", "activate": True,
            "trigger": {"name": "Chaque minute", "type": "CRON", "position": {"x": 0, "y": 0}, "nextStepIds": [etape],
                        "settings": {"type": "CUSTOM", "pattern": "* * * * *", "outputSchema": {}}},
            "steps": [{"id": etape, "name": "Créer", "valid": True, "type": "CREATE_RECORD", "nextStepIds": [], "position": {"x": 0, "y": 150},
                       "settings": {"input": {"objectName": "note", "objectRecord": {"title": "planifie"}}, "outputSchema": {},
                                    "errorHandlingOptions": {"retryOnFailure": {"value": 0}, "continueOnFailure": {"value": False}}}}],
            "edges": [{"source": "trigger", "target": etape}]})
        detail = json.dumps(r, ensure_ascii=False)
        self.controle("workflow planifié chaque minute créé", '"success": true' in detail or '\\"success\\":true' in detail, detail[:170])

    def planifies(self):
        _, texte = self.rest(self.origine, self.cle, chemin="/rest/notes?filter=title%5Beq%5D:planifie&limit=60")
        return sorted(n["createdAt"] for n in json.loads(texte)["data"]["notes"])

    def membre(self):
        hub, mail = str(uuid.uuid4()), f"e2e-redis-{uuid.uuid4().hex[:8]}@veridian.site"
        code, _, _ = self.c.signe(f"/api/veridian/workspaces/{self.ws['id']}/attach-member", {
            "hub_user_id": hub, "email": mail, "hub_user_email": mail, "email_proven": True, "role": "member"})
        if code != 201:
            raise ta.Echec(f"attach-member {code}", 2)
        return hub, mail

    def boucle(self, nom, essai, pas):
        while not self.fini:
            t = time.time()
            try:
                ok = essai()
            except Exception as e:  # noqa: BLE001
                ok = f"{type(e).__name__}"
            self.mesures[nom].append((t, time.time(), ok))
            time.sleep(max(0.0, pas - (time.time() - t)))

    def ecrire(self):
        self.rang += 1
        nom = f"E{self.rang}-{self.lot}"
        self.envoyees.append(nom)
        code, ident = self.societe(nom)
        if code == 201:
            self.acceptees[nom] = ident
        return code == 201 or f"HTTP {code}"

    def rafraichir(self):
        d = self.c.gql(self.origine, "mutation($t:String!){renewToken(appToken:$t){tokens{refreshToken{token}}}}", {"t": self.rafraichir_a})
        self.rafraichir_a = d["renewToken"]["tokens"]["refreshToken"]["token"]
        return True

    def lire(self):
        code, d = self.gql(self.origine, self.session_a)
        return d is not None or f"HTTP {code}"

    def recharger(self, page):
        """Un rechargement ; échoue dès que l'écran affiche une erreur, ou reste sans contenu 45 s : l'utilisateur recharge alors."""
        t, ok, vu = time.time(), None, ""
        try:
            page.reload(wait_until="commit", timeout=45000)
        except Exception as e:  # noqa: BLE001
            ok = type(e).__name__
        while ok is None:
            try:
                vu = page.inner_text("body", timeout=2000)
            except Exception:  # noqa: BLE001
                vu = ""
            if "Companies" in vu and "All" in vu:
                ok = True
            elif any(m in vu for m in ERREURS) or time.time() - t > 45:
                ok = f"écran : {' '.join(vu.split())[:90]!r} après {time.time() - t:.1f} s"
            else:
                time.sleep(0.3)
        self.mesures["écran"].append((t, time.time(), ok))

    def bilan(self, nom, debut, fin):
        m = self.mesures[nom]
        ratees = [x for x in m if x[2] is not True]
        avant = sorted(b - a for a, b, ok in m if ok is True and b < debut)
        normal = avant[len(avant) // 2] if avant else 0
        succes = sorted(b for a, b, ok in m if ok is True)
        trou = max((y - x for x, y in zip(succes, succes[1:]) if y > debut and x < fin), default=0)
        lent = max((b - a for a, b, ok in m if ok is True and b > debut and a < fin), default=0)
        print(f"{nom:<14} {len(m)} essais, {len(ratees)} ratés {[(datetime.fromtimestamp(a, timezone.utc).strftime('%T'), ok) for a, _, ok in ratees][:4]}, "
              f"réponse normale {normal:.2f} s, la plus lente {lent:.2f} s, plus long trou entre deux succès {trou:.2f} s", flush=True)
        # Coupure = ce que le redémarrage ajoute à la normale de ce poste (un bastion chargé rend déjà l'écran en 20 s).
        return len(ratees), max(0.0, trou - max(0.5, normal))

    def jouer(self):
        a = self.a
        self.mesures, self.fini, self.rang, self.lot = {n: [] for n in ("écriture", "lecture", "session", "écran")}, False, 0, uuid.uuid4().hex[:6]
        self.envoyees, self.acceptees = [], {}
        self.installer_acces()
        fin = time.time() + 600
        while not self.attendre_recu(0, a.attente) and time.time() < fin:
            self.societe(f"Témoin {int(time.time())}")
        if not self.recus():
            raise ta.Echec("le CRM ne joint pas le récepteur en 10 min", 2)
        self.controle("avant : webhook signé reçu (témoin positif)", all(ok for _, ok in self.recus()))
        self.planifier()
        page = self.ouvrir_ecran()
        fin = time.time() + 240
        while not self.planifies() and time.time() < fin:
            time.sleep(5)
        if not self.planifies():
            raise ta.Echec("le workflow planifié n'a jamais tourné avant : mesure impossible", 2)
        self.controle("avant : le workflow planifié tourne (témoin positif)", True, str(self.planifies()[-1:]))
        hub, mail = self.membre()
        time.sleep(a.attente)
        partis = len(self.recus("workspaceMember.deleted"))
        self.suspendre(self.tenant)
        self.c.signe(f"/api/tenants/{self.tenant}/remove-member", {"hub_user_id": hub, "email": mail})
        time.sleep(5)
        self.reprendre(self.tenant)
        self.controle("tâche différée en file, pas encore faite", len(self.recus("workspaceMember.deleted")) == partis)
        pose = time.time()

        fils = [threading.Thread(target=self.boucle, args=x, daemon=True) for x in (
            ("écriture", self.ecrire, 1.0), ("lecture", self.lire, 0.2), ("session", self.rafraichir, 1.0))]
        for f in fils:
            f.start()
        for _ in range(4):
            self.recharger(page)
        debut = time.time()
        print(f"{datetime.now(timezone.utc).strftime('%T')} déclenchement", flush=True)
        ordre = subprocess.Popen(a.declencher, shell=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        while ordre.poll() is None or time.time() - debut < a.apres:
            self.recharger(page)
        fin = time.time()
        self.controle("ordre de redémarrage accepté", ordre.returncode == 0, f"rc={ordre.returncode}, {fin - debut:.0f} s observées")
        self.fini = True
        for f in fils:
            f.join(90)

        pires = []
        for nom in self.mesures:
            rates, coupure = self.bilan(nom, debut, fin)
            pires.append((coupure, nom, rates))
        pire = max(pires)
        self.controle(f"coupure de {a.borne} s ou moins", pire[0] <= a.borne, f"pire ajout : {pire[1]} {pire[0]:.2f} s ; ratés {sum(x[2] for x in pires)}")

        noms = {}
        curseur = None
        while True:
            _, texte = self.rest(self.origine, self.cle, chemin=f"/rest/companies?limit={PAGE}&filter=name%5Blike%5D:%25-{self.lot}" + (f"&starting_after={curseur}" if curseur else ""))
            d = json.loads(texte)
            for x in d["data"]["companies"]:
                noms.setdefault(x["name"], []).append(x["id"])
            if not d.get("pageInfo", {}).get("hasNextPage"):
                break
            curseur = d["pageInfo"]["endCursor"]
        perdues = [n for n, i in self.acceptees.items() if noms.get(n) != [i]]
        self.controle("chaque fiche acceptée existe, une seule fois", not perdues and len(self.acceptees) > 50, f"{len(self.acceptees)} acceptées, {len(self.envoyees)} envoyées, perdues {perdues[:5]}")

        def manquants():
            arrives = {i for e, i, v in Recepteur.fiches if e == "company.created" and v}
            return [n for n, i in self.acceptees.items() if i not in arrives]

        print(f"{Recepteur.vus} webhooks reçus à la fin des écritures, {len(manquants())} à venir", flush=True)
        fin = time.time() + 300
        while manquants() and time.time() < fin:
            time.sleep(3)
        self.controle("le webhook de chaque fiche acceptée est arrivé", not manquants(), f"{len(manquants())} manquant(s) {manquants()[:5]}")
        self.controle("la tâche différée posée avant est faite après", self.attendre_recu(partis, 420, "workspaceMember.deleted"), f"{time.time() - pose:.0f} s après sa pose")
        time.sleep(65)
        minutes = [datetime.fromisoformat(x.replace("Z", "+00:00")) for x in self.planifies()]
        trous = [(y - x).total_seconds() for x, y in zip(minutes, minutes[1:])]
        apres = [m for m in minutes if m.timestamp() > debut + 20]
        self.controle("le planifié n'a sauté aucune minute", len(apres) >= 3 and max(trous) < 90, f"{len(minutes)} passages, {len(apres)} après, plus long écart {max(trous, default=0):.0f} s")
        self.controle("la session d'avant sert encore", self.lire() is True and self.rafraichir() is True)
        st, _, _ = self.rebond(self.email, self.hub_a, self.origine)
        self.controle("rebond du Hub : 200", st == 200, f"HTTP {st}")
        self.c.signe("/api/hub/users/sync", {"hub_user_id": hub, "deleted": True})


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--env", default="staging", choices=("staging", "prod"))
    p.add_argument("--declencher", required=True)
    p.add_argument("--apres", type=int, default=150)
    p.add_argument("--borne", type=float, default=10)
    p.add_argument("--attente", type=int, default=20)
    p.add_argument("--sabotage", action="store_true")
    a = p.parse_args()
    a.temoin, a.sans_ecran = a.espace, False
    Recepteur.sabotage = a.sabotage
    serveur = ThreadingHTTPServer(("127.0.0.1", 0), Recepteur)
    threading.Thread(target=serveur.serve_forever, daemon=True).start()
    proc, e = None, None
    try:
        proc, url = ta._tunnel(serveur.server_address[1])
        for _ in range(45):
            try:
                with urllib.request.urlopen(url, timeout=10) as r:
                    if r.read() == b"recepteur-twenty-admin":
                        break
            except Exception:  # noqa: BLE001
                pass
            time.sleep(2)
        else:
            raise ta.Echec("le tunnel ne joint pas le récepteur en 90 s", 2)
        ta._attendre_dns(urlparse(url).hostname)
        ta._Recepteur.recus.clear()
        Recepteur.vus = 0
        e = Redemarrage(a, url)
        e.jouer()
    except ta.Echec as err:
        print(f"NON ABOUTI : {err}")
        return err.code
    finally:
        if e is not None:
            e.fini = True
            e.fermer_ecran()
            e.nettoyer()
        if proc:
            proc.terminate()
        serveur.shutdown()
    if e.echecs:
        print(f"FAUX : {len(e.echecs)} contrôle(s) en échec : {', '.join(e.echecs)}")
        return 1
    print("VRAI : redémarrage sans perte, coupure sous la borne")
    return 0


if __name__ == "__main__":
    sys.exit(main())
