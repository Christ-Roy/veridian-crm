# Client minimal de l'API Twenty (veridian-4). Clé lue dans ~/credentials/.all-creds.env, jamais affichée.
import json, os, sys, time, urllib.request, urllib.error

P = 'TWENTY_PROD_VERIDIAN_4_'
_v = {}
for l in open(os.path.expanduser('~/credentials/.all-creds.env')):
    l = l.strip()
    if l.startswith('export '):
        l = l[7:]
    k, _, x = l.partition('=')
    if k in (P + 'API_URL', P + 'API_KEY'):
        _v[k] = x.strip().strip('"').strip("'")
URL = _v[P + 'API_URL'].rstrip('/')
KEY = _v[P + 'API_KEY']


def _post(path, body):
    for essai in range(6):
        req = urllib.request.Request(URL + path, data=json.dumps(body).encode(), method='POST',
                                     headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(15)
                continue
            raise RuntimeError(f'HTTP {e.code}: {e.read()[:500]}')
    raise RuntimeError('429 persistant')


def gql(q, variables=None, metadata=False):
    r = _post('/metadata' if metadata else '/graphql', {'query': q, 'variables': variables or {}})
    if r.get('errors'):
        raise RuntimeError(json.dumps(r['errors'])[:1500])
    return r['data']


def tout(objet, champs, filtre=None):
    lignes, apres = [], None
    while True:
        args = 'first: 100' + (f', after: "{apres}"' if apres else '') + (f', filter: {filtre}' if filtre else '')
        d = gql(f'{{ {objet}({args}) {{ edges {{ node {{ {champs} }} }} pageInfo {{ hasNextPage endCursor }} }} }}')[objet]
        lignes += [e['node'] for e in d['edges']]
        if not d['pageInfo']['hasNextPage']:
            return lignes
        apres = d['pageInfo']['endCursor']


def champs_objet(nom):
    d = gql('{ objects(filter: {}, paging: {first: 200}) { edges { node { id nameSingular universalIdentifier '
            'fields(filter: {}, paging: {first: 200}) { edges { node { id name type universalIdentifier isCustom options } } } } } } }',
            metadata=True)
    for e in d['objects']['edges']:
        if e['node']['nameSingular'] == nom:
            return e['node']
