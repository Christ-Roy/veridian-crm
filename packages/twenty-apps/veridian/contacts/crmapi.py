"""Client minimal Twenty (REST + GraphQL), stdlib seule. Clé lue dans l'environnement, jamais affichée."""
import json, os, time, urllib.request, urllib.error

PREFIX = "TWENTY_PROD_VERIDIAN_4_"

JETON = None   # session d'un membre (liste de blocage : refusée à une clé API)


def _env():
    url = os.environ[PREFIX + "API_URL"].rstrip("/")
    key = JETON or os.environ[PREFIX + "API_KEY"]
    return url, key


def ouvrir_session_membre(sous_domaine="veridian-4"):
    """jeton d'accès du membre rangé dans les creds, par le rebond signé du Hub (même chemin que `twenty-admin agent:revoke`)."""
    import importlib.util
    chemin = os.path.expanduser("~/.claude/skills/twenty-cli/bin/twenty_admin.py")
    spec = importlib.util.spec_from_file_location("twenty_admin", chemin)
    ta = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ta)
    creds = ta.lire_creds()
    email = creds[PREFIX + "EMAIL"]
    _, jeton, _ = ta.Client("prod").session(email, sous_domaine)
    return jeton

def _req(method, path, body=None, retries=8):
    url, key = _env()
    data = json.dumps(body).encode() if body is not None else None
    for i in range(retries):
        r = urllib.request.Request(url + path, data=data, method=method,
            headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(r, timeout=120) as f:
                return json.loads(f.read() or b"null")
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(min(65, 5 * (i + 1))); continue
            raise RuntimeError("HTTP %s %s : %s" % (e.code, path[:60], e.read()[:400]))
        except urllib.error.URLError:
            time.sleep(5 * (i + 1))
    raise RuntimeError("echec apres retries " + path[:60])

def rest(method, path, body=None):
    return _req(method, "/rest" + path if not path.startswith("/rest") else path, body)

def gql(query, variables=None):
    # le endpoint GraphQL cœur est /graphql à la racine de l'API
    url, _ = _env()
    for essai in range(8):
        r = _req("POST", "/graphql", {"query": query, "variables": variables or {}})
        if r.get("errors"):
            if "RATE_LIMITED" in json.dumps(r["errors"]):      # la limite GraphQL répond 200 avec une erreur
                time.sleep(20 + 10 * essai)
                continue
            raise RuntimeError("GraphQL: " + json.dumps(r["errors"])[:600])
        return r["data"]
    raise RuntimeError("GraphQL: limite de débit persistante")

def all_pages(objet, filtre=None, limit=60, extra=""):
    out, cur = [], None
    while True:
        q = "/%s?limit=%d%s" % (objet, limit, extra)
        if filtre: q += "&filter=" + urllib.parse.quote(filtre)
        if cur: q += "&starting_after=" + cur
        d = rest("GET", q)
        key = [k for k in d["data"]][0]
        out += d["data"][key]
        pi = d["pageInfo"]
        if not pi.get("hasNextPage"): return out
        cur = pi["endCursor"]
import urllib.parse
