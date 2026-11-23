#!/usr/bin/env python3
"""preuve-identite-ia.py : un vrai appel au modèle du CRM porte-t-il l'identité signée attendue ? (VER-203)

Appelle POST /rest/ai/generate-text (modèle veridian/auto) deux fois : avec la clé d'API rangée de l'espace, puis
avec la session d'un membre ouverte par le rebond du Hub (jeton jamais affiché). Le fournisseur « veridian » du
staging est scripts/ci/fournisseur-ia-epreuve.js, qui répond par son verdict : on lit ce verdict.

Usage : preuve-identite-ia.py [--env staging|prod] <sous-domaine> <workspace_id attendu>
Sortie : 0 identité conforme sur les deux appels · 1 refus ou écart · 2 non abouti
"""
import argparse, json, sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude" / "skills" / "twenty-cli" / "bin"))
import twenty_admin as ta  # noqa: E402


def generer(c, url, jeton):
    code, texte, _ = c.http(f"{url}/rest/ai/generate-text",
                            json.dumps({"userPrompt": "Épreuve VER-203", "modelId": "veridian/auto"}).encode(),
                            {"Authorization": f"Bearer {jeton}", "Content-Type": "application/json"})
    try:
        d = json.loads(texte)
    except ValueError:
        return code, texte[:200]
    return code, d.get("text") or d.get("message") or json.dumps(d)[:300]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--env", default="staging", choices=["staging", "prod"])
    p.add_argument("workspace")
    p.add_argument("workspace_id")
    a = p.parse_args()
    c = ta.Client(a.env)
    try:
        url, cle = ta._cle(a.env, a.workspace)
    except ta.Echec as e:
        print(f"NON ABOUTI : {e}"); return 2
    email = ta.lire_creds().get(f"{ta.prefixe(a.env, a.workspace)}_EMAIL")
    resultats = []
    code, texte = generer(c, url, cle)
    # Twenty réserve cette route à un membre : une clé d'API est refusée par le natif, avant tout appel au modèle.
    print(f"clé d'API      HTTP {code}  {texte}  (refus natif attendu : la route exige un membre)")
    resultats.append(code == 403)
    if not email:
        print("NON ABOUTI : email du membre absent des identifiants rangés"); return 2
    try:
        _origine, jeton, _ws = c.session(email, a.workspace)
    except ta.Echec as e:
        print(f"NON ABOUTI : session du membre : {e}"); return 2
    code, texte = generer(c, url, jeton)
    print(f"session membre HTTP {code}  {texte}")
    resultats.append(code in (200, 201) and f"IDENTITE OK workspace_id={a.workspace_id}" in texte
                     and "hub_user_id=None" not in texte and "FUITE" not in texte)
    return 0 if all(resultats) else 1


if __name__ == "__main__":
    sys.exit(main())
