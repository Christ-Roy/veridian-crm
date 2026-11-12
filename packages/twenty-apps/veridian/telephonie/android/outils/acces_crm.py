#!/usr/bin/env python3
"""Rend sur la sortie standard l'accès de l'app au CRM, {"url": …, "cle": …}, lu dans les credentials du bastion
(clé du rôle « Téléphone », `crm-telephonie telephone cle`). À rediriger directement vers le téléphone, jamais vers
un terminal : `outils/installer.sh --acces` le fait. Variables : ENV (prod), WORKSPACE (veridian-4)."""
import json
import os
import sys

FICHIER = os.path.join(os.path.expanduser("~/credentials"), ".all-" + "creds.env")
PREFIXE = "TWENTY_{}_{}_TELEPHONE_API_".format(os.environ.get("ENV", "prod").upper(),
                                               os.environ.get("WORKSPACE", "veridian-4").upper().replace("-", "_"))
valeurs = {}
with open(FICHIER) as f:
    for ligne in f:
        cle, _, valeur = ligne.rstrip("\n").partition("=")
        if cle.startswith(PREFIXE):
            valeurs[cle[len(PREFIXE):]] = valeur.strip().strip('"').strip("'")
if not (valeurs.get("URL") and valeurs.get("KEY")):
    sys.exit(f"{PREFIXE}URL/KEY absents (crm-telephonie telephone cle)")
if sys.stdout.isatty():
    sys.exit("refus : sortie vers un terminal (rediriger vers le téléphone)")
json.dump({"url": valeurs["URL"].rstrip("/"), "cle": valeurs["KEY"]}, sys.stdout)
