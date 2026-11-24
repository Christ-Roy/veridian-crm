"""Canaux de l'app Android, sans réseau : GitHub est doublé en mémoire. Lancé par la CI (job contrat)."""
import json
import re
import sys
import unittest
from pathlib import Path

ANDROID = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ANDROID / "outils"))
import canaux as k  # noqa: E402

DEPOT = "Christ-Roy/veridian-crm"
COMMIT = "0123456789abcdef"


class FauxGitHub(k.GitHub):
    """Les releases en mémoire ; chaque écriture est notée, dans l'ordre. `couper` : nombre d'écritures avant une panne."""

    def __init__(self, a_blanc=False):
        super().__init__(DEPOT, "jeton", a_blanc)
        self.releases, self.ecritures, self.couper = {}, [], None

    def _noter(self, quoi):
        if self.couper is not None and len(self.ecritures) >= self.couper:
            raise k.NonAbouti("panne")
        self.ecritures.append(quoi)

    def release(self, canal):
        r = self.releases.get(canal)
        if r is None:
            return None
        return {"id": canal, "draft": r["draft"], "canal": canal, "assets": [{"name": n, "id": n} for n in r["fichiers"]], "upload_url": canal}

    def creer(self, canal, corps, commit):
        self._noter(("creer", canal))
        self.releases[canal] = {"draft": True, "fichiers": {}, "corps": corps}
        return self.release(canal)

    def annoter(self, r, canal, corps, commit):
        self._noter(("annoter", canal))
        self.releases[canal]["corps"] = corps

    def lire(self, r, nom):
        return None if r is None else self.releases[r["canal"]]["fichiers"].get(nom)

    def retirer(self, r, noms):
        for n in noms:
            self._noter(("retirer", r["canal"], n))
            self.releases[r["canal"]]["fichiers"].pop(n, None)

    def poser(self, r, fichiers):
        for n, o in fichiers.items():
            self._noter(("poser", r["canal"], n))
            self.releases[r["canal"]]["fichiers"][n] = o


class Base(unittest.TestCase):
    def setUp(self):
        self.gh = FauxGitHub()
        self.c = k.Canaux(DEPOT, self.gh)
        # L'état d'aujourd'hui : release stable publiée, lien public, pas de manifeste.
        self.gh.releases["stable"] = {"draft": False, "corps": "", "fichiers": {k.LIEN: b"ancien", k.LIEN + ".sha256": b"", "telephonie-twenty-app.tgz": b""}}

    def essai(self, code, apk=None):
        return self.c.essai(code, f"v{code}", COMMIT, apk or b"apk-%d" % code, b"tgz-%d" % code)

    def fichier(self, canal, nom):
        return self.gh.releases[canal]["fichiers"].get(nom)

    def manifeste(self, canal):
        return json.loads(self.fichier(canal, "manifeste.json"))


class Essai(Base):
    def test_ne_touche_jamais_le_canal_stable(self):
        avant = dict(self.gh.releases["stable"]["fichiers"])
        self.essai(100)
        self.essai(101)
        self.assertEqual(avant, self.gh.releases["stable"]["fichiers"])
        self.assertEqual({e[1] for e in self.gh.ecritures}, {"essai"})
        self.assertEqual(self.manifeste("essai")["versionCode"], 101)

    def test_release_neuve_en_brouillon(self):
        self.essai(100)
        self.assertTrue(self.gh.releases["essai"]["draft"])

    def test_version_egale_ou_inferieure_refusee(self):
        self.essai(100)
        for code in (99, 100):
            with self.assertRaises(k.Refus):
                self.essai(code)
        self.c.promouvoir(100, 100)
        del self.gh.releases["essai"]
        with self.assertRaises(k.Refus):
            self.essai(100)

    def test_une_construction_ne_leve_pas_une_suspension(self):
        self.essai(100)
        self.c.suspendre("essai", "panne")
        self.assertTrue(self.essai(101)["suspendu"])
        self.assertEqual(self.manifeste("essai")["raison"], "panne")

    def test_manifeste_ecrit_apres_les_fichiers_qu_il_annonce(self):
        self.essai(100)
        noms = [e[2] for e in self.gh.ecritures if e[0] == "poser"]
        self.assertLess(noms.index(k.nom_apk(100)), noms.index("manifeste.json"))
        for coupe in range(3):  # panne pendant le téléversement : l'ancien manifeste reste, son APK aussi
            self.gh.ecritures, self.gh.couper = [], coupe
            with self.assertRaises(k.NonAbouti):
                self.essai(200 + coupe)
            self.gh.couper = None
            m = self.manifeste("essai")
            self.assertEqual(m["versionCode"], 100)
            self.assertEqual(k.sha256(self.fichier("essai", k.nom_apk(100))), m["sha256"])

    def test_limites_de_version(self):
        for code in (0, -1, k.CODE_MAX + 1):
            with self.assertRaises(k.Refus):
                self.essai(code)


class Promotion(Base):
    def setUp(self):
        super().setUp()
        self.essai(100)
        self.essai(101)

    def test_memes_octets_meme_empreinte(self):
        m = self.c.promouvoir(101, 10)
        self.assertEqual(self.fichier("stable", k.nom_apk(101)), self.fichier("essai", k.nom_apk(101)))
        self.assertEqual(m["sha256"], self.manifeste("essai")["sha256"])
        self.assertEqual((m["canal"], m["pourcentage"], m["suspendu"]), ("stable", 10, False))
        self.assertIn("/telephonie-android/", m["url"])

    def test_seule_une_version_passee_par_l_essai(self):
        for code in (99, 102):
            with self.assertRaises(k.Refus):
                self.c.promouvoir(code, 10)
        self.assertIsNone(self.fichier("stable", "manifeste.json"))

    def test_octets_changes_depuis_l_essai_refuses(self):
        for nom in (k.nom_apk(101), k.nom_archive(101)):
            bon = self.fichier("essai", nom)
            for faux in (bon + b"x", b"x" + bon[1:], None):
                if faux is None:
                    self.gh.releases["essai"]["fichiers"].pop(nom)
                else:
                    self.gh.releases["essai"]["fichiers"][nom] = faux
                with self.assertRaises(k.Refus):
                    self.c.promouvoir(101, 10)
                self.gh.releases["essai"]["fichiers"][nom] = bon
        self.assertIsNone(self.fichier("stable", "manifeste.json"))

    def test_jamais_en_arriere(self):
        self.c.promouvoir(101, 10)
        for code in (100, 101):
            with self.assertRaises(k.Refus):
                self.c.promouvoir(code, 10)

    def test_canal_suspendu_refuse(self):
        self.c.promouvoir(100, 10)
        self.c.suspendre("stable", "panne")
        with self.assertRaises(k.Refus):
            self.c.promouvoir(101, 10)
        self.c.reprendre("stable")
        self.c.promouvoir(101, 10)

    def test_lien_public_seulement_a_100(self):
        self.c.promouvoir(101, 10)
        self.assertEqual(self.fichier("stable", k.LIEN), b"ancien")
        self.c.pourcentage("stable", 50)
        self.assertEqual(self.fichier("stable", k.LIEN), b"ancien")
        self.c.pourcentage("stable", 100)
        self.assertEqual(self.fichier("stable", k.LIEN), b"apk-101")
        self.assertTrue(self.fichier("stable", k.LIEN + ".sha256").startswith(k.sha256(b"apk-101").encode()))
        self.assertRegex(self.gh.releases["stable"]["corps"], r"Téléphonie CRM (\S+) \(commit")  # lu par veridian.site

    def test_manifeste_en_dernier_et_relu(self):
        self.gh.ecritures.clear()
        self.c.promouvoir(101, 100)
        self.assertEqual([e[2] for e in self.gh.ecritures if e[0] == "poser"][-1], "manifeste.json")
        poser = self.gh.poser
        self.essai(102)
        self.gh.poser = lambda r, f: poser(r, {n: (b"abime" if n == k.nom_apk(102) and r["canal"] == "stable" else o) for n, o in f.items()})
        with self.assertRaises(k.Refus):
            self.c.promouvoir(102, 10)


class Reglages(Base):
    def setUp(self):
        super().setUp()
        self.essai(100)
        self.c.promouvoir(100, 10)

    def test_coupe_circuit(self):
        self.c.suspendre("stable", "appels muets")
        m = self.manifeste("stable")
        self.assertEqual((m["suspendu"], m["raison"], m["versionCode"], m["pourcentage"]), (True, "appels muets", 100, 10))
        self.c.reprendre("stable")
        m = self.manifeste("stable")
        self.assertEqual((m["suspendu"], m["raison"], m["pourcentage"]), (False, "", 10))
        with self.assertRaises(k.Refus):
            self.c.suspendre("stable", " ")

    def test_bornes(self):
        for n in (-1, 101):
            with self.assertRaises(k.Refus):
                self.c.pourcentage("stable", n)
        with self.assertRaises(k.Refus):
            self.c.minimale("stable", 101)
        self.assertEqual(self.c.minimale("stable", 90)["versionMinimale"], 90)
        self.essai(101)
        self.assertEqual(self.c.promouvoir(101, 10)["versionMinimale"], 90)

    def test_menage(self):
        noms = [f(c) for c in range(1, 13) for f in (k.nom_apk, k.nom_fiche, k.nom_archive)] + [k.LIEN, "manifeste.json"]
        retires = k.a_retirer(noms, code_manifeste=2, gardees=8)
        self.assertEqual(sorted(retires), sorted(f(c) for c in (1, 3, 4) for f in (k.nom_apk, k.nom_fiche, k.nom_archive)))


class Redirection(unittest.TestCase):
    """Un fichier de release se lit par une redirection vers un autre hôte : notre jeton n'y part jamais."""

    def test_jeton_jamais_transmis_a_un_autre_hote(self):
        vues = []

        class Reponse:
            def __init__(self, octets=b"", lieu=None):
                self.octets, self.headers = octets, {"Location": lieu}

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return self.octets

        def ouvrir(requete, timeout=None):
            vues.append((requete.full_url, dict(requete.header_items())))
            if len(vues) == 1:
                raise k.urllib.error.HTTPError(requete.full_url, 302, "Found", {"Location": "https://autre.exemple/f"}, None)
            return Reponse(b"octets")

        gh = k.GitHub(DEPOT, "jeton-secret")
        gh.ouvrir = ouvrir
        self.assertEqual(gh._appel("GET", "https://api.github.com/x", accepte="application/octet-stream"), b"octets")
        self.assertIn("Authorization", vues[0][1])
        self.assertEqual(vues[1][0], "https://autre.exemple/f")
        self.assertNotIn("jeton-secret", str(vues[1]))


class Brouillon(unittest.TestCase):
    def test_une_release_neuve_nait_en_brouillon_et_n_est_jamais_latest(self):
        corps = []

        class Reponse:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b"{}"

        gh = k.GitHub(DEPOT, "jeton")
        gh.ouvrir = lambda requete, timeout=None: corps.append(json.loads(requete.data)) or Reponse()
        gh.creer("essai", "notes", COMMIT)
        self.assertEqual((corps[0]["draft"], corps[0]["prerelease"], corps[0]["make_latest"]), (True, True, "false"))


class ABlanc(unittest.TestCase):
    def test_aucune_ecriture(self):
        gh = k.GitHub(DEPOT, None, a_blanc=True)
        import contextlib
        import io
        appels = []
        gh.ouvrir = lambda *a, **b: appels.append(a)
        with contextlib.redirect_stdout(io.StringIO()):
            for m in ("POST", "PATCH", "DELETE"):
                gh._appel(m, "https://api.github.com/repos/x/y", {})
        self.assertEqual(appels, [])


class ContratAvecLApp(Base):
    """Ce que ce script écrit est exactement ce que contrat/MiseAJour.kt accepte."""

    KT = (ANDROID / "contrat/src/main/kotlin/site/veridian/telephonie/contrat/MiseAJour.kt").read_text()

    def test_champs_lus_par_l_app(self):
        self.essai(100)
        lus = set(re.findall(r'j\["(\w+)"\]', self.KT))
        self.assertEqual(lus, set(self.manifeste("essai")))

    def test_tags_adresses_et_bornes(self):
        for canal, tag in k.TAGS.items():
            self.assertIn(f'"{canal}", "{tag}"', self.KT)
        self.assertIn(f'"https://github.com/{DEPOT}/releases/download/"', self.KT)
        self.assertIn("telephonie-crm-$versionCode.apk", self.KT)
        self.assertIn("in 1..2_100_000_000L", self.KT)
        self.assertIn(f"const val FORMAT = {k.FORMAT}L", self.KT)
        self.assertIn(f"minSdk = {k.MIN_SDK}\n", (ANDROID / "app/build.gradle.kts").read_text())

    def test_retour_sans_les_fixtures_d_aujourd_hui(self):
        # Un ancien commit se reconstruit contre le Python du jour : ses fixtures peuvent différer, il doit passer quand même.
        self.assertIn('TELEPHONIE_SANS_FIXTURES:-}" = 1 ] || python3 outils/fixtures_contrat.py --verifier', (ANDROID / "outils/construire.sh").read_text())

    def test_version_code_croissant(self):
        c = (ANDROID / "outils/construire.sh").read_text()
        self.assertIn("$(date +%s) / 60", c)
        self.assertNotIn("+%y%m%d%H", c)


class Workflow(unittest.TestCase):
    """Le fil de la CI : un push ne publie que l'essai, le stable n'avance que par une promotion demandée à la main."""

    CHEMIN = ANDROID.parents[4] / ".github/workflows/telephonie-android.yaml"

    def setUp(self):
        self.texte = self.CHEMIN.read_text()

    def test_declencheurs(self):
        self.assertNotIn("pull_request:", self.texte)
        self.assertNotRegex(self.texte, r"branches:.*main")
        self.assertNotIn("schedule", self.texte)

    def test_runners_veridian_seulement(self):
        runs = re.findall(r"runs-on: (.+)", self.texte)
        self.assertTrue(runs)
        self.assertEqual(set(runs), {"[self-hosted, veridian-jit]"})

    def test_le_push_ne_publie_que_l_essai(self):
        jobs = re.split(r"\n  (?=\w+:\n)", self.texte.split("\njobs:\n")[1])
        apk = next(j for j in jobs if j.strip().startswith("apk:"))
        canal = next(j for j in jobs if j.strip().startswith("canal:"))
        self.assertIn('canaux.py" essai', apk)
        self.assertEqual(len(re.findall(r"canaux\.py\" \w+", apk)), 1)
        for interdit in ("promouvoir", "pourcentage", "publier_release"):
            self.assertNotIn(interdit, apk)
        self.assertIn("github.event_name == 'workflow_dispatch'", canal)
        self.assertNotIn("SIGNATURE", canal)

    def test_aucune_entree_interpolee_dans_un_script(self):
        for bloc in re.findall(r"run: \|\n((?: {10,}.*\n|\n)+)", self.texte) + re.findall(r"run: (?!\|)(.+)", self.texte):
            self.assertNotIn("${{", bloc)


if __name__ == "__main__":
    unittest.main()
