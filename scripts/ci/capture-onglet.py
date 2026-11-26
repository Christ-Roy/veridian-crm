#!/usr/bin/env python3
"""Capture d'un onglet d'une fiche du CRM (Chromium, node02). Lit le lien magique sur stdin ; écrit « VU » si l'onglet s'ouvre.

  capture-onglet.py <origine> <chemin de la fiche> <libellé de l'onglet> <dossier>
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ORIGINE, CHEMIN, ONGLET, DOSSIER = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3], Path(sys.argv[4])
DOSSIER.mkdir(parents=True, exist_ok=True)
lien = sys.stdin.readline().strip()

with sync_playwright() as p:
    nav = p.chromium.launch(headless=True)
    page = nav.new_context(viewport={"width": 1440, "height": 900}, locale="fr-FR").new_page()
    page.goto(lien, wait_until="domcontentloaded")
    page.wait_for_url(lambda u: "/welcome" not in u, timeout=60000)
    page.wait_for_timeout(5000)
    page.goto(f"{ORIGINE}{CHEMIN}", wait_until="domcontentloaded")
    page.wait_for_timeout(6000)
    try:
        page.get_by_text(ONGLET, exact=True).first.click(timeout=15000)
        page.wait_for_timeout(4000)
        page.screenshot(path=str(DOSSIER / "onglet.png"))
        print("VU")
    except Exception as e:
        page.screenshot(path=str(DOSSIER / "onglet-echec.png"))
        print(f"NON VU {str(e)[:150]}")
    nav.close()
