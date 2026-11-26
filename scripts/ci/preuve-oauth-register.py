#!/usr/bin/env python3
"""preuve-oauth-register.py : la politique des redirect_uri de POST /oauth/register (R1), sur un environnement servi.

Écrit UN client OAuth (témoin, boucle locale) : staging seulement, jamais prod (refusé, code 2).
Aucune route ne supprime un client enregistré : il reste en base et le nettoyage périmé natif
(StaleRegistrationCleanupService) le retire s'il n'est jamais utilisé.

Vérifie :
  1. la découverte répond 200 et publie toujours registration_endpoint ;
  2. témoin : une inscription en boucle locale est acceptée (201, client_id rendu) ;
  3. une adresse inventée est refusée (400 invalid_redirect_uri, aucun client_id) ; un sous-domaine piégé aussi ;
  4. le client témoin se relit (GET register/<id> 200) : l'OAuth natif tourne ;
  5. /oauth/token répond en OAuth (400 ou 401 avec un champ error, jamais 404 ni 5xx) ;
  6. la porte MCP répond comme avant : POST /mcp sans jeton, 401 avec WWW-Authenticate.

Usage : preuve-oauth-register.py staging [--url https://crm.staging.veridian.site]
Sortie : 0 conforme · 1 contraire · 2 mesure non aboutie (réseau, témoin non inscrit, prod demandée)
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

URLS = {"staging": "https://crm.staging.veridian.site"}


def appel(methode, url, corps=None, form=False):
    donnees = None
    entetes = {"Accept": "application/json"}
    if corps is not None:
        if form:
            donnees = "&".join(f"{k}={v}" for k, v in corps.items()).encode()
            entetes["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            donnees = json.dumps(corps).encode()
            entetes["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=donnees, method=methode, headers=entetes)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), dict(e.headers)


def json_ou_none(texte):
    try:
        return json.loads(texte)
    except ValueError:
        return None


def main():
    p = argparse.ArgumentParser()
    p.add_argument("env", choices=["staging", "prod"])
    p.add_argument("--url")
    a = p.parse_args()
    if a.env == "prod":
        print("NON ABOUTI : cette preuve écrit un client, staging seulement")
        return 2
    base = (a.url or URLS[a.env]).rstrip("/")
    faux = 0

    def verdict(nom, ok, detail=""):
        nonlocal faux
        print(f"{'VRAI ' if ok else 'FAUX '} {nom}{' : ' + detail if detail else ''}")
        if not ok:
            faux = 1

    try:
        code, texte, _ = appel("GET", base + "/.well-known/oauth-authorization-server")
        d = json_ou_none(texte)
        if code != 200 or not isinstance(d, dict):
            print(f"NON ABOUTI : découverte HTTP {code}")
            return 2
        verdict("découverte 200 avec registration_endpoint", bool(d.get("registration_endpoint")))

        code, texte, _ = appel("POST", base + "/oauth/register", {
            "client_name": "preuve-oauth-register (temoin, supprimable)",
            "redirect_uris": ["http://127.0.0.1:43219/retour"],
            "grant_types": ["authorization_code"], "response_types": ["code"],
            "token_endpoint_auth_method": "none", "scope": "api profile"})
        d = json_ou_none(texte) or {}
        client_id = d.get("client_id")
        if code != 201 or not client_id:
            print(f"NON ABOUTI : le témoin en boucle locale n'est pas inscrit (HTTP {code})")
            return 2
        verdict("témoin : boucle locale inscrite (201)", True)

        for nom, uri in (("adresse inventée", "https://app.exemple.com/callback"),
                         ("sous-domaine piégé", "https://claude.ai.exemple.com/api/mcp/auth_callback")):
            code, texte, _ = appel("POST", base + "/oauth/register", {
                "client_name": "preuve-oauth-register (refus attendu)", "redirect_uris": [uri],
                "grant_types": ["authorization_code"], "response_types": ["code"],
                "token_endpoint_auth_method": "none"})
            d = json_ou_none(texte) or {}
            verdict(f"{nom} refusée (400 invalid_redirect_uri, aucun client_id)",
                    code == 400 and d.get("error") == "invalid_redirect_uri" and "client_id" not in d,
                    f"HTTP {code}")

        code, _, _ = appel("GET", f"{base}/oauth/register/{client_id}")
        verdict("OAuth natif : le témoin se relit (200)", code == 200, f"HTTP {code}")

        code, texte, _ = appel("POST", base + "/oauth/token", {
            "grant_type": "authorization_code", "code": "inexistant", "client_id": client_id,
            "redirect_uri": "http://127.0.0.1:43219/retour", "code_verifier": "x" * 43}, form=True)
        verdict("/oauth/token répond en OAuth (400 ou 401 avec error)",
                code in (400, 401) and "error" in (json_ou_none(texte) or {}), f"HTTP {code}")

        code, _, entetes = appel("POST", base + "/mcp", {})
        verdict("porte MCP comme avant (401 avec WWW-Authenticate)",
                code == 401 and any(k.lower() == "www-authenticate" for k in entetes), f"HTTP {code}")
    except (urllib.error.URLError, OSError) as e:
        print(f"NON ABOUTI : {e}")
        return 2

    print(f"client témoin laissé en base (aucune route de suppression) : {client_id}")
    return faux


if __name__ == "__main__":
    sys.exit(main())
