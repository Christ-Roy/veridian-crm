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


class Boucle(EtatIsole):
    """Le passage part sur l'événement (sonde qui change, réveil), pas sur chaque tour de sonde."""

    def tourner(self, sondes, tours):
        agent = t.Agent(mock.Mock(url="https://crm.exemple"))
        agent.lire = mock.Mock(return_value=([], [], "e"))
        agent.passage = mock.Mock(return_value=0)
        agent.transcrire_en_fond = mock.Mock()
        reponses = iter(sondes)
        horloge = iter(range(0, 100000, 10))
        compteur = {"tours": 0}

        def attendre(_delai):
            compteur["tours"] += 1
            if compteur["tours"] >= tours:
                raise StopIteration

        agent.reveil.wait = attendre
        agent.reveil.set()  # main() réveille l'agent au démarrage
        regl = dict(t.REGLAGES_DEFAUT)
        with mock.patch.object(t, "sonder", side_effect=lambda script: next(reponses)), \
                mock.patch.object(t, "connecter_adb"), mock.patch.object(t.time, "time", side_effect=lambda: next(horloge)):
            with self.assertRaises(StopIteration):
                agent.boucle(regl)
        return agent.passage.call_count

    def test_passage_seulement_quand_une_sonde_change(self):
        # Tour 1 : premier passage (démarrage). Tours 2-3 : rien ne bouge. Tour 4 : fin d'appel.
        sondes = ["r0", "f0", "r0", "r0", "r1", "f0"]
        self.assertEqual(self.tourner(sondes, tours=4), 2)

    def test_sans_adb_retour_au_passage_toutes_les_deux_minutes(self):
        # Sondes muettes (adb fermé) : le filet passe à 120 s, soit un passage au démarrage et un 120 s plus tard.
        self.assertEqual(self.tourner([None] * 40, tours=14), 2)


class HorsLigne(EtatIsole):
    """Sans réseau : lecture et transcription continuent, l'envoi attend le retour du CRM."""

    def test_crm_injoignable_puis_envoi_au_retour(self):
        agent = t.Agent(c.Twenty("http://127.0.0.1:9", "cle", essais=1))
        appel = c.appel(1794322382233, "+33612345678", 10, "1", "", "PIXEL_8_PRO")
        lecture = ([appel], [], "empreinte-1")
        self.assertEqual(agent.passage(lecture), 2)
        self.assertTrue(agent.en_attente)
        self.assertFalse((t.ETAT / "derniere-empreinte").exists())
        crm = mock.Mock(url="http://127.0.0.1:9")
        crm.tout_lister.return_value = []
        agent.twenty = crm
        self.assertEqual(agent.passage(lecture), 0)
        self.assertFalse(agent.en_attente)
        self.assertEqual((t.ETAT / "derniere-empreinte").read_text(), "empreinte-1")
        self.assertEqual(crm.creer_lot.call_args[0][1][0]["idSource"], appel["idSource"])

    def test_transcription_locale_sans_reseau(self):
        enregistrement = t.JEMREC / "20261112_093015_in.ogg"
        enregistrement.write_bytes(b"x")
        agent = t.Agent(c.Twenty("http://127.0.0.1:9", "cle", essais=1))
        regl = t.reglages()
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
        self.assertEqual(t.source_transcription(enregistrement), "WHISPER")
        self.assertFalse(t.fichier_transcription(enregistrement, ".wav").exists())
        self.assertTrue(t.a_ameliorer(enregistrement))
        with mock.patch.object(t, "executer_suivi", side_effect=ffmpeg), \
                mock.patch.object(t, "transcrire_parakeet", return_value=["[  0.0-  1.0] mieux"]):
            t.transcrire_un(enregistrement, regl, ["parakeet"])
        self.assertEqual(t.source_transcription(enregistrement), "PARAKEET")
        self.assertFalse(t.a_ameliorer(enregistrement))
        # L'ancienne est gardée : le CRM ne la remplace que s'il la porte encore telle quelle.
        self.assertEqual(t.remplacements(enregistrement), {"transcription": "[  0.0-  1.0] secours\n"})

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
        agent = t.Agent(mock.Mock())
        regl = t.reglages()
        with mock.patch.object(t, "en_charge", return_value=False):
            nouveaux, ameliorer = agent.a_faire(regl)
        self.assertEqual([p.stem for p in nouveaux], ["20261112_093015_in", "20261110_190443_in"])
        self.assertEqual(ameliorer, [])
        with mock.patch.object(t, "en_charge", return_value=True):
            self.assertEqual([p.stem for p in agent.a_faire(regl)[1]], ["20261111_142116_in"])


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
