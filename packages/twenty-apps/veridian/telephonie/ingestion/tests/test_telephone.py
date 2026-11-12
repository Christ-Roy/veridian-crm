"""Agent du téléphone (telephone.py), sans téléphone ni réseau : adb, Termux et les moteurs sont simulés."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import crm_telephonie as c  # noqa: E402
import telephone as t  # noqa: E402

SORTIE_PARAKEET = """Segments (1):
Segment 0: [0 -> 120] "Bonjour Robert. Ça va, toi ?"
Tokens [9]:
  [0] id= 1 frame=0 dur_idx= 1 dur_val= 1 p=0.99 plog=-0.01 t0=10 t1=40 word_start=true "▁Bon"
  [1] id= 2 frame=4 dur_idx= 1 dur_val= 1 p=0.99 plog=-0.01 t0=40 t1=60 word_start=false "jour"
  [2] id= 3 frame=6 dur_idx= 1 dur_val= 1 p=0.99 plog=-0.01 t0=70 t1=150 word_start=true "▁Robert"
  [3] id= 4 frame=9 dur_idx= 1 dur_val= 1 p=0.99 plog=-0.01 t0=250 t1=250 word_start=false "."
  [4] id= 5 frame=40 dur_idx= 1 dur_val= 1 p=0.99 plog=-0.01 t0=520 t1=560 word_start=true "▁Ça"
  [5] id= 6 frame=44 dur_idx= 1 dur_val= 1 p=0.99 plog=-0.01 t0=560 t1=600 word_start=true "▁va"
  [6] id= 7 frame=45 dur_idx= 1 dur_val= 1 p=0.99 plog=-0.01 t0=600 t1=600 word_start=false ","
  [7] id= 8 frame=46 dur_idx= 1 dur_val= 1 p=0.99 plog=-0.01 t0=610 t1=650 word_start=true "▁toi"
  [8] id= 9 frame=47 dur_idx= 1 dur_val= 1 p=0.99 plog=-0.01 t0=660 t1=670 word_start=true "▁?"
"""


class EtatIsole(unittest.TestCase):
    def setUp(self):
        self.dossier = Path(tempfile.mkdtemp())
        self.ancien = (t.ETAT, t.JEMREC)
        t.ETAT, t.JEMREC = self.dossier / "etat", self.dossier / "JemRec"
        t.ETAT.mkdir()
        t.JEMREC.mkdir()

    def tearDown(self):
        t.ETAT, t.JEMREC = self.ancien


class Parakeet(unittest.TestCase):
    def test_jetons_en_lignes_horodatees_comme_le_crm(self):
        lignes = t.lignes_depuis_jetons(t.jetons_parakeet(SORTIE_PARAKEET), decalage=90.0)
        # Coupure au silence de plus de 1,2 s après « Robert. », décalage du tronçon ajouté.
        self.assertEqual(lignes, ["[ 90.1- 92.5] Bonjour Robert.", "[ 95.2- 96.7] Ça va, toi ?"])

    def test_tronçons_coupes_au_milieu_d_un_silence(self):
        # Le reste de 100 s (moins de cible + marge / 2) est absorbé par le dernier tronçon.
        morceaux = t.troncons(280.0, [(85.0, 86.0), (100.0, 101.0), (178.0, 182.0)], cible=90, marge=30)
        self.assertEqual(morceaux, [(0.0, 85.5), (85.5, 180.0), (180.0, 280.0)])
        self.assertEqual(t.troncons(100.0, [], cible=90, marge=30), [(0.0, 100.0)])
        # Sans silence près de la cible : coupe nette.
        self.assertEqual(t.troncons(200.0, [], cible=90, marge=30)[0], (0.0, 90.0))


class ParakeetParLots(EtatIsole):
    def test_un_seul_chargement_par_lot_et_reprise_au_troncon(self):
        wav = t.ETAT / "appel.wav"
        wav.write_bytes(b"\0" * (44 + 32_000 * 200))
        regl = dict(t.reglages(), troncon_s=60, lot_troncons=2)
        appels_moteur = []

        def executer(commande, _delai, flux="stdout"):
            if commande[0] == "ffmpeg":
                Path(commande[-1]).write_bytes(b"w")
                return ""
            fichiers = [a for a in commande if a.endswith(".wav")]
            appels_moteur.append([Path(f).name for f in fichiers])
            return "".join(f"read_audio_data: reading audio data from '{f}' ...\n" + SORTIE_PARAKEET for f in fichiers)

        with mock.patch.object(t, "silences", return_value=[]), mock.patch.object(t, "executer_suivi", side_effect=executer):
            (wav.with_name("appel.ggml-parakeet-tdt-0.6b-v3-q8_0.troncons")).mkdir()
            (wav.with_name("appel.ggml-parakeet-tdt-0.6b-v3-q8_0.troncons") / "0000.json").write_text('["[  0.0-  1.0] déjà"]')
            lignes = t.transcrire_parakeet(wav, regl)
        # 200 s en tronçons de 60 s : 4 tronçons, le premier déjà fait, les 3 autres en deux lots.
        self.assertEqual(appels_moteur, [["0001.wav", "0002.wav"], ["0003.wav"]])
        self.assertEqual(lignes[0], "[  0.0-  1.0] déjà")
        self.assertTrue(lignes[1].startswith("[ 60.1-"))
        self.assertEqual(len(lignes), 7)
        self.assertFalse(wav.with_name("appel.ggml-parakeet-tdt-0.6b-v3-q8_0.troncons").exists())


class Sondes(unittest.TestCase):
    def test_sonde_muette_est_non_aboutie_pas_rien_de_neuf(self):
        self.assertIsNone(t.empreinte_sonde(""))
        self.assertIsNone(t.empreinte_sonde("Failed to write while dumping service telephony.registry: Broken pipe\n"))
        avant = t.empreinte_sonde("    mCallState=0\n")
        self.assertNotEqual(avant, t.empreinte_sonde("    mCallState=1\n"))
        self.assertEqual(avant, t.empreinte_sonde("    mCallState=0\nFailed to write ...: Broken pipe\n"))


class FauxCRM:
    """CRM en mémoire : garde les records créés, rend des identifiants, compte l'ordre des écritures."""

    def __init__(self):
        self.url, self.records, self.journal = "http://crm.exemple", {"appels": [], "textMessages": []}, []

    def tout_lister(self, pluriel, filtre=None):
        return [dict(r) for r in self.records.get(pluriel, [])]

    def creer_lot(self, pluriel, lot):
        for corps in lot:
            self.journal.append(("créé", corps["idSource"]))
            self.records[pluriel].append(dict(corps, id=f"id-{len(self.records[pluriel])}"))

    def modifier(self, pluriel, ident, champs):
        self.journal.append(("modifié", ident, sorted(champs)))
        next(r for r in self.records[pluriel] if r["id"] == ident).update(champs)

    def televerser(self, chemin, champ, nom=None):
        self.journal.append(("téléversé", chemin.name))
        return "fichier-" + chemin.stem


class Boucle(EtatIsole):
    """Les sondes réveillent seulement les fils concernés ; une sonde muette ramène les fils au filet de 2 min."""

    def tourner(self, sondes, tours):
        agent = t.Agent(FauxCRM(), t.reglages())
        for flux in agent.flux.values():
            flux.signaler = mock.Mock()
        agent.transcrire_en_fond = mock.Mock()
        reponses = iter(sondes)
        compteur = {"tours": 0}

        def attendre(_secondes):
            compteur["tours"] += 1
            if compteur["tours"] >= tours:
                raise StopIteration

        agent.attendre_tour = attendre
        horloge = iter(range(0, 100000, 10))
        with mock.patch.object(t, "sonder", side_effect=lambda script: next(reponses)), \
                mock.patch.object(t, "connecter_adb"), mock.patch.object(t.Flux, "boucle"), \
                mock.patch.object(t.time, "time", side_effect=lambda: next(horloge)):
            with self.assertRaises(StopIteration):
                agent.boucle(agent.regl)
        return agent, {nom: f.signaler.call_count for nom, f in agent.flux.items()}

    def test_fin_d_appel_reveille_appels_sms_messagerie_pas_les_mms(self):
        # Tour 1 : rapide, sms, mms, messagerie (référence). Tour 2 : seule la sonde rapide change.
        # Au démarrage chaque fil est réveillé une fois.
        agent, reveils = self.tourner(["r0", "s0", "m0", "v0", "r1", "s0", "m0", "v0"], tours=2)
        self.assertEqual(reveils, {"appels": 2, "sms": 2, "mms": 1, "messagerie": 2})
        self.assertTrue(agent.sondes_ok)

    def test_sms_envoye_vu_par_sa_sonde_seule(self):
        _, reveils = self.tourner(["r0", "s0", "m0", "v0", "r0", "r0", "s1"], tours=3)
        self.assertEqual(reveils, {"appels": 1, "sms": 2, "mms": 1, "messagerie": 1})

    def test_sans_adb_les_fils_reviennent_au_filet(self):
        agent, _ = self.tourner([None] * 10, tours=2)
        self.assertFalse(agent.sondes_ok)


class Parallele(EtatIsole):
    """Robert, 12/11 : « envoi brut sur le CRM puis transcript », « faut paralléliser ». Un record est créé avant
    que son audio soit compressé ; un SMS ne patiente jamais derrière un audio ni une transcription."""

    def test_record_cree_avant_la_compression_de_son_audio(self):
        audio = t.JEMREC / "20261112_093015_in.ogg"
        audio.write_bytes(b"x")
        crm = FauxCRM()
        agent = t.Agent(crm, t.reglages())
        appel = c.appel(1794474615000, "+33612345678", 60, "1", "", "PIXEL_8_PRO")
        appel["_fichiers"] = {"enregistrement": [audio]}
        flux = agent.flux["appels"]
        flux.lire = lambda: [dict(appel)]
        agent.televerser = mock.Mock()
        with mock.patch.object(c, "compresser_audio", side_effect=AssertionError("compression avant le record")):
            self.assertEqual(flux.cycle(), 0)
        self.assertEqual(crm.journal, [("créé", appel["idSource"])])
        self.assertNotIn("enregistrement", crm.records["appels"][0])
        self.assertTrue(flux.reveil.is_set())  # le cycle suivant met l'audio en file
        flux.reveil.clear()
        flux.cycle()
        self.assertEqual(agent.televerser.call_args[0][1:], ("id-0", {"enregistrement": [audio]}))

    def test_sms_cree_pendant_qu_un_audio_se_televerse(self):
        audio = t.JEMREC / "20261112_093015_in.ogg"
        audio.write_bytes(b"x")
        crm = FauxCRM()
        crm.records["appels"].append({"id": "a1", "idSource": "appel:1:+33612345678", "enregistrement": []})
        agent = t.Agent(crm, t.reglages())
        libere, commence = t.threading.Event(), t.threading.Event()

        def compression_lente(chemin):
            commence.set()
            libere.wait(10)
            return chemin

        with mock.patch.object(c, "compresser_audio", side_effect=compression_lente):
            agent.televerser(agent.flux["appels"], "a1", {"enregistrement": [audio]})
            self.assertTrue(commence.wait(5))
            sms = c.message(1794474615000, "+33612345678", "1", "Rappelle-moi", "", "PIXEL_8_PRO")
            agent.flux["sms"].lire = lambda: [sms]
            self.assertEqual(agent.flux["sms"].cycle(), 0)
            self.assertEqual(crm.records["textMessages"][0]["idSource"], sms["idSource"])
            self.assertNotIn(("téléversé", audio.name), crm.journal)  # l'audio est toujours en cours
            libere.set()
            for _ in range(50):
                if any(e[0] == "modifié" for e in crm.journal):
                    break
                t.time.sleep(0.1)
        self.assertIn(("modifié", "a1", ["enregistrement"]), crm.journal)

    def test_delai_mesure_depuis_la_fin_de_l_appel(self):
        crm = FauxCRM()
        agent = t.Agent(crm, t.reglages())
        fin_appel = t.time.time() - 12
        appel = c.appel(int((fin_appel - 60) * 1000), "+33612345678", 60, "1", "", "PIXEL_8_PRO")
        agent.flux["appels"].lire = lambda: [appel]
        agent.flux["appels"].cycle()
        _, nom, delai = (t.ETAT / "delais.tsv").read_text().strip().split("\t")
        self.assertEqual(nom, "appels")
        self.assertAlmostEqual(float(delai), 12, delta=2)


class HorsLigne(EtatIsole):
    """Sans réseau : lecture et transcription continuent, l'envoi attend le retour du CRM."""

    def test_crm_injoignable_puis_envoi_au_retour(self):
        agent = t.Agent(c.Twenty("http://127.0.0.1:9", "cle", essais=1), t.reglages())
        appel = c.appel(1794322382233, "+33612345678", 10, "1", "", "PIXEL_8_PRO")
        flux = agent.flux["appels"]
        flux.lire = lambda: [appel]
        self.assertEqual(flux.cycle(), 2)
        self.assertTrue(flux.en_attente)
        self.assertFalse((t.ETAT / "empreinte-appels").exists())
        crm = FauxCRM()
        agent.twenty = crm
        self.assertEqual(flux.cycle(), 0)
        self.assertEqual(flux.cycle(), 0)
        self.assertFalse(flux.en_attente)
        self.assertTrue((t.ETAT / "empreinte-appels").exists())
        self.assertEqual([r["idSource"] for r in crm.records["appels"]], [appel["idSource"]])

    def test_transcription_locale_sans_reseau(self):
        enregistrement = t.JEMREC / "20261112_093015_in.ogg"
        enregistrement.write_bytes(b"x")
        regl = t.reglages()
        agent = t.Agent(c.Twenty("http://127.0.0.1:9", "cle", essais=1), regl)
        with mock.patch.object(t, "appels_locaux", return_value=[]), \
                mock.patch.object(t, "moteurs_prets", return_value=["parakeet"]), \
                mock.patch.object(t, "transcrire_un", return_value=True) as transcrire:
            self.assertTrue(agent.transcrire_en_attente(regl, [enregistrement], []))
        self.assertEqual(transcrire.call_args[0][0], enregistrement)


class Transcription(EtatIsole):
    def test_parakeet_ecrit_le_texte_et_son_moteur_whisper_en_secours(self):
        enregistrement = t.JEMREC / "20261112_093015_in.ogg"
        enregistrement.write_bytes(b"x")
        regl = t.reglages()

        def ffmpeg(commande, _delai, flux="stdout"):
            Path(commande[-1]).write_bytes(b"\0" * (44 + 32_000 * 10))
            return ""

        with mock.patch.object(t, "executer_suivi", side_effect=ffmpeg), \
                mock.patch.object(t, "transcrire_parakeet", side_effect=c.subprocess.CalledProcessError(1, "parakeet")), \
                mock.patch.object(t, "transcrire_whisper", return_value=["[  0.0-  1.0] secours"]):
            self.assertTrue(t.transcrire_un(enregistrement, regl, ["parakeet", "whisper"]))
        self.assertEqual(t.transcription(enregistrement), "[  0.0-  1.0] secours")
        self.assertEqual(t.infos_transcription(enregistrement),
                         {"sourceTranscription": "WHISPER", "moteurTranscription": "whisper-small"})
        self.assertFalse(t.fichier_transcription(enregistrement, ".wav").exists())
        self.assertTrue(t.a_ameliorer(enregistrement, regl))
        with mock.patch.object(t, "executer_suivi", side_effect=ffmpeg), \
                mock.patch.object(t, "transcrire_parakeet", return_value=["[  0.0-  1.0] mieux"]):
            t.transcrire_un(enregistrement, regl, ["parakeet"])
        self.assertEqual(t.infos_transcription(enregistrement)["moteurTranscription"], "parakeet-tdt-0.6b-v3-q8_0")
        self.assertFalse(t.a_ameliorer(enregistrement, regl))
        # Changer de modèle dans les réglages rend tout refaisable.
        autre = dict(regl, parakeet=dict(regl["parakeet"], modele=Path("ggml-parakeet-tdt-0.6b-v3-f16.bin")))
        self.assertTrue(t.a_ameliorer(enregistrement, autre))
        # Les anciennes sont gardées : le CRM n'est remplacé que s'il porte encore l'une d'elles.
        self.assertEqual(t.remplacements(enregistrement), {"transcription": ["[  0.0-  1.0] secours\n"]})

    def test_message_sans_parole_dit_aucune_parole_pas_un_echec(self):
        vocal = t.ETAT / "messagerie" / "20261021_184408_messagerie.amr"
        vocal.parent.mkdir()
        vocal.write_bytes(b"#!AMR")

        def ffmpeg(commande, _delai, flux="stdout"):
            Path(commande[-1]).write_bytes(b"\0" * (44 + 32_000 * 19))
            return ""

        with mock.patch.object(t, "executer_suivi", side_effect=ffmpeg), \
                mock.patch.object(t, "transcrire_parakeet", return_value=[]):
            t.transcrire_un(vocal, t.reglages(), ["parakeet"])
        self.assertEqual(t.transcription(vocal), t.AUCUNE_PAROLE)
        self.assertEqual(t.source_transcription(vocal), "PARAKEET")

    def test_recent_avant_ancien_amelioration_seulement_en_charge(self):
        for nom in ("20261110_190443_in", "20261112_093015_in", "20261111_142116_in"):
            (t.JEMREC / f"{nom}.ogg").write_bytes(b"x")
        (t.ETAT / "transcriptions").mkdir()
        (t.ETAT / "transcriptions" / "20261111_142116_in.txt").write_text("whisper")
        regl = t.reglages()
        agent = t.Agent(mock.Mock(), regl)
        with mock.patch.object(t, "en_charge", return_value=False):
            nouveaux, ameliorer = agent.a_faire(regl)
        self.assertEqual([p.stem for p in nouveaux], ["20261112_093015_in", "20261110_190443_in"])
        self.assertEqual(ameliorer, [])
        with mock.patch.object(t, "en_charge", return_value=True):
            self.assertEqual([p.stem for p in agent.a_faire(regl)[1]], ["20261111_142116_in"])


class GardeBatterie(EtatIsole):
    def test_pause_sous_30_pourcent_hors_charge(self):
        regl = t.reglages()
        for etat, permise in (((25, False), False), ((25, True), True), ((31, False), True), ((None, False), False)):
            with mock.patch.object(t, "batterie", return_value=etat):
                self.assertEqual(t.transcription_permise(regl), permise, etat)

    def test_transcription_en_cours_mise_en_pause_puis_reprise(self):
        enregistrement = t.JEMREC / "20261112_093015_in.ogg"
        enregistrement.write_bytes(b"x")
        regl = t.reglages()
        agent = t.Agent(FauxCRM(), regl)
        with mock.patch.object(t, "appels_locaux", return_value=[]), \
                mock.patch.object(t, "moteurs_prets", return_value=["parakeet"]), \
                mock.patch.object(t, "batterie", return_value=(20, False)), \
                mock.patch.object(t, "transcrire_un", side_effect=lambda chemin, r, m, cede: (_ for _ in ()).throw(
                    t.Preempte(chemin.stem)) if cede() else True):
            self.assertFalse(agent.transcrire_en_attente(regl, [enregistrement], []))
        self.assertTrue(t.a_transcrire_fichier(enregistrement))  # rien de noté : elle reprendra
        with mock.patch.object(t, "batterie", return_value=(20, False)):
            agent.transcrire_en_fond(regl)
        self.assertIsNone(agent.transcripteur)


class FournisseursAdb(EtatIsole):
    def test_mms_lu_une_fois_puis_depuis_le_cache(self):
        reponses = {"content://mms": "Row: 0 _id=7, date=1794322382, msg_box=1\n",
                    "content://mms/7/addr": "Row: 0 address=+33612345678, type=137\n",
                    "mid=7": "Row: 0 _id=70, ct=text/plain, name=NULL\n",
                    "_id=70": "Row: 0 text=Coucou\n"}
        appels = []

        def adb(*commande, **_):
            appels.append(commande)
            cle = commande[commande.index("--where") + 1] if "--where" in commande else commande[3]
            return reponses[cle]

        with mock.patch.object(t, "adb_local", side_effect=adb):
            premier = t.mms_locaux()
            n = len(appels)
            second = t.mms_locaux()
        self.assertEqual(premier[0]["texte"], "Coucou")
        self.assertEqual(second[0]["idSource"], premier[0]["idSource"])
        self.assertEqual(len(appels) - n, 1)

    def test_messages_vocaux_audio_transcription_google_ou_locale(self):
        liste = ("Row: 0 _id=2, number=+33612345678, date=1790078874000, duration=20, has_content=1, "
                 "mime_type=audio/amr, transcription=bonjour Robert\n je rappelle\n"
                 "Row: 1 _id=3, number=+33698765432, date=1792601048000, duration=19, has_content=1, "
                 "mime_type=audio/amr, transcription=NULL\n")

        def adb(*commande, binaire=False, **_):
            return b"#!AMR\n" + commande[-1].encode() if binaire else liste

        with mock.patch.object(t, "adb_local", side_effect=adb):
            vocaux, a_transcrire = t.messages_vocaux_locaux()
        google, sans = vocaux
        self.assertEqual((google["direction"], google["transcription"], google["sourceTranscription"]),
                         ("MESSAGERIE", "bonjour Robert\n je rappelle", "GOOGLE"))
        audio = google["_fichiers"]["enregistrement"][0]
        self.assertEqual(audio.suffix, ".amr")
        self.assertTrue(audio.read_bytes().startswith(b"#!AMR"))
        self.assertNotIn("transcription", sans)
        self.assertEqual(a_transcrire, sans["_fichiers"]["enregistrement"])
        # Rejeu : l'audio déjà copié n'est pas relu.
        with mock.patch.object(t, "adb_local", side_effect=lambda *a, binaire=False, **k: self.fail() if binaire else liste):
            t.messages_vocaux_locaux()

    def test_sans_adb_ni_messages_vocaux_ni_mms_le_reste_passe(self):
        with mock.patch.object(t, "adb_local", side_effect=c.NonAbouti("adb local : code 1")):
            self.assertEqual(t.messages_vocaux_locaux(), ([], []))
            self.assertEqual(t.mms_locaux(), [])


class Reglages(EtatIsole):
    def test_modele_et_fils_parametrables(self):
        fichier = self.dossier / "reglages.json"
        fichier.write_text(json.dumps({"parakeet": {"modele": "~/m/ggml-parakeet-q5_0.bin", "fils": 6}}))
        with mock.patch.object(t, "REGLAGES", fichier):
            regl = t.reglages()
        self.assertEqual(regl["parakeet"]["modele"].name, "ggml-parakeet-q5_0.bin")
        self.assertEqual(regl["parakeet"]["fils"], 6)
        self.assertEqual(regl["parakeet"]["memoire_min_ko"], t.REGLAGES_DEFAUT["parakeet"]["memoire_min_ko"])
        self.assertEqual(regl["moteurs"], ["parakeet", "whisper"])


if __name__ == "__main__":
    unittest.main()
