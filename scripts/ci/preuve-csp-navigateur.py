#!/usr/bin/env python3
"""Partie navigateur de preuve-csp.py (Chromium, node02). Lit le lien magique sur stdin, écrit un JSON sur stdout.

  preuve-csp-navigateur.py <origine de l'espace> <dossier des captures>
"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ORIGINE, DOSSIER = sys.argv[1].rstrip("/"), Path(sys.argv[2])
DOSSIER.mkdir(parents=True, exist_ok=True)
lien = sys.stdin.readline().strip()

ECOUTE = """
window.__violations = [];
document.addEventListener('securitypolicyviolation', (e) => window.__violations.push({
  page: location.pathname, cadre: window === window.top ? 'page' : 'iframe', directive: e.effectiveDirective,
  bloque: (e.blockedURI || '').split('?')[0].slice(0, 80), source: (e.sourceFile || '').split('?')[0].slice(-60),
  ligne: e.lineNumber, disposition: e.disposition }));
"""
sortie = {"entetes": [], "console": [], "pages": [], "panneau": False, "controle": {}, "violations": []}


def violations(page):
    tout = []
    for cadre in page.frames:
        try:
            tout += cadre.evaluate("window.__violations || []")
        except Exception:
            pass
    return tout


with sync_playwright() as p:
    nav = p.chromium.launch(headless=True)
    ctx = nav.new_context(viewport={"width": 1440, "height": 900}, locale="fr-FR")
    ctx.add_init_script(ECOUTE)
    page = ctx.new_page()

    def sur_reponse(r):
        if r.request.resource_type == "document" and r.url.startswith(ORIGINE):
            h = r.headers
            sortie["entetes"].append({"chemin": r.url[len(ORIGINE):].split("?")[0][:60], "veridian": h.get("x-veridian-csp"),
                                      "report_only": "content-security-policy-report-only" in h,
                                      "politique": h.get("content-security-policy-report-only") or h.get("content-security-policy")})

    page.on("response", sur_reponse)
    page.on("console", lambda m: "Content Security Policy" in m.text and sortie["console"].append(m.text[:300]))

    page.goto(lien, wait_until="domcontentloaded")
    page.wait_for_url(lambda u: "/welcome" not in u and "hub" not in u.split("/")[2], timeout=60000)
    page.wait_for_timeout(6000)
    page.screenshot(path=str(DOSSIER / "1-accueil.png"))
    sortie["pages"].append(page.url.split("?")[0].replace(ORIGINE, ""))

    recolte = []
    recolte += violations(page)
    page.goto(f"{ORIGINE}/objects/companies", wait_until="domcontentloaded")
    page.wait_for_timeout(6000)
    sortie["pages"].append("/objects/companies")
    bouton = page.get_by_text("Prospection", exact=True).first
    try:
        bouton.click(timeout=15000)
        page.get_by_placeholder("SIREN, nom ou site").wait_for(timeout=30000)
        sortie["panneau"] = True
    except Exception as e:
        sortie["panneau_erreur"] = str(e)[:200]
    page.wait_for_timeout(3000)
    page.screenshot(path=str(DOSSIER / "2-panneau-liaisons.png"))

    for chemin in ("/objects/people", "/objects/tasks", "/settings/profile"):
        recolte += violations(page)
        page.goto(f"{ORIGINE}{chemin}", wait_until="domcontentloaded")
        page.wait_for_timeout(5000)
        sortie["pages"].append(chemin)
    page.screenshot(path=str(DOSSIER / "3-reglages.png"))

    principal = "window.__violations || []"
    avant = len(page.evaluate(principal))
    page.evaluate("""document.body.insertAdjacentHTML('beforeend', '<img src="x:" onerror="window.__controle = 1">')""")
    page.wait_for_timeout(3000)
    neuves = page.evaluate(principal)[avant:]
    controles = [v for v in neuves if v["directive"] == "script-src-attr"]
    sortie["controle"] = {"execute": page.evaluate("window.__controle === 1"), "signale": bool(controles), "instant": time.time()}
    reste = violations(page)
    if controles:
        reste.remove(controles[0])
    sortie["violations"] = recolte + reste
    nav.close()

print(json.dumps(sortie, ensure_ascii=False))
