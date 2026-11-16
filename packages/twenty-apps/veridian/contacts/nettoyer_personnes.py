#!/usr/bin/env python3
"""Nettoyage des fiches PERSONNES du CRM Twenty (workspace veridian-4) : parasites, doublons, noms, sociétés.

Rejouable et idempotent. Simulation par défaut : le plan est recalculé depuis l'état réel du CRM et écrit dans
le dossier de travail ; `--appliquer` écrit (liste de blocage, suppression douce des parasites, fusions natives
`mergePeople`, compléments de noms et de sociétés), précédé d'un export complet.

Aucune donnée nominative dans ce fichier. Les plans, journaux et exports nominatifs vont dans le dossier de
travail (hors dépôt git) : `~/veridian/contacts-crm/` par défaut.

Usage (depuis le bastion) :
  set -a; . ~/credentials/.all-creds.env; set +a
  python3 nettoyer_personnes.py                 # simulation, écrit plan-<horodatage>.json et a-trancher.md
  python3 nettoyer_personnes.py --appliquer     # écrit dans le CRM
  python3 nettoyer_personnes.py --reference     # (re)génère reference-telephone.json seulement
Fichiers de travail (dans le dossier de travail, jamais dans le dépôt) :
  config.json     identité du propriétaire du CRM (voir plus bas) ;
  decisions.json  {"fusionner":[{"ids":[...],"preuve":"...","survivant":"id","nom":{"firstName":"","lastName":""}}],"separer":[[id,id]]}
                  décisions tracées après lecture des mails ou de la timeline, rejouées à chaque passage ;
  journal-fusions.jsonl, journal-parasites.jsonl  ce qui a été absorbé ou supprimé (la fusion native détruit la fiche absorbée).
Fusion : automatique à partir de 0,90 (même numéro + noms compatibles, même identité sur un nom rare, signature, décision tracée),
cas 0,50 à 0,90 dans a-trancher.md. Étapes : --etapes parasites,noms,fusions,societes ; pilote : --limite-fusions N.
Codes de sortie : 0 fait / rien à faire, 1 erreurs d'écriture, 2 mesure non aboutie.
"""
import argparse, collections, datetime, difflib, json, os, re, sys, time, unicodedata, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crmapi

DIR = os.path.expanduser(os.environ.get("CONTACTS_CRM_DIR", "~/veridian/contacts-crm"))
BACKUPS = os.path.expanduser("~/backups-froid")

# --------------------------------------------------------------------------- constantes métier
# Identité de l'utilisateur : lue dans <dossier de travail>/config.json (jamais dans le dépôt), clés :
#   domaines_proprietaire : domaines d'envoi et alias du propriétaire du CRM
#   adresse_canal         : boîte connectée au CRM (jamais bloquée, jamais un tiers)
#   locaux_proprietaire   : regex des parties locales qui sont les siennes (adresses, alias +étiquette)
_CFG = {}
if os.path.exists(os.path.join(DIR, "config.json")):
    _CFG = json.load(open(os.path.join(DIR, "config.json")))
DOMAINES_ROBERT = tuple(_CFG.get("domaines_proprietaire", ()))
DOMAINES_REBOND = ("return.oximailing.com",)
DOMAINES_TEST = ("example.com", "example.org", "example.net", "example.local", "veridian.local", "veridian-clitest.com",
                 "srv1.mail-tester.com", "mail-tester.com", "calendar.larksuite.com")
LOCAL_SONDE = re.compile(r"^(sonde(-reception)?[-\w]*|probe|prospect-fictif|contact-prospect-fictif|lktest[.\w]*|invited-cli|"
                         r"e2e-[\w-]+|test([-_.]?[\w]*)|debug[-\w]*|manual_test|poc-test|recipient|noreply_[0-9a-f]+)$", re.I)
LOCAL_ROBERT = re.compile(_CFG.get("locaux_proprietaire", r"^$"), re.I)
LOCAL_AUTO = re.compile(r"^(mailer-daemon|postmaster|bounces?([-+_.].*)?)$", re.I)
ADRESSE_CANAL = _CFG.get("adresse_canal", "")      # boîte connectée : jamais bloquée, jamais un tiers
GRATUITS = {"gmail.com", "googlemail.com", "hotmail.com", "hotmail.fr", "outlook.com", "outlook.fr", "yahoo.fr", "yahoo.com",
            "orange.fr", "wanadoo.fr", "wanadoo.com", "free.fr", "sfr.fr", "laposte.net", "live.fr", "live.com", "icloud.com",
            "me.com", "msn.com", "bbox.fr", "neuf.fr", "aol.com", "zoho.com", "proton.me", "protonmail.com", "gmx.fr", "gmx.com",
            "numericable.fr", "club-internet.fr", "wandoo.fr", "ymail.com", "yahoo.co.uk", "mail.com", "outlook.fr"}
GENERIQUES = set("""contact contacts info infos information informations commercial commerciale compta comptabilite accueil direction
admin administration support service services client clients ventes vente achat achats rh recrutement secretariat reception
standard certification qualiopi test unsub noreply no reply facturation devis assistance marchand boutique shop webmaster
nouveaux mautic social dev root demo sav logistique production communication agence cabinet bonjour hello mail email equipe
responsable gestion qualite sales marketing presse partenariat ecole formation orders order commande commandes billing""".split())
MOTS_SOCIETE = set("""sas sarl eurl sasu sci snc sa services service solution solutions monetique multiservices multiservice certification
certifications cabinet dentaire hotel boutique shop store agence groupe conseil consulting informatique ingenierie immobilier
assurance assurances formation formations ecole club association mairie lyon paris france europe digital web studio
atelier atelier restaurant brasserie boulangerie garage pharmacie clinique centre institut societe entreprise compagnie""".split())
PRENOMS_FICHIER = os.path.expanduser(os.environ.get("PRENOMS_FICHIER", "~/veridian/crm-reprise/.raw/prenoms.raw"))
_PRENOMS = None


def prenoms():
    """ensemble de prénoms (fichier INSEE tabulé 'prenom<TAB>effectif') ; vide si le fichier est absent."""
    global _PRENOMS
    if _PRENOMS is None:
        _PRENOMS = set()
        if os.path.exists(PRENOMS_FICHIER):
            for l in open(PRENOMS_FICHIER, encoding="utf8"):
                t = l.rstrip("\n").split("\t")
                if len(t) >= 2 and t[1].isdigit() and int(t[1]) >= 300:
                    _PRENOMS.add(sans_accent(t[0]).lower())
    return _PRENOMS


NOMS_FICHIER = os.path.expanduser(os.environ.get("NOMS_FICHIER", "~/veridian/crm-reprise/.raw/noms.raw"))
SEUIL_NOM_RARE = 2500        # naissances en France (fichier INSEE) : en dessous, un homonyme fortuit est improbable
_NOMS = None


def nom_rare(nom):
    """vrai si le nom de famille est rare. Sans fichier de fréquences, jamais (la règle est alors coupée)."""
    global _NOMS
    if _NOMS is None:
        _NOMS = {}
        if os.path.exists(NOMS_FICHIER):
            for l in open(NOMS_FICHIER, encoding="utf8"):
                t = l.rstrip("\n").split("\t")
                if len(t) >= 2 and t[1].isdigit():
                    _NOMS[sans_accent(t[0]).lower()] = int(t[1])
    if not _NOMS:
        return False
    return _NOMS.get(sans_accent(nom).lower(), 0) <= SEUIL_NOM_RARE


PARTICULES = {"de", "du", "des", "la", "le", "les", "d", "l", "van", "von", "der", "den", "el", "al", "ben", "di", "da", "del", "st"}
ORDRE_ETIQUETTE = ["FAMILLE", "PERSO", "LOCATAIRE", "PRO", "A_TRIER"]      # le plus spécifique d'abord
ORDRE_RELATION = ["CLIENT", "PRESTATAIRE", "PROSPECT"]
SEUIL_AUTO = 0.90
SEUIL_TRANCHER = 0.50


def sans_accent(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn")


def tokens(s):
    return [t for t in re.split(r"[^a-z0-9]+", sans_accent(s).lower()) if t]


def lettres(s):
    return re.sub(r"[^a-z]", "", sans_accent(s).lower())


def titre(s):
    """MAJUSCULES -> Capitalisées ; le reste est laissé tel quel."""
    def un(m):
        mot = m.group(0)
        return mot[:1].upper() + mot[1:].lower() if (mot.isupper() or mot.islower()) and len(mot) > 1 else mot
    return re.sub(r"[^\W\d_]+", un, s or "")


# --------------------------------------------------------------------------- lecture des fiches
def emails_de(x):
    e = x.get("emails") or {}
    return [a.strip().lower() for a in [e.get("primaryEmail")] + list(e.get("additionalEmails") or []) if a and a.strip()]


def tels_de(x):
    """liste de (indicatif sans +, national sans zéro de tête) ; FR par défaut quand l'indicatif manque."""
    ph = x.get("phones") or {}
    sortie = []
    brut = [(ph.get("primaryPhoneNumber"), ph.get("primaryPhoneCallingCode"))]
    brut += [(a.get("number"), a.get("callingCode")) for a in (ph.get("additionalPhones") or [])]
    for num, ind in brut:
        d = re.sub(r"\D", "", num or "")
        if not d:
            continue
        ind = re.sub(r"\D", "", ind or "") or "33"
        if ind == "33":
            d = d.lstrip("0")
        if d.startswith(ind) and len(d) > 9 and ind == "33":
            d = d[len(ind):].lstrip("0")
        sortie.append((ind, d))
    return list(dict.fromkeys(sortie))


def e164(ind, d):
    return "+%s%s" % (ind, d)


def cle_tel(t):
    return t[0] + t[1][-9:]


def local_domaine(adr):
    l, _, d = adr.partition("@")
    return l, d


def etiquette_domaine(d):
    p = d.split(".")
    return p[-2] if len(p) >= 2 else d


def jetons_local(local):
    return [t for t in re.split(r"[._\-+]+", sans_accent(local).lower()) if t]


def est_generique_mot(t):
    return t in GENERIQUES


# --------------------------------------------------------------------------- chargement
class Univers:
    pass


def charger():
    cache = os.path.join(DIR, ".cache-univers.pickle")
    if os.environ.get("CRM_CACHE") == "1" and os.path.exists(cache) and time.time() - os.path.getmtime(cache) < 3600:
        import pickle
        return pickle.load(open(cache, "rb"))
    U = _charger()
    if os.environ.get("CRM_CACHE") == "1":
        import pickle
        pickle.dump(U, open(cache, "wb"))
        os.chmod(cache, 0o600)
    return U


def _charger():
    U = Univers()
    U.people = crmapi.all_pages("people", limit=200)
    U.par_id = {x["id"]: x for x in U.people}
    U.supprimes = []
    jp = os.path.join(DIR, "journal-parasites.jsonl")
    if os.path.exists(jp):
        U.supprimes = [{"emails": {"primaryEmail": a, "additionalEmails": []}} for l in open(jp) if l.strip() for a in json.loads(l)["adresses"]]
    U.companies = {c["id"]: c for c in crmapi.all_pages("companies", limit=200)}
    U.participants = crmapi.all_pages("messageParticipants", limit=200)
    U.messages = {m["id"]: m for m in crmapi.all_pages("messages", limit=200)}
    U.liens = {}
    for obj, fld in [("appels", "personId"), ("textMessages", "personId"), ("calendarEventParticipants", "personId"),
                     ("noteTargets", "targetPersonId"), ("taskTargets", "targetPersonId"), ("opportunities", "pointOfContactId")]:
        c = collections.Counter(r.get(fld) for r in crmapi.all_pages(obj, limit=200) if r.get(fld))
        U.liens[obj] = c
    U.blocklist = {b["handle"].lower(): b for b in crmapi.all_pages("blocklists", limit=200)}
    U.membre = crmapi.rest("GET", "/workspaceMembers?limit=5")["data"]["workspaceMembers"][0]["id"]
    # index participants
    U.msg_handles = collections.defaultdict(set)      # message -> handles
    U.msg_from = collections.defaultdict(list)        # handle -> messages dont il est expéditeur
    U.noms_affiches = collections.defaultdict(collections.Counter)
    U.part_par_personne = collections.Counter()
    for r in U.participants:
        h = (r["handle"] or "").lower()
        U.msg_handles[r["messageId"]].add(h)
        if r["role"] == "FROM":
            U.msg_from[h].append(r["messageId"])
        if r.get("displayName"):
            U.noms_affiches[h][r["displayName"]] += 1
        if r.get("personId"):
            U.part_par_personne[r["personId"]] += 1
    return U


def nb_liens_durs(U, pid):
    """liens autres que les participants de mails (appels, SMS, agenda, notes, tâches, opportunités)."""
    return sum(U.liens[k].get(pid, 0) for k in U.liens)


def nb_liens(U, pid):
    return nb_liens_durs(U, pid) + U.part_par_personne.get(pid, 0)


# --------------------------------------------------------------------------- parasites
def est_univers_robert(h):
    h = (h or "").lower()
    l, d = local_domaine(h)
    return (h == ADRESSE_CANAL or d in DOMAINES_ROBERT or d in DOMAINES_REBOND or d in DOMAINES_TEST or
            bool(LOCAL_ROBERT.match(l)) or d.endswith(".mail-tester.com") or
            bool(LOCAL_SONDE.match(l) and d in DOMAINES_ROBERT))


def categorie_adresse(h):
    """None si l'adresse est celle d'une vraie personne ; sinon (categorie, motif)."""
    l, d = local_domaine(h)
    if d in DOMAINES_REBOND or LOCAL_AUTO.match(l):
        return ("rebond", "adresse de rebond ou d'envoi automatique")
    if d in DOMAINES_TEST or d.endswith(".mail-tester.com") or LOCAL_SONDE.match(l):
        return ("sonde", "sonde ou adresse de test")
    if LOCAL_ROBERT.match(l):
        return ("robert", "adresse de Robert")
    if d in DOMAINES_ROBERT:
        return ("robert", "alias ou domaine d'envoi de Robert")
    return None


def tiers_reels(U, h):
    """nombre de messages où l'adresse figure avec au moins un correspondant qui n'est ni Robert ni une sonde."""
    n = 0
    for m, hs in U.msg_handles.items():
        if h in hs and any(not est_univers_robert(o) for o in hs if o != h):
            n += 1
    return n


def planifier_parasites(U):
    suppr, a_trancher, bloc_demande = [], [], {}
    par_adresse = collections.defaultdict(set)
    for m, hs in U.msg_handles.items():
        for h in hs:
            par_adresse[h].add(m)
    tiers = {}
    for h, ms in par_adresse.items():
        tiers[h] = sum(1 for m in ms if any(not est_univers_robert(o) for o in U.msg_handles[m] if o != h))
    for x in U.people:
        es = emails_de(x)
        if not es:
            continue
        cats = [categorie_adresse(e) for e in es]
        nom = tokens((x["name"]["firstName"] + " " + x["name"]["lastName"]))
        if all(cats):
            motif = cats[0]
            if nb_liens_durs(U, x["id"]) or tels_de(x) or x.get("etiquette"):
                a_trancher.append({"type": "parasite_avec_liens", "ids": [x["id"]], "pour": motif[1],
                                   "contre": "la fiche porte des appels, SMS, notes, opportunités, un numéro ou une étiquette"})
                continue
            suppr.append({"id": x["id"], "adresses": es, "categorie": motif[0], "motif": motif[1]})
            for e in es:
                bloc_demande[e] = tiers.get(e, 0)
        elif any(cats) and any(c and c[0] == "robert" for c in cats):
            a_trancher.append({"type": "parasite_mixte", "ids": [x["id"]], "pour": "une adresse de Robert parmi d'autres",
                               "contre": "la fiche porte aussi une adresse de tiers"})
    # fiches parasites déjà supprimées (suppression douce) : leurs adresses restent à bloquer
    for x in getattr(U, "supprimes", []):
        es = emails_de(x)
        cats = [categorie_adresse(e) for e in es]
        if es and all(cats):
            for e in es:
                bloc_demande[e] = tiers.get(e, 0)
    # liste de blocage : exactes, ou domaines de rebond/test ; jamais ce qui ferait perdre un vrai échange
    bloquer, non_bloques = {}, []
    for h, t in bloc_demande.items():
        l, d = local_domaine(h)
        if h == ADRESSE_CANAL:
            continue
        if t == 0:
            cible = ("@" + d) if (d in DOMAINES_REBOND or d in DOMAINES_TEST or d.endswith(".mail-tester.com")) else h
            if cible.startswith("@") and any(tiers.get(o, 0) for o in par_adresse if o.endswith(cible)):
                cible = h
            bloquer[cible] = "adresse sans aucun échange avec un tiers réel" if not cible.startswith("@") else "domaine de rebond ou de test sans échange réel"
        else:
            non_bloques.append({"adresse": h, "messages_avec_tiers_reels": t})
    return suppr, bloquer, non_bloques, a_trancher


# --------------------------------------------------------------------------- noms
def nom_de(x):
    return (x["name"]["firstName"] or "").strip(), (x["name"]["lastName"] or "").strip()


def jetons_nom(x):
    f, l = nom_de(x)
    return [re.sub(r"\d+$", "", t) for t in tokens(f + " " + l) if t not in PARTICULES and re.sub(r"\d+$", "", t)]


def est_generique(x):
    jt = jetons_nom(x)
    if not jt:
        return False
    return all(t in GENERIQUES for t in jt)


def nom_vide(x):
    return not jetons_nom(x)


def souche_adresse(x):
    """True si le prénom n'est que le début de l'adresse (fiche créée depuis l'adresse mail)."""
    f, l = nom_de(x)
    if l or not f:
        return False
    return any(lettres(f) == lettres(local_domaine(e)[0]) for e in emails_de(x))


def nom_deduit_adresse(x):
    """prénom.nom lu dans l'adresse d'une fiche sans nom (jetons alphabétiques, 2 à 3, aucun générique)."""
    for e in emails_de(x):
        l, d = local_domaine(e)
        jt = [t for t in jetons_local(l) if t.isalpha() and len(t) > 1]
        if 2 <= len(jt) <= 3 and not any(t in GENERIQUES for t in jt) and len(jt) == len(jetons_local(re.sub(r"\d+", "", l))):
            return jt
    return None


def jetons_effectifs(x, complements):
    c = complements.get(x["id"])
    if c:
        return [t for t in tokens(c["firstName"] + " " + c["lastName"]) if t not in PARTICULES]
    jt = jetons_nom(x)
    if not jt and nom_vide(x):
        jt = nom_deduit_adresse(x) or []
    return jt


def relation_noms(a, b):
    """'egal' | 'inclus' | 'conflit' | 'inconnu' entre deux ensembles de jetons."""
    if not a or not b:
        return "inconnu"
    A, B = set(a), set(b)
    if A == B:
        return "egal"
    def inclus(p, g):
        return all(t in g or any(len(t) == 1 and u.startswith(t) for u in g) for t in p)
    if inclus(A, B) or inclus(B, A):
        return "inclus"
    return "conflit"


# --------------------------------------------------------------------------- compléments de noms
def local_coherent(local, jt):
    """l'adresse peut-elle venir de ces jetons (prénom, nom) ? formes : prenom, prenom.nom, pnom, nom, nomprenom."""
    L = lettres(local)
    if not L or len(jt) < 1:
        return False
    f, n = jt[0], "".join(jt[1:]) if len(jt) > 1 else ""
    formes = {f, f + n, f[:1] + n, n + f, n, n + f[:1], f + n[:1]}
    formes.discard("")
    return L in formes or any(L.startswith(fm) and len(L) - len(fm) <= 2 for fm in formes if len(fm) >= 4)


def nom_plausible(jt, dom):
    """jt : jetons sans accent, minuscules. Un vrai nom de personne, pas celui d'une société ou d'un service."""
    if not 2 <= len(jt) <= 3:
        return False
    if any(not re.fullmatch(r"[a-z'\-]{2,}", t) for t in jt):
        return False
    eti = etiquette_domaine(dom)
    if any(t in GENERIQUES or t in MOTS_SOCIETE or t in (eti, lettres(eti)) for t in jt):
        return False
    pr = prenoms()
    if pr and not (jt[0] in pr or jt[-1] in pr):
        return False
    return True


def lignes_signature(texte):
    """lignes courtes de la fin du haut du message (là où se trouve la signature)."""
    ls = [l.strip(" 	*_-,.") for l in haut_du_message(texte).splitlines()]
    ls = [l for l in ls if l]
    return ls[-12:]


def propose_nom_affiche(U, x):
    """nom complet lu dans les noms affichés ou les signatures des mails de l'adresse, corroboré par l'adresse."""
    f, l = nom_de(x)
    if l:
        return None
    for e in emails_de(x):
        loc, dom = local_domaine(e)
        base = loc.split("+")[0]
        if base in GENERIQUES or dom in DOMAINES_ROBERT or jetons_local(base)[:1] and jetons_local(base)[0] in GENERIQUES:
            continue
        cands = collections.Counter()
        source = {}
        for d, n in U.noms_affiches.get(e, {}).items():
            d2 = re.sub(r"\(.*?\)|\[.*?\]", " ", d)
            d2 = re.sub(r"(ktq|abb[ée])|\d{2,4}", " ", d2, flags=re.I)
            cands_jt = [t for t in re.split(r"\s+", d2.strip()) if t]
            if "@" in d:
                continue
            cands[tuple(cands_jt)] += n
            source[tuple(cands_jt)] = "nom affiché"
        for mid in U.msg_from.get(e, [])[:12]:
            m = U.messages.get(mid)
            if not m:
                continue
            for ligne in lignes_signature(m.get("text")):
                jt = tuple(ligne.split())
                if 2 <= len(jt) <= 3 and len(ligne) < 40 and all(re.fullmatch(r"[^\W\d_][\w'\-]*", w) for w in jt):
                    cands[jt] += 1
                    source.setdefault(jt, "signature")
        best = None
        for jt, n in cands.most_common():
            tk = [sans_accent(t).lower() for t in jt]
            if not nom_plausible(tk, dom):
                continue
            ok = None
            for ordre in (tk, tk[::-1]):
                if local_coherent(base, ordre):
                    ok = ordre
                    break
            if ok is None:
                continue
            noms = list(jt) if ok is tk else list(jt)[::-1]
            if not (f == "" or lettres(f) == lettres(noms[0]) or souche_adresse(x)):
                continue
            best = (n, noms, source[jt])
            break
        if best:
            n, noms, src = best
            return {"firstName": titre(noms[0]), "lastName": titre(" ".join(noms[1:])),
                    "preuve": "%s de l'adresse %s (%d fois), cohérent avec l'adresse" % (src, e, n)}
    return None


# --------------------------------------------------------------------------- preuves par les mails
def haut_du_message(texte):
    m = re.search(r"(?im)^(>|le .{5,90} a [ée]crit|on .{5,90} wrote|-----\s*(original|message)|de\s*:|from\s*:)", texte or "")
    return (texte or "")[:m.start()] if m else (texte or "")


def tel_dans_texte(texte, cle):
    blob = re.sub(r"(?<=\d)[\s.\-]+(?=\d)", "", texte or "")
    national = cle[len(cle) - 9:]
    return bool(re.search(r"(?<!\d)(?:\+?33\(?0?\)?|0)" + re.escape(national) + r"(?!\d)", blob))


def preuve_signature(U, tels_a, emails_b):
    """un numéro de la fiche A écrit dans un mail envoyé depuis une adresse de la fiche B ; rend (message, numéro)."""
    for e in emails_b:
        for mid in U.msg_from.get(e, []):
            m = U.messages.get(mid)
            if not m:
                continue
            h = haut_du_message(m.get("text"))
            for t in tels_a:
                if tel_dans_texte(h, t[1]):
                    return mid, e164(*t)
    return None


# --------------------------------------------------------------------------- sociétés
def lettres_societe(c):
    out = {lettres(c.get("name", ""))}
    dom = (c.get("domain") or "")
    dom = re.sub(r"^https?://(www\.)?", "", dom.lower()).split("/")[0]
    if dom:
        out.add(lettres(etiquette_domaine(dom)))
    return {o for o in out if o}


def societes_compatibles(ca, cb):
    if not ca or not cb:
        return None
    if ca["id"] == cb["id"]:
        return True
    for a in lettres_societe(ca):
        for b in lettres_societe(cb):
            if a == b or (len(a) >= 5 and len(b) >= 5 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.9):
                return True
    return False


def domaine_societe(c):
    dom = (c.get("domain") or "")
    return re.sub(r"^https?://(www\.)?", "", dom.lower()).split("/")[0]


# --------------------------------------------------------------------------- évaluation des paires
def completude(U, x, comp):
    f, l = nom_de(x)
    n = 0
    if f and l:
        n += 30
    elif f:
        n += 10
    if x.get("companyId"):
        n += 20
    if x.get("etiquette"):
        n += 15
    n += min(nb_liens(U, x["id"]), 3000) ** 0.5 * 2
    n += 5 * len(emails_de(x)) + 5 * len(tels_de(x))
    if (x.get("createdBy") or {}).get("source") != "EMAIL":
        n += 3
    return n


def evaluer_paire(U, a, b, comp):
    """rend (score, pour[], contre[]) pour 'a et b sont la même personne'."""
    pour, contre = [], []
    ja, jb = jetons_effectifs(a, comp), jetons_effectifs(b, comp)
    rel = relation_noms(ja, jb)
    ta = {cle_tel(t) for t in tels_de(a)}
    tb = {cle_tel(t) for t in tels_de(b)}
    tel_commun = ta & tb
    ca, cb = U.companies.get(a.get("companyId")), U.companies.get(b.get("companyId"))
    soc = societes_compatibles(ca, cb)
    nom_riche = len(set(ja) | set(jb)) >= 2 and not (est_generique(a) or est_generique(b))
    score = 0.0
    if rel == "conflit":
        contre.append("noms différents (%s / %s)" % (" ".join(ja), " ".join(jb)))
        return 0.0, pour, contre
    if rel == "inconnu":
        # une des deux fiches n'a aucun nom exploitable : seulement par numéro + société
        if tel_commun and soc:
            return 0.70, ["même numéro et même société, mais une fiche sans nom exploitable"], contre
        return 0.0, pour, contre
    if est_generique(a) or est_generique(b):
        return 0.0, pour, ["fiche générique (contact, info…)"]
    if rel == "egal":
        pour.append("même nom (%s)" % " ".join(ja))
    else:
        pour.append("nom inclus l'un dans l'autre (%s / %s)" % (" ".join(ja), " ".join(jb)))
    if tel_commun:
        pour.append("même numéro %s" % sorted(tel_commun)[0])
    if soc is True:
        pour.append("même société ou société équivalente (%s / %s)" % (ca["name"], cb["name"]))
    elif soc is False:
        contre.append("sociétés différentes (%s / %s)" % (ca["name"], cb["name"]))
    # signature : numéro de l'un lu dans un mail de l'autre
    sig = None
    if tels_de(a) and emails_de(b):
        sig = preuve_signature(U, tels_de(a), emails_de(b))
    if not sig and tels_de(b) and emails_de(a):
        sig = preuve_signature(U, tels_de(b), emails_de(a))
    if sig:
        pour.append("numéro %s lu dans un mail envoyé depuis l'adresse de l'autre fiche (message %s)" % (sig[1], sig[0][:8]))
    if rel == "egal" and nom_riche:
        if tel_commun and soc is not False:
            score = 0.97
        elif tel_commun:
            score = 0.90
        elif sig:
            score = 0.95
        elif soc is True:
            score = 0.92
        elif soc is None:
            # une seule des deux a une société, l'autre n'en dit rien : rien ne contredit mais rien ne prouve
            score = 0.60
            contre.append("aucune preuve indépendante (ni numéro commun, ni signature, ni société commune)")
        else:
            score = 0.30
    elif rel == "inclus":
        if tel_commun and soc is not False:
            score = 0.95
        elif sig and soc is not False:
            score = 0.92
        elif soc is True:
            score = 0.65
            contre.append("nom incomplet d'un côté, rien d'autre que la société")
        else:
            score = 0.40 if (tel_commun or sig) else 0.0
    elif rel == "egal" and not nom_riche:
        # un seul jeton de nom de chaque côté (deux prénoms identiques)
        if tel_commun and soc is not False:
            score = 0.95
        elif sig and soc is not False:
            score = 0.92
        elif soc is True:
            score = 0.60
            contre.append("prénom seul des deux côtés, société seule en commun")
    # sécurité : étiquettes personnelles
    if score >= SEUIL_AUTO and (a.get("etiquette") in ("FAMILLE", "PERSO") or b.get("etiquette") in ("FAMILLE", "PERSO")):
        if not tel_commun:
            score = min(score, 0.85)
            contre.append("fiche Famille ou Perso sans numéro commun : décision à Robert")
    if score >= SEUIL_AUTO and (a.get("doNotContact") != b.get("doNotContact")):
        pass  # reporté par OU logique à la fusion
    return score, pour, contre


def candidats(U, comp):
    """paires candidates : même numéro, même nom effectif (2 jetons ou plus), préfixe de nom + numéro."""
    paires = set()
    idx_tel = collections.defaultdict(list)
    idx_nom = collections.defaultdict(list)
    idx_sig = collections.defaultdict(list)
    for x in U.people:
        for t in tels_de(x):
            idx_tel[cle_tel(t)].append(x["id"])
        jt = jetons_effectifs(x, comp)
        if jt and not est_generique(x):
            idx_nom[" ".join(sorted(jt))].append(x["id"])
            if len(jt) >= 1:
                idx_sig[jt[-1]].append(x["id"])        # dernier jeton, pour 'inclus'
    for ids in list(idx_tel.values()) + list(idx_nom.values()):
        ids = sorted(set(ids))
        if len(ids) > 12:
            continue
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                paires.add((ids[i], ids[j]))
    # nom inclus : fiche au nom court (téléphone) face à une fiche au nom plus complet (mail) ; la preuve viendra des signatures
    idx_tok = collections.defaultdict(list)
    for x in U.people:
        jt = jetons_effectifs(x, comp)
        if jt and not est_generique(x):
            for t in set(jt):
                idx_tok[t].append(x["id"])
    for x in U.people:
        jt = jetons_effectifs(x, comp)
        if not jt or est_generique(x) or not tels_de(x) or len(jt) > 2:
            continue
        for y_id in idx_tok.get(jt[0], []):
            if y_id == x["id"] or len(idx_tok[jt[0]]) > 40:
                continue
            y = U.par_id[y_id]
            jy = jetons_effectifs(y, comp)
            if len(jy) > len(jt) and set(jt) <= set(jy) and emails_de(y):
                paires.add(tuple(sorted((x["id"], y_id))))
    return paires


def ta_commun(a, b):
    return bool({cle_tel(t) for t in tels_de(a)} & {cle_tel(t) for t in tels_de(b)})


def identites(x, comp, noms_vus=frozenset()):
    """identités (prénom ou initiale, nom) lisibles dans le nom et dans les adresses de la fiche."""
    out = set()
    jt = jetons_effectifs(x, comp)
    if len(jt) >= 2 and not est_generique(x):
        out.add((jt[0], jt[-1]))
        out.add((jt[-1], jt[0]))
    pr = prenoms()
    for e in emails_de(x):
        l, d = local_domaine(e)
        toks = [re.sub(r"\d+$", "", t) for t in re.split(r"[._\-]+", sans_accent(l.split("+")[0]).lower()) if t]
        toks = [t for t in toks if t.isalpha()]
        if any(t in GENERIQUES or t in MOTS_SOCIETE for t in toks):
            continue
        if len(toks) == 2 and all(len(t) >= 2 for t in toks):
            out.add((toks[0], toks[1]))
            out.add((toks[1], toks[0]))
        elif len(toks) == 2 and len(toks[0]) == 1 and len(toks[1]) >= 4:
            out.add((toks[0], toks[1]))
        elif len(toks) == 1 and len(toks[0]) >= 6:
            t = toks[0]
            if t[1:] in noms_vus:
                out.add((t[0], t[1:]))
            for k in (3, 4, 5, 6, 7):
                if t[:k] in pr and len(t) - k >= 3 and t[k:] in noms_vus:
                    out.add((t[:k], t[k:]))
    pr = prenoms()
    return {(f, l) for f, l in out if len(f) == 1 or not pr or f in pr}


def prenom_compatible(a, b):
    return a == b or (len(a) == 1 and b.startswith(a)) or (len(b) == 1 and a.startswith(b))


def paires_identite(U, comp):
    """même personne vue sous plusieurs adresses : même prénom (ou initiale) et même nom RARE, sans société contraire."""
    idx = collections.defaultdict(list)
    noms_vus = set()
    for x in U.people:
        jt = jetons_effectifs(x, comp)
        if len(jt) >= 2:
            noms_vus.update(jt[1:])
            noms_vus.add(jt[-1])
    for x in U.people:
        if est_generique(x):
            continue
        for f, l in identites(x, comp, noms_vus):
            if len(l) >= 4 and l not in GENERIQUES and l not in MOTS_SOCIETE and nom_rare(l):
                idx[l].append((x["id"], f))
    out = {}
    for l, v in idx.items():
        v = list({t for t in v})
        if len(v) > 12:
            continue
        for i in range(len(v)):
            for j in range(i + 1, len(v)):
                (a, fa), (b, fb) = v[i], v[j]
                if a == b or (len(fa) == 1 and len(fb) == 1) or not prenom_compatible(fa, fb):
                    continue
                k = tuple(sorted((a, b)))
                xa, xb = U.par_id[a], U.par_id[b]
                if societes_compatibles(U.companies.get(xa.get("companyId")), U.companies.get(xb.get("companyId"))) is False:
                    continue
                out[k] = ["même identité : prénom (ou initiale) « %s/%s » et nom rare « %s », lus dans le nom ou dans l'adresse" % (fa, fb, l)]
    # même partie locale d'adresse sur deux domaines, même société
    loc = collections.defaultdict(list)
    for x in U.people:
        for e in emails_de(x):
            l, d = local_domaine(e)
            base = l.split("+")[0]
            if len(base) >= 8 and base not in GENERIQUES and not any(t in GENERIQUES for t in jetons_local(base)[:1]):
                loc[base].append((x["id"], d))
    for base, v in loc.items():
        for i in range(len(v)):
            for j in range(i + 1, len(v)):
                (a, da), (b, db) = v[i], v[j]
                if a == b or da == db:
                    continue
                if societes_compatibles(U.companies.get(U.par_id[a].get("companyId")), U.companies.get(U.par_id[b].get("companyId"))) is True:
                    out.setdefault(tuple(sorted((a, b))), ["même partie locale d'adresse « %s » sur deux domaines, même société" % base])
    return out


def planifier_fusions(U, comp, deja_supprimes, decisions):
    paires = candidats(U, comp)
    aretes, a_trancher, evals = [], [], {}
    separer = {frozenset(p) for p in decisions.get("separer", [])}
    forces = set()
    ident = paires_identite(U, comp)
    for d in decisions.get("fusionner", []):
        ids = [i for i in d["ids"] if i in U.par_id and i not in deja_supprimes]
        for i in range(len(ids) - 1):
            k = tuple(sorted((ids[i], ids[i + 1])))
            evals[k] = (1.0, ["décision tracée : " + d["preuve"]], [])
            aretes.append(k)
        forces.update(ids)
    for k, pour in ident.items():
        if k in evals or frozenset(k) in separer or k[0] in deja_supprimes or k[1] in deja_supprimes:
            continue
        evals[k] = (0.91, pour, [])
        aretes.append(k)
    for (ia, ib) in paires:
        if ia in deja_supprimes or ib in deja_supprimes or frozenset((ia, ib)) in separer or (ia, ib) in evals:
            continue
        a, b = U.par_id[ia], U.par_id[ib]
        score, pour, contre = evaluer_paire(U, a, b, comp)
        evals[(ia, ib)] = (score, pour, contre)
        if score == 0.0 and (ta_commun(a, b)) and not est_generique(a) and not est_generique(b):
            a_trancher.append({"type": "numero_partage", "ids": [ia, ib], "score": 0.2,
                               "pour": ["même numéro de téléphone"], "contre": contre or ["noms différents : personnes distinctes ou numéro de standard"]})
        if score >= SEUIL_AUTO:
            aretes.append((ia, ib))
        elif score >= SEUIL_TRANCHER:
            a_trancher.append({"type": "paire", "ids": [ia, ib], "score": round(score, 2), "pour": pour, "contre": contre})
    # composantes connexes
    parent = {}
    def trouver(u):
        while parent.setdefault(u, u) != u:
            parent[u] = parent[parent[u]]
            u = parent[u]
        return u
    for ia, ib in aretes:
        parent[trouver(ia)] = trouver(ib)
    groupes = collections.defaultdict(list)
    for u in list(parent):
        groupes[trouver(u)].append(u)
    plan = []
    for ids in groupes.values():
        ids = sorted(ids)
        # tout couple du groupe doit être compatible (aucun conflit de noms, aucun score nul) sinon on n'y touche pas
        mauvais = [] if forces.intersection(ids) else [(p, q) for i, p in enumerate(ids) for q in ids[i + 1:]
                   if tuple(sorted((p, q))) not in ident and relation_noms(jetons_effectifs(U.par_id[p], comp), jetons_effectifs(U.par_id[q], comp)) == "conflit"]
        if mauvais:
            a_trancher.append({"type": "groupe_incoherent", "ids": ids, "score": 0.5, "pour": ["liens forts entre certaines fiches"],
                               "contre": ["le groupe contient des noms incompatibles"]})
            continue
        preuves = []
        smin = 1.0
        for i, p in enumerate(ids):
            for q in ids[i + 1:]:
                e = evals.get((p, q)) or evals.get((q, p))
                if e and e[0] >= SEUIL_AUTO:
                    preuves.append(e[1])
                    smin = min(smin, e[0])
        # score de groupe : le plus faible lien de l'arbre couvrant, approché par le min des arêtes
        arete_scores = [evals.get((p, q), evals.get((q, p), (0,)))[0] for (p, q) in aretes if p in ids and q in ids]
        sg = min(arete_scores) if arete_scores else 0
        ordre = sorted(ids, key=lambda i: (-completude(U, U.par_id[i], comp), U.par_id[i]["createdAt"]))
        nom_impose = None
        for d in decisions.get("fusionner", []):
            if set(d["ids"]) & set(ids):
                if d.get("survivant") in ids:
                    ordre = [d["survivant"]] + [i for i in ordre if i != d["survivant"]]
                nom_impose = d.get("nom") or nom_impose
        surv, absorbes = ordre[0], ordre[1:]
        plan.append({"survivant": surv, "absorbes": absorbes, "score": round(sg, 2), "nom_impose": nom_impose,
                     "preuves": [p for sub in preuves for p in sub][:8]})
    en_groupe = {i: n for n, g in enumerate(plan) for i in [g["survivant"]] + g["absorbes"]}
    a_trancher = [t for t in a_trancher if not (t["type"] == "paire" and len({en_groupe.get(i, "x" + i) for i in t["ids"]}) == 1)]
    return plan, a_trancher


# --------------------------------------------------------------------------- valeurs fusionnées à imposer
def meilleur_nom(U, ids, comp):
    cands = []
    for i in ids:
        x = U.par_id[i]
        c = comp.get(i)
        f, l = (c["firstName"], c["lastName"]) if c else nom_de(x)
        f, l = re.sub(r"\s*\(.*?\)", "", f).strip(), re.sub(r"\s*\(.*?\)", "", l).strip()
        if not f and len(l.split()) >= 2:
            f, _, l = l.partition(" ")
        propre = all(w[:1].isupper() and w[1:].islower() for w in re.split(r"[ \-]+", (f + " " + l).strip()) if len(w) > 1)
        mauvais = sum(1 for t in tokens(f + " " + l) if t in MOTS_SOCIETE or t in GENERIQUES or re.search(r"\d", t)) + (1 if re.search(r"\d", f + l) else 0)
        cands.append((len(tokens(f + " " + l)) - 10 * mauvais, 1 if propre else 0, f, l))
    cands.sort(key=lambda t: (-t[0], -t[1]))
    n, _, f, l = cands[0]
    return (f, l) if _propre(f, l) else (titre(f), titre(l))


def _propre(f, l):
    return all(w[:1].isupper() and w[1:].islower() for w in re.split(r"[ \-]+", (f + " " + l).strip()) if len(w) > 1)


def valeurs_imposees(U, ids, surv, comp, nom_impose=None):
    xs = [U.par_id[i] for i in ids]
    out = {}
    f, l = (nom_impose["firstName"], nom_impose["lastName"]) if nom_impose else meilleur_nom(U, ids, comp)
    if (f, l) != nom_de(U.par_id[surv]):
        out["name"] = {"firstName": f, "lastName": l}
    et = [x["etiquette"] for x in xs if x.get("etiquette")]
    if et:
        best = sorted(et, key=lambda e: ORDRE_ETIQUETTE.index(e) if e in ORDRE_ETIQUETTE else 99)[0]
        if best != U.par_id[surv].get("etiquette"):
            out["etiquette"] = best
    rl = [x["typeRelation"] for x in xs if x.get("typeRelation")]
    if rl:
        best = sorted(rl, key=lambda e: ORDRE_RELATION.index(e) if e in ORDRE_RELATION else 99)[0]
        if best != U.par_id[surv].get("typeRelation"):
            out["typeRelation"] = best
    if U.par_id[surv].get("etiquette") in ("FAMILLE", "PERSO", "LOCATAIRE") and not U.par_id[surv].get("typeRelation"):
        out["typeRelation"] = None      # la native recopierait PROSPECT sur une fiche personnelle
    st = {x["statutColdCall"] for x in xs if x.get("statutColdCall")}
    if len(st) > 1:
        # statuts en désaccord : on garde le plus restrictif, jamais de relance par erreur
        out["statutColdCall"] = "PAS_INTERESSE" if "PAS_INTERESSE" in st else U.par_id[surv]["statutColdCall"]
        out["_conflit_statut"] = sorted(st)
    if any(x.get("doNotContact") for x in xs) and not U.par_id[surv].get("doNotContact"):
        out["doNotContact"] = True
    return out


# --------------------------------------------------------------------------- sociétés à rattacher
def rattachements_societe(U, deja_en_fusion):
    par_domaine = collections.defaultdict(list)
    for c in U.companies.values():
        d = domaine_societe(c)
        if d:
            par_domaine[d].append(c)
    out = []
    for x in U.people:
        if x.get("companyId") or x["id"] in deja_en_fusion:
            continue
        for e in emails_de(x):
            d = local_domaine(e)[1]
            if not d or d in GRATUITS or d in DOMAINES_ROBERT:
                continue
            cs = par_domaine.get(d) or par_domaine.get("www." + d)
            if cs and len(cs) == 1:
                out.append({"id": x["id"], "companyId": cs[0]["id"], "societe": cs[0]["name"],
                            "preuve": "le domaine de l'adresse %s est celui de la société" % d})
                break
    return out


# --------------------------------------------------------------------------- référence téléphone
def reference_telephone(U, journal):
    absorbes = collections.defaultdict(list)
    for j in journal:
        absorbes[j["survivant"]].append({"nom": j["absorbe_nom"], "telephones": j["absorbe_telephones"], "emails": j["absorbe_emails"], "ancien_id": j["absorbe"]})
    sortie = []
    for x in U.people:
        t = tels_de(x)
        if not t:
            continue
        f, l = nom_de(x)
        c = U.companies.get(x.get("companyId"))
        sortie.append({
            "id_crm": x["id"], "nom_canonique": (f + " " + l).strip(), "prenom": f, "nom": l,
            "telephones_e164": [e164(*u) for u in t], "emails": emails_de(x),
            "societe": c["name"] if c else "", "etiquette": x.get("etiquette"), "type_relation": x.get("typeRelation"),
            "interactions_crm": nb_liens(U, x["id"]),
            "fusionnes": absorbes.get(x["id"], []),
            "numero_invalide": [e164(*u) for u in t if u[0] == "33" and len(u[1]) != 9],
        })
    sortie.sort(key=lambda r: r["nom_canonique"].lower())
    return sortie


# --------------------------------------------------------------------------- application
def sauvegarder(U):
    os.makedirs(BACKUPS, exist_ok=True)
    f = os.path.join(BACKUPS, "crm-veridian4-people-%s.json" % datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S"))
    with open(f, "w") as fh:
        json.dump(U.people, fh, ensure_ascii=False)
    os.chmod(f, 0o600)
    return f


MERGE = """mutation($ids:[UUID!]!,$p:Int!,$d:Boolean){mergePeople(ids:$ids,conflictPriorityIndex:$p,dryRun:$d){id name{firstName lastName} emails{primaryEmail additionalEmails} phones{primaryPhoneNumber additionalPhones{number callingCode}} companyId etiquette}}"""


def journal_ajoute(chemin, ligne):
    with open(chemin, "a") as fh:
        fh.write(json.dumps(ligne, ensure_ascii=False) + "\n")
        fh.flush()
        os.fsync(fh.fileno())


def appliquer(U, plan, comp, rattach, chemin_journal, etapes, limite_fusions=None):
    erreurs = []
    # 1. liste de blocage
    a_bloquer = [h for h in (plan["blocklist"] if "parasites" in etapes else []) if h.lower() not in U.blocklist]
    if a_bloquer:
        try:
            crmapi.JETON = crmapi.ouvrir_session_membre()
        except Exception as e:
            erreurs.append(("session_membre", "", str(e)[:200]))
            a_bloquer = []
    for h in a_bloquer:
        try:
            crmapi.rest("POST", "/blocklists", {"handle": h, "workspaceMemberId": U.membre})
            print("  blocage ajouté : %s" % h)
        except Exception as e:
            erreurs.append(("blocklist", h, str(e)[:200]))
    crmapi.JETON = None
    # 2. suppression douce des parasites
    for s in (plan["parasites"] if "parasites" in etapes else []):
        try:
            # deletePerson = suppression douce (restaurable) ; le DELETE REST détruit pour de bon (mesuré le 16/11)
            crmapi.gql("mutation($i:UUID!){deletePerson(id:$i){id deletedAt}}", {"i": s["id"]})
            journal_ajoute(os.path.join(DIR, "journal-parasites.jsonl"), {"quand": datetime.datetime.now(datetime.timezone.utc).isoformat(), "id": s["id"], "adresses": s["adresses"], "categorie": s["categorie"]})
        except Exception as e:
            erreurs.append(("parasite", s["id"], str(e)[:200]))
    # 3. noms complétés puis fusions
    for c in (plan["noms_completes"] if "noms" in etapes else []):
        try:
            crmapi.rest("PATCH", "/people/" + c["id"], {"name": {"firstName": c["firstName"], "lastName": c["lastName"]}})
        except Exception as e:
            erreurs.append(("nom", c["id"], str(e)[:200]))
    for g in (plan["fusions"][:limite_fusions] if "fusions" in etapes else []):
        ids = [g["survivant"]] + g["absorbes"]
        if any(i not in U.par_id for i in ids):
            continue
        avant = {i: U.par_id[i] for i in ids}
        try:
            crmapi.gql(MERGE, {"ids": ids, "p": 0, "d": True})
            r = crmapi.gql(MERGE, {"ids": ids, "p": 0, "d": False})["mergePeople"]
        except Exception as e:
            erreurs.append(("fusion", g["survivant"], str(e)[:300]))
            continue
        sid = r["id"] if r["id"] not in avant else g["survivant"]
        patch = {k: v for k, v in g["valeurs"].items() if not k.startswith("_")}
        # lotImport : celui de la survivante, jamais celui recopié depuis une absorbée
        patch["lotImport"] = avant[g["survivant"]].get("lotImport") or ""
        try:
            crmapi.rest("PATCH", "/people/" + sid, patch)
            crmapi.rest("GET", "/people/" + sid)
        except Exception as e:
            erreurs.append(("fusion_apres", sid, str(e)[:300]))
            continue
        for i in g["absorbes"]:
            x = avant[i]
            journal_ajoute(chemin_journal, {"quand": datetime.datetime.now(datetime.timezone.utc).isoformat(), "survivant": sid,
                                            "absorbe": i, "absorbe_nom": " ".join(nom_de(x)).strip(),
                                            "absorbe_telephones": [e164(*t) for t in tels_de(x)], "absorbe_emails": emails_de(x),
                                            "score": g["score"], "fiche_absorbee_avant": x})
        print("  fusionné : %s <- %d" % (sid[:8], len(g["absorbes"])))
        time.sleep(4)          # 100 requêtes par minute et par clé
    # 4. sociétés
    for r in (rattach if "societes" in etapes else []):
        try:
            crmapi.rest("PATCH", "/people/" + r["id"], {"companyId": r["companyId"]})
        except Exception as e:
            erreurs.append(("societe", r["id"], str(e)[:200]))
    return erreurs


# --------------------------------------------------------------------------- rapport
def decrire(U, i):
    x = U.par_id.get(i)
    if not x:
        return i[:8]
    c = U.companies.get(x.get("companyId"))
    return "%s [%s]%s%s%s" % (" ".join(nom_de(x)).strip() or "(sans nom)", i[:8],
                              (" " + ", ".join(emails_de(x))) if emails_de(x) else "",
                              (" " + ", ".join(e164(*t) for t in tels_de(x))) if tels_de(x) else "",
                              (" · " + c["name"]) if c else "") + (" {%s}" % x["etiquette"] if x.get("etiquette") else "")


def ecrire_a_trancher(U, a_trancher, chemin):
    L = ["# À trancher (cas douteux, rien n'est appliqué)", "", "Généré le %s. Dans le doute on ne fusionne pas." % datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), ""]
    for t in sorted(a_trancher, key=lambda t: -t.get("score", 0)):
        L.append("## %s (confiance %.2f)" % (t["type"], t.get("score", 0)))
        for i in t["ids"]:
            L.append("- " + decrire(U, i))
        L.append("- Pour : " + " ; ".join(t.get("pour", [])))
        L.append("- Contre : " + " ; ".join(t.get("contre", [])))
        L.append("")
    with open(chemin, "w") as fh:
        fh.write("\n".join(L))
    os.chmod(chemin, 0o600)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--appliquer", action="store_true", help="écrit dans le CRM (sinon simulation)")
    ap.add_argument("--reference", action="store_true", help="ne génère que reference-telephone.json")
    ap.add_argument("--etapes", default="parasites,noms,fusions,societes", help="étapes écrites avec --appliquer")
    ap.add_argument("--limite-fusions", type=int, default=None, help="n'applique que les N premières fusions (pilote)")
    ap.add_argument("--sans-societes", action="store_true", help="ne rattache pas de sociétés")
    a = ap.parse_args()
    os.makedirs(DIR, exist_ok=True)
    os.chmod(DIR, 0o700)
    t0 = time.time()
    try:
        U = charger()
    except Exception as e:
        print("MESURE NON ABOUTIE : lecture du CRM impossible : %s" % e)
        return 2
    chemin_journal = os.path.join(DIR, "journal-fusions.jsonl")
    journal = []
    if os.path.exists(chemin_journal):
        journal = [json.loads(l) for l in open(chemin_journal) if l.strip()]
    print("Lu : %d personnes, %d sociétés, %d participants, %d messages (%.0f s)" % (len(U.people), len(U.companies), len(U.participants), len(U.messages), time.time() - t0))
    if a.reference:
        ref = reference_telephone(U, journal)
        f = os.path.join(DIR, "reference-telephone.json")
        json.dump(ref, open(f, "w"), ensure_ascii=False, indent=1)
        os.chmod(f, 0o600)
        print("reference-telephone.json : %d personnes avec numéro" % len(ref))
        return 0
    suppr, bloquer, non_bloques, a_trancher = planifier_parasites(U)
    ids_suppr = {s["id"] for s in suppr}
    # noms complétés (prénom seul -> nom complet corroboré)
    comp, noms_completes = {}, []
    for x in U.people:
        if x["id"] in ids_suppr:
            continue
        p = propose_nom_affiche(U, x)
        if p:
            comp[x["id"]] = p
            noms_completes.append({"id": x["id"], "avant": " ".join(nom_de(x)), "firstName": p["firstName"], "lastName": p["lastName"], "preuve": p["preuve"]})
    chemin_dec = os.path.join(DIR, "decisions.json")
    decisions = json.load(open(chemin_dec)) if os.path.exists(chemin_dec) else {}
    fusions, tr2 = planifier_fusions(U, comp, ids_suppr, decisions)
    a_trancher += tr2
    for g in fusions:
        g["valeurs"] = valeurs_imposees(U, [g["survivant"]] + g["absorbes"], g["survivant"], comp, g.get("nom_impose"))
    en_fusion = {i for g in fusions for i in [g["survivant"]] + g["absorbes"]}
    rattach = [] if a.sans_societes else rattachements_societe(U, en_fusion)
    # un nom complété sur une fiche absorbée est inutile : seul le nom retenu compte
    absorbes_tous = {i for g in fusions for i in g["absorbes"]}
    noms_completes = [c for c in noms_completes if c["id"] not in absorbes_tous]
    plan = {"genere": datetime.datetime.now(datetime.timezone.utc).isoformat(), "appliquer": a.appliquer,
            "chiffres_avant": {"personnes": len(U.people)},
            "parasites": suppr, "blocklist": bloquer, "adresses_non_bloquees_car_echanges_reels": non_bloques,
            "fusions": fusions, "noms_completes": noms_completes, "societes_rattachees": rattach, "a_trancher": a_trancher}
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    chemin_plan = os.path.join(DIR, "plan-%s.json" % ts)
    json.dump(plan, open(chemin_plan, "w"), ensure_ascii=False, indent=1)
    os.chmod(chemin_plan, 0o600)
    ecrire_a_trancher(U, a_trancher, os.path.join(DIR, "a-trancher.md"))
    print("Plan : %d parasites à supprimer, %d adresses à bloquer (%d laissées car échanges réels), %d fusions (%d fiches absorbées), "
          "%d noms complétés, %d sociétés rattachées, %d cas à trancher" % (
              len(suppr), len(bloquer), len(non_bloques), len(fusions), len(absorbes_tous), len(noms_completes), len(rattach), len(a_trancher)))
    print("  plan : %s" % chemin_plan)
    if not a.appliquer:
        print("SIMULATION : rien n'a été écrit. Relancer avec --appliquer.")
        return 0
    f = sauvegarder(U)
    print("Export avant écriture : %s" % f)
    erreurs = appliquer(U, plan, comp, rattach, chemin_journal, set(a.etapes.split(',')), a.limite_fusions)
    for e in erreurs:
        print("ERREUR", e)
    U2 = charger()
    journal = [json.loads(l) for l in open(chemin_journal) if l.strip()] if os.path.exists(chemin_journal) else []
    ref = reference_telephone(U2, journal)
    fr = os.path.join(DIR, "reference-telephone.json")
    json.dump(ref, open(fr, "w"), ensure_ascii=False, indent=1)
    os.chmod(fr, 0o600)
    print("Après : %d personnes (avant %d) ; reference-telephone.json : %d personnes avec numéro" % (len(U2.people), len(U.people), len(ref)))
    return 1 if erreurs else 0


if __name__ == "__main__":
    sys.exit(main())
