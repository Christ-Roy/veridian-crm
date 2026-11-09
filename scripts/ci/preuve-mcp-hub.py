#!/usr/bin/env python3
"""Preuve du branchement MCP du Hub sur Twenty (CONTRAT-MCP), depuis le bastion.

Signe des JWT comme la porte du Hub (clé MCP_SIGNING_JWK lue dans Nomad, jamais affichée), puis :
  1. compte connu : initialize, tools/list, puis un outil en lecture : 200 ;
  2. compte inconnu : 401 hub_user_unknown, sans création ;
  3. audience d'une autre app : 401 invalid_hub_token ;
  4. jeton signé par une autre clé sous le même kid : 401 ;
  5. tenant_id inconnu : 403 tenant_not_linked, jamais un repli sur un autre espace ;
  6. search_help_center absent de tools/list tant que la recherche en ligne est coupée.

Usage : preuve-mcp-hub.py <url_mcp> <hub_user_id connu> [chemin Nomad de la clé]
Codes : 0 vrai, 1 faux, 2 mesure non aboutie.
"""
import base64
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

import jwt
from cryptography.hazmat.primitives.asymmetric import ec

ISSUER = "https://app.veridian.site"


def cle_du_hub(chemin):
    brut = subprocess.run(
        ["nomad-v", "raw", "var", "get", "-item", "MCP_SIGNING_JWK", chemin],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    texte = brut if brut.startswith("{") else base64.b64decode(brut).decode()
    jwk = json.loads(texte)
    return jwt.algorithms.ECAlgorithm.from_jwk(json.dumps(jwk)), jwk["kid"]


def jeton(cle, kid, aud, sub):
    maintenant = int(time.time())
    return jwt.encode(
        {"iss": ISSUER, "aud": aud, "sub": sub, "email": "preuve@veridian.site", "email_verified": True,
         "scope": "veridian", "client_id": "preuve-twenty", "iat": maintenant, "exp": maintenant + 300,
         "jti": str(uuid.uuid4())},
        cle, algorithm="ES256", headers={"kid": kid, "typ": "JWT"},
    )


def appel(url, token, methode, params=None, ident=1):
    corps = json.dumps({"jsonrpc": "2.0", "id": ident, "method": methode, "params": params or {}}).encode()
    req = urllib.request.Request(url, data=corps, method="POST", headers={
        "Content-Type": "application/json", "Accept": "application/json",
        "Authorization": f"Bearer {token}", "MCP-Protocol-Version": "2025-06-18"})
    try:
        with urllib.request.urlopen(req, timeout=60) as rep:
            return rep.status, json.loads(rep.read() or b"{}")
    except urllib.error.HTTPError as err:
        texte = err.read()
        try:
            return err.code, json.loads(texte)
        except ValueError:
            return err.code, {"brut": texte[:200].decode(errors="replace")}


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    url, connu = sys.argv[1], sys.argv[2]
    chemin = sys.argv[3] if len(sys.argv) > 3 else "nomad/jobs/hub"
    try:
        cle, kid = cle_du_hub(chemin)
    except Exception as err:  # noqa: BLE001
        print(f"NON ABOUTI clé du Hub illisible : {type(err).__name__}")
        return 2

    echecs = []

    def controle(nom, ok, detail=""):
        print(f"{'OK   ' if ok else 'ECHEC'} {nom} : {detail}"[:300])
        if not ok:
            echecs.append(nom)

    token = jeton(cle, kid, url, connu)
    code, rep = appel(url, token, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                                 "clientInfo": {"name": "preuve-twenty", "version": "1"}})
    controle("compte connu : initialize", code == 200 and "result" in rep, f"{code} {str(rep)[:120]}")
    code, rep = appel(url, token, "tools/list", ident=2)
    outils = [o["name"] for o in rep.get("result", {}).get("tools", [])]
    controle("compte connu : tools/list", code == 200 and len(outils) > 0, f"{code} {len(outils)} outils {outils[:6]}")
    controle("aide en ligne coupée : search_help_center absent", "search_help_center" not in outils, str(len(outils)))
    lecture = next((o for o in outils if o.startswith("find_") and "people" in o or o in ("find_people", "find_many_people")), None)
    if lecture is None:
        lecture = next((o for o in outils if o.startswith("find")), None)
    if lecture:
        code, rep = appel(url, token, "tools/call", {"name": lecture, "arguments": {"limit": 1, "select": ["id"]}}, ident=3)
        erreur = rep.get("result", {}).get("isError") or "error" in rep
        controle(f"compte connu : tools/call {lecture}", code == 200 and not erreur, f"{code} {str(rep)[:160]}")
    else:
        controle("compte connu : un outil de lecture existe", False, str(outils[:20]))

    jeton_tenant = jwt.encode(
        {**jwt.decode(token, options={"verify_signature": False}), "tenant_id": str(uuid.uuid4()),
         "jti": str(uuid.uuid4())},
        cle, algorithm="ES256", headers={"kid": kid, "typ": "JWT"})
    code, rep = appel(url, jeton_tenant, "initialize")
    controle("tenant_id inconnu : 403 tenant_not_linked, jamais un autre espace", code == 403 and "tenant_not_linked" in json.dumps(rep), f"{code} {str(rep)[:120]}")

    code, rep = appel(url, jeton(cle, kid, url, str(uuid.uuid4())), "initialize")
    controle("compte inconnu : 401 hub_user_unknown", code == 401 and "hub_user_unknown" in json.dumps(rep), f"{code} {str(rep)[:160]}")

    autre = url.replace("crm.", "analytics.")
    code, rep = appel(url, jeton(cle, kid, autre, connu), "initialize")
    controle("audience d'une autre app : 401", code == 401 and "invalid_hub_token" in json.dumps(rep), f"{code} {str(rep)[:120]}")

    fausse = ec.generate_private_key(ec.SECP256R1())
    code, rep = appel(url, jeton(fausse, kid, url, connu), "initialize")
    controle("clé étrangère sous le kid du Hub : 401", code == 401, f"{code} {str(rep)[:120]}")

    print("VERDICT :", "preuve réussie" if not echecs else f"ÉCHEC {echecs}")
    return 0 if not echecs else 1


if __name__ == "__main__":
    sys.exit(main())
