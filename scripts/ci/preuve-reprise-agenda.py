#!/usr/bin/env python3
"""Preuve qu'un agenda reprend seul après une suspension (CONTRAT-HUB §5.4), sur un espace jetable : serveur CalDAV de test
local (radicale) exposé par un tunnel éphémère, branché au CRM par la route native. Un événement posé pendant la suspension
n'entre qu'après la reprise, sans reconnexion.

  preuve-reprise-agenda.py <espace jetable> --radicale <python d'un venv avec radicale> [--env staging]

Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import argparse
import base64
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path.home() / ".claude/skills/twenty-cli/bin"))
import twenty_admin as ta  # noqa: E402

COMPTE = "epreuve"


class Epreuve:
    def __init__(self, a, url, passe):
        self.a, self.url, self.passe, self.echecs = a, url, passe, []
        self.c = ta.Client(a.env)
        acces, p = ta.lire_creds(), ta.prefixe(a.env, a.espace)
        self.tenant = acces.get(f"{p}_JETABLE_TENANT_ID")
        if not self.tenant:
            raise ta.Echec(f"{a.espace} n'est pas un espace jetable", 2)
        self.origine, self.session, _ = self.c.session(acces[f"{p}_EMAIL"], a.espace)

    def controle(self, nom, ok, detail=""):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:230], flush=True)
        if not ok:
            self.echecs.append(nom)

    def dav(self, methode, chemin, corps=b"", entetes=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.a.port}{chemin}", data=corps, method=methode, headers={
            "Authorization": "Basic " + base64.b64encode(f"{COMPTE}:{self.passe}".encode()).decode(), **(entetes or {})})
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status

    def poser(self, titre):
        debut = datetime.now(timezone.utc) + timedelta(days=1)
        uid = secrets.token_hex(8)
        ics = "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//epreuve//FR", "BEGIN:VEVENT", f"UID:{uid}",
                           f"DTSTAMP:{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}", f"DTSTART:{debut:%Y%m%dT%H%M%SZ}",
                           f"DTEND:{debut + timedelta(hours=1):%Y%m%dT%H%M%SZ}", f"SUMMARY:{titre}",
                           f"ORGANIZER:mailto:{COMPTE}@epreuve.example", "ATTENDEE;PARTSTAT=ACCEPTED:mailto:invite@epreuve.example",
                           "END:VEVENT", "END:VCALENDAR", ""])
        return self.dav("PUT", f"/{COMPTE}/agenda/{uid}.ics", ics.encode(), {"Content-Type": "text/calendar"})

    def vu(self, titre):
        try:
            d = self.c.gql(self.origine, "query($f:CalendarEventFilterInput){calendarEvents(filter:$f){totalCount}}",
                           {"f": {"title": {"eq": titre}}}, self.session, "/graphql")
            return d["calendarEvents"]["totalCount"]
        except ta.Echec:
            return None

    def attendre(self, titre, secondes):
        t = time.time()
        while time.time() - t < secondes:
            if self.vu(titre):
                return time.time() - t
            time.sleep(10)
        return None

    def jouer(self):
        self.dav("MKCALENDAR", f"/{COMPTE}/agenda/")
        avant, pendant = f"Avant {secrets.token_hex(3)}", f"Pendant {secrets.token_hex(3)}"
        self.poser(avant)
        r = self.c.gql(self.origine, "mutation($h:String!,$p:EmailAccountConnectionParameters!){saveImapSmtpCaldavAccount(handle:$h,"
                       "connectionParameters:$p){success connectedAccountId}}",
                       {"h": f"{COMPTE}@epreuve.example", "p": {"name": "Épreuve", "CALDAV": {
                           "host": self.url, "port": 443, "username": COMPTE, "password": self.passe,
                           "connectionSecurity": "SSL_TLS"}}}, self.session)["saveImapSmtpCaldavAccount"]
        self.controle("agenda de test branché", r["success"] is True, r["connectedAccountId"])
        self.c.gql(self.origine, "mutation($i:UUID!){startChannelSync(connectedAccountId:$i){success}}",
                   {"i": r["connectedAccountId"]}, self.session)
        t = self.attendre(avant, 900)
        if t is None:
            raise ta.Echec("l'agenda ne synchronise pas avant toute suspension : mesure impossible", 2)
        self.controle("avant : l'événement entre (témoin positif)", True, f"{t:.0f} s")
        st, _, _ = self.c.signe("/api/tenants/suspend", {"tenant_id": self.tenant, "reason": "admin_action"})
        self.controle("suspendu", st == 200, f"HTTP {st}")
        try:
            self.poser(pendant)
            time.sleep(self.a.suspendu)
        finally:
            st, _, _ = self.c.signe("/api/tenants/resume", {"tenant_id": self.tenant})
        self.controle("repris", st == 200, f"HTTP {st}")
        time.sleep(2)
        entres = self.vu(pendant)
        self.controle("rien n'est entré pendant la suspension", entres == 0, f"{entres} événement, {self.a.suspendu} s de suspension")
        self.controle("l'événement d'avant est toujours là", self.vu(avant) == 1, str(self.vu(avant)))
        t = self.attendre(pendant, 900)
        self.controle("après : l'événement posé pendant la suspension entre seul, sans reconnexion", t is not None,
                      f"{t and round(t)} s après la reprise")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("espace")
    p.add_argument("--radicale", required=True)
    p.add_argument("--env", default="staging", choices=("staging", "prod"))
    p.add_argument("--suspendu", type=int, default=400, help="durée de suspension, plus longue que la cadence du cron (5 min)")
    a = p.parse_args()
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        a.port = s.getsockname()[1]
    passe, dossier = secrets.token_hex(12), tempfile.TemporaryDirectory()
    Path(dossier.name, "users").write_text(f"{COMPTE}:{passe}\n")
    Path(dossier.name, "conf").write_text(
        f"[server]\nhosts = 127.0.0.1:{a.port}\n[auth]\ntype = htpasswd\nhtpasswd_filename = {dossier.name}/users\n"
        f"htpasswd_encryption = plain\n[storage]\nfilesystem_folder = {dossier.name}/data\n[rights]\ntype = owner_only\n")
    serveur = subprocess.Popen([a.radicale, "-m", "radicale", "--config", f"{dossier.name}/conf"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    proc = None
    try:
        proc, url = ta._tunnel(a.port)
        ta._attendre_dns(urlparse(url).hostname)
        for _ in range(45):
            try:
                urllib.request.urlopen(url + "/.web/", timeout=10)
                break
            except urllib.error.HTTPError as e:
                if e.code < 500:
                    break
            except Exception:  # noqa: BLE001
                pass
            time.sleep(2)
        else:
            raise ta.Echec("le tunnel ne joint pas le serveur CalDAV", 2)
        e = Epreuve(a, url, passe)
        e.jouer()
    except ta.Echec as err:
        print(f"NON ABOUTI : {err}")
        return err.code
    finally:
        serveur.terminate()
        if proc:
            proc.terminate()
        dossier.cleanup()
    print("VERDICT :", "conforme" if not e.echecs else f"ÉCHEC {e.echecs}")
    return 0 if not e.echecs else 1


if __name__ == "__main__":
    sys.exit(main())
