#!/usr/bin/env python3
"""Capture d'un onglet d'une fiche du CRM (Chromium, node02). Lit le lien magique sur stdin ; écrit « VU » si l'onglet s'ouvre.

  capture-onglet.py <origine> <chemin de la fiche> <libellé de l'onglet> <dossier> [texte attendu dans l'onglet]
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ORIGINE, CHEMIN, ONGLET, DOSSIER = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3], Path(sys.argv[4])
PREUVE = sys.argv[5] if len(sys.argv) > 5 else ""
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
        # La barre d'onglets est en haut : le même libellé existe plus bas (champ de la fiche).
        boites = [b for t in page.get_by_text(ONGLET, exact=True).all() if t.is_visible()
                  for b in [t.bounding_box()] if b and b["y"] < 110 and 0 < b["x"] < 1440 - b["width"]]
        if not boites:
            raise RuntimeError("onglet absent de la barre")
        page.mouse.click(boites[0]["x"] + boites[0]["width"] / 2, boites[0]["y"] + boites[0]["height"] / 2)
        page.wait_for_timeout(5000)
        if PREUVE and not page.get_by_text(PREUVE).first.is_visible():
            raise RuntimeError(f"onglet ouvert sans « {PREUVE} » visible")
        page.screenshot(path=str(DOSSIER / "onglet.png"))
        print("VU")
    except Exception as e:
        page.screenshot(path=str(DOSSIER / "onglet-echec.png"))
        print(f"NON VU {str(e)[:150]}")
    nav.close()
