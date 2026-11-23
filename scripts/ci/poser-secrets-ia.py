#!/usr/bin/env python3
"""poser-secrets-ia.py : les deux secrets du fournisseur « Veridian » (MON-IA.md), partagés entre le Hub et Twenty.

IA_FOURNISSEUR_CLE (Bearer de l'instance Twenty) et IA_IDENTITE_SECRET (HMAC de l'assertion X-Veridian-Ia-Identite).
La source est nomad/jobs/hub : les valeurs y sont générées si elles manquent, puis recopiées à l'identique dans
chaque Variable de Twenty donnée en argument. Rien n'est jamais affiché : seules des empreintes sha256 (8 caractères)
sortent, pour mesurer une divergence. Chaque écriture est conditionnée à l'index lu (-check-index).

Usage :
  poser-secrets-ia.py <variable Twenty> [<variable Twenty>…]   pose (Hub d'abord, puis chaque copie)
  poser-secrets-ia.py --comparer <variable Twenty> […]         compare seulement : COPIES_IDENTIQUES ou COPIES_DIVERGENTES
⚠ Écrire une Variable relance les tâches dont le gabarit rend ces clés (Hub : tâche principale ; CRM : serveur).
Sortie : 0 conforme · 1 écart · 2 non abouti
"""
import hashlib, json, secrets, subprocess, sys

HUB = "nomad/jobs/hub"
NOMS = ("IA_FOURNISSEUR_CLE", "IA_IDENTITE_SECRET")
ANCIENS = ("VERIDIAN_IA_IDENTITE_SECRET",)


def lire(chemin):
    r = subprocess.run(["nomad-v", "raw", "var", "get", "-out", "json", chemin], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"NON ABOUTI : lecture de {chemin} refusée (code {r.returncode})")
    return json.loads(r.stdout)


def ecrire(chemin, var, items):
    r = subprocess.run(["nomad-v", "raw", "var", "put", "-out", "none", "-check-index", str(var["ModifyIndex"]),
                        "-in", "json", chemin, "-"], input=json.dumps({"Items": items}), capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"ECHEC : écriture de {chemin} refusée (code {r.returncode}) {r.stderr.strip()[:200]}")


def empreinte(v):
    return hashlib.sha256(v.encode()).hexdigest()[:8] if v else "absent"


def main():
    args = sys.argv[1:]
    comparer = bool(args) and args[0] == "--comparer"
    cibles = args[1:] if comparer else args
    if not cibles:
        print(__doc__); return 2
    hub = lire(HUB)
    items_hub = hub.get("Items") or {}
    if not comparer and not all(items_hub.get(n) for n in NOMS):
        for n in NOMS:
            items_hub.setdefault(n, secrets.token_urlsafe(48))
        ecrire(HUB, hub, items_hub)
        hub = lire(HUB)
        items_hub = hub["Items"]
    ref = {n: empreinte(items_hub.get(n)) for n in NOMS}
    print(f"{HUB} : " + " ".join(f"{n}={ref[n]}" for n in NOMS))
    ecarts = 0
    for chemin in cibles:
        var = lire(chemin)
        items = var.get("Items") or {}
        if not comparer and (any(items.get(n) != items_hub[n] for n in NOMS) or any(a in items for a in ANCIENS)):
            for n in NOMS:
                items[n] = items_hub[n]
            for a in ANCIENS:
                items.pop(a, None)
            ecrire(chemin, var, items)
            items = lire(chemin)["Items"]
        e = {n: empreinte(items.get(n)) for n in NOMS}
        ecarts += e != ref
        print(f"{chemin} : " + " ".join(f"{n}={e[n]}" for n in NOMS))
    print("COPIES_IDENTIQUES" if ecarts == 0 else f"COPIES_DIVERGENTES ({ecarts})")
    return 0 if ecarts == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
