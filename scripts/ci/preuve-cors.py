#!/usr/bin/env python3
"""Preuve que le CRM ne répond plus « * » à une origine étrangère (VERIDIAN_CORS_STRICT), sans rien casser de légitime.

  preuve-cors.py [--env staging|prod]

Pré-vol (OPTIONS) depuis une origine étrangère sur /, /graphql, /metadata, /rest/companies et /mcp : aucun
Access-Control-Allow-Origin attendu. Témoins : l'origine du CRM est reflétée avec ses cookies, et une requête du
front d'un espace vers son propre hôte (même origine) répond. Lecture seule. Codes : 0 vrai, 1 faux, 2 non abouti.
"""
import argparse
import sys
import urllib.error
import urllib.request

BASES = {"prod": "https://crm.app.veridian.site", "staging": "https://crm.staging.veridian.site"}
CHEMINS = ("/", "/graphql", "/metadata", "/rest/companies", "/mcp")


class SansRedirection(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def entetes(url, origine, methode="OPTIONS"):
    req = urllib.request.Request(url, method=methode, headers={
        "Origin": origine, "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type"})
    try:
        r = urllib.request.build_opener(SansRedirection).open(req, timeout=20)
        return r.status, {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}
    except (urllib.error.URLError, TimeoutError) as e:
        raise SystemExit(f"NON ABOUTI {url} injoignable : {e}") from e


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--env", default="staging", choices=tuple(BASES))
    base = BASES[p.parse_args().env]
    echecs = []

    def controle(nom, ok, detail=""):
        print(("OK    " if ok else "ECHEC ") + nom + (f" : {detail}" if detail else ""), flush=True)
        if not ok:
            echecs.append(nom)

    for chemin in CHEMINS:
        code, h = entetes(base + chemin, "https://evil.example")
        controle(f"origine étrangère sans en-tête CORS sur {chemin}", "access-control-allow-origin" not in h,
                 f"HTTP {code} ACAO={h.get('access-control-allow-origin')}")
    code, h = entetes(base + "/graphql", base)
    controle("témoin : l'origine du CRM est reflétée avec ses cookies",
             h.get("access-control-allow-origin") == base and h.get("access-control-allow-credentials") == "true",
             f"HTTP {code} ACAO={h.get('access-control-allow-origin')}")
    code, _ = entetes(base + "/healthz", base, "GET")
    controle("témoin : le service répond", code == 200, f"HTTP {code}")
    print("VRAI : aucune origine étrangère ne reçoit d'en-tête CORS" if not echecs else f"FAUX : {', '.join(echecs)}")
    return 0 if not echecs else 1


if __name__ == "__main__":
    sys.exit(main())
