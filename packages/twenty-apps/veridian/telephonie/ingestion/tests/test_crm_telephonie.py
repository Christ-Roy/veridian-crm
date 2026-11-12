import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import crm_telephonie as c  # noqa: E402


class Normalisation(unittest.TestCase):
    def test_formats_francais_vers_e164(self):
        for brut in ("0612345678", "06 12 34 56 78", "+33612345678", "0033612345678", "+33 6 12 34 56 78",
                     "+330612345678"):
            self.assertEqual(c.normaliser_numero(brut), "+33612345678", brut)

    def test_indicatif_double_comme_twenty(self):
        self.assertEqual(c.normaliser_numero("+3333612345678"), "+33612345678")
        self.assertEqual(c.normaliser_numero("+33336123456"), "+33336123456")

    def test_codes_courts_noms_et_masques_sans_numero(self):
        for brut in ("660", "CIC", "Telegram", "", None, "36179", "+12"):
            self.assertIsNone(c.normaliser_numero(brut), brut)

    def test_numeros_d_une_personne_twenty(self):
        personne = {"id": "p", "phones": {
            "primaryPhoneNumber": "612345678", "primaryPhoneCallingCode": "+33",
            "additionalPhones": [{"number": "07 00 00 00 01", "callingCode": "+33"},
                                 {"number": "+41791234567", "callingCode": "+41"}]}}
        self.assertEqual(c.numeros_personne(personne), {"+33612345678", "+33700000001", "+41791234567"})

    def test_numero_partage_jamais_attribue(self):
        personnes = [{"id": "a", "phones": {"primaryPhoneNumber": "0611111111"}},
                     {"id": "b", "phones": {"primaryPhoneNumber": "+33611111111"}},
                     {"id": "b", "phones": {"primaryPhoneNumber": "0622222222"}}]
        index, ambigus = c.index_telephones(personnes)
        self.assertEqual(ambigus, {"+33611111111"})
        self.assertEqual(index, {"+33622222222": "b"})


class Sources(unittest.TestCase):
    def test_content_query_dernier_champ_absorbe_les_virgules(self):
        sortie = ("Row: 0 _id=12, date=1794323070038, duration=56, type=1, number=+33100000000, name=Société, Paris\n"
                  "Row: 1 _id=9, date=1794321715235, duration=47, type=2, number=660, name=NULL\n")
        lignes = c.parser_content_query(sortie, ["_id", "date", "duration", "type", "number", "name"])
        self.assertEqual(lignes[0]["name"], "Société, Paris")
        self.assertIsNone(lignes[1]["name"])

    def test_id_source_identique_quel_que_soit_le_telephone(self):
        pixel = c.message(1770649625489, "+33698765432", "1", "Bonjour", "Alice", "PIXEL_8_PRO")
        s10e = c.message(1770649625489, "06 98 76 54 32", "1", "Bonjour", "", "GALAXY_S10E")
        self.assertEqual(pixel["idSource"], s10e["idSource"])
        self.assertEqual(len(c.dedoublonner([pixel, s10e])), 1)

    def test_titres_lisibles(self):
        self.assertEqual(c.appel(0, "+33612345678", 192, "1", "", "PIXEL_8_PRO")["titre"], "Entrant · 3 min 12 s")
        self.assertEqual(c.appel(0, "+33612345678", 0, "3", "", "PIXEL_8_PRO")["titre"], "Manqué")
        self.assertEqual(c.appel(0, "+33612345678", 0, "2", "", "PIXEL_8_PRO")["titre"], "Sortant · sans réponse")
        self.assertEqual(c.appel(0, "+33612345678", 3725, "2", "", "PIXEL_8_PRO")["titre"], "Sortant · 1 h 02 min")
        self.assertEqual(c.apercu_message("ENVOYE", "a\nb"), "Envoyé · a b")

    def test_enregistrement_associe_au_bon_appel(self):
        with tempfile.TemporaryDirectory() as dossier:
            dossier = Path(dossier)
            (dossier / "20261110_155305_in.ogg").write_bytes(b"x")
            (dossier / "20261110_155305_in.txt").write_text("[ 0.0- 2.0] Allô\n", encoding="utf-8")
            (dossier / "20261110_120000_out.ogg").write_bytes(b"x")
            enregistrements = c.lire_enregistrements(dossier)
            # Fichier à 15:53:05 Paris : le sortant y est pile, l'entrant (15:53:02) seul a le bon sens.
            entrant = c.appel(1794322382233, "+33612345678", 10, "1", "Alice", "PIXEL_8_PRO")
            sortant = c.appel(1794322385000, "+33612345678", 10, "2", "Alice", "PIXEL_8_PRO")
            orphelins = c.associer_enregistrements([sortant, entrant], enregistrements)
            self.assertEqual(entrant["_fichiers"]["enregistrement"][0].name, "20261110_155305_in.ogg")
            self.assertEqual(entrant["transcription"], "[ 0.0- 2.0] Allô")
            self.assertNotIn("_fichiers", sortant)
            self.assertEqual(orphelins, ["20261110_120000_out.ogg"])


class Plan(unittest.TestCase):
    def setUp(self):
        self.voulu = c.appel(1794322382233, "+33612345678", 10, "1", "Alice", "PIXEL_8_PRO")
        self.index = {"+33612345678": "alice"}

    def test_creation_rattachee(self):
        creations, complements, _ = c.planifier("appels", [self.voulu], [], self.index)
        self.assertEqual(creations[0][0]["personId"], "alice")
        self.assertNotIn("_e164", creations[0][0])
        self.assertEqual(complements, [])

    def test_rejeu_n_ajoute_rien(self):
        existant = {k: self.voulu[k] for k in c.CHAMPS["appels"] if k in self.voulu}
        existant.update(id="r1", personId="alice", transcription="", enregistrement=[])
        creations, complements, _ = c.planifier("appels", [self.voulu], [existant], self.index)
        self.assertEqual((creations, complements), ([], []))

    def test_complete_sans_jamais_ecraser(self):
        existant = {"id": "r1", "idSource": self.voulu["idSource"], "titre": "titre retouché à la main",
                    "personId": "autre-personne-choisie-a-la-main", "transcription": "", "enregistrement": []}
        self.voulu["transcription"] = "[0-1] Allô"
        _, complements, _ = c.planifier("appels", [self.voulu], [existant], self.index)
        identifiant, champs, _ = complements[0]
        self.assertEqual(identifiant, "r1")
        self.assertNotIn("titre", champs)
        self.assertNotIn("personId", champs)
        self.assertEqual(champs["transcription"], "[0-1] Allô")

    def test_personne_trouvee_apres_coup(self):
        existant = {k: self.voulu[k] for k in c.CHAMPS["appels"] if k in self.voulu}
        existant.update(id="r1", personId=None)
        _, complements, _ = c.planifier("appels", [self.voulu], [existant], self.index)
        self.assertEqual(complements[0][1], {"personId": "alice"})

    def test_fichiers_completes_seulement_si_le_champ_est_vide(self):
        message = c.message(1, "+33612345678", "1", "", "", "GALAXY_S10E", canal="MMS")
        message["_fichiers"] = {"piecesJointes": [Path("mms1-piece2.jpg")]}
        vide = {k: message[k] for k in c.CHAMPS["textMessages"] if k in message}
        vide.update(id="m1", piecesJointes=[], personId="alice")
        plein = dict(vide, piecesJointes=[{"fileId": "f", "label": "mms1-piece2.jpg"}])
        _, complements, _ = c.planifier("textMessages", [message], [vide], self.index)
        self.assertEqual(complements[0][2], {"piecesJointes": [Path("mms1-piece2.jpg")]})
        _, complements, _ = c.planifier("textMessages", [message], [plein], self.index)
        self.assertEqual(complements, [])

    def test_meme_appel_vu_a_la_seconde_par_termux_ne_se_duplique_pas(self):
        # Le même appel : adb le voit à la milliseconde, Termux à la seconde.
        existant = {k: self.voulu[k] for k in c.CHAMPS["appels"] if k in self.voulu}
        existant.update(id="r1", personId="alice", debutLe="2026-11-10T14:53:02.233Z")
        termux = c.appel(1794322382000, "+33612345678", 10, "1", "Alice", "PIXEL_8_PRO")
        self.assertNotEqual(termux["idSource"], existant["idSource"])
        creations, complements, _ = c.planifier("appels", [termux], [existant], self.index)
        self.assertEqual((creations, complements), ([], []))

    def test_titre_de_l_outil_mis_a_jour_titre_retouche_garde(self):
        sans_reponse = c.appel(1, "+33612345678", 0, "2", "", "PIXEL_8_PRO")
        existant = {k: sans_reponse[k] for k in c.CHAMPS["appels"] if k in sans_reponse}
        existant.update(id="r1", personId="alice", titre="Sortant")
        _, complements, _ = c.planifier("appels", [sans_reponse], [existant], self.index)
        self.assertEqual(complements[0][1], {"titre": "Sortant · sans réponse"})
        existant["titre"] = "Rappel promis à Alice"
        _, complements, _ = c.planifier("appels", [sans_reponse], [existant], self.index)
        self.assertEqual(complements, [])

    def test_numero_inconnu_reste_sans_lien(self):
        inconnu = c.appel(1, "+33600000000", 5, "1", "", "PIXEL_8_PRO")
        creations, _, bilan = c.planifier("appels", [inconnu], [], self.index)
        self.assertNotIn("personId", creations[0][0])
        self.assertEqual(bilan["sans_personne"], 1)


class Inconnus(unittest.TestCase):
    def test_classement_par_frequence_sans_les_rattaches(self):
        appels = [{"numero": "+33600000001", "personId": None, "debutLe": "2026-01-02", "nomSurTelephone": "Plombier"},
                  {"numero": "+33600000001", "personId": None, "debutLe": "2026-03-04", "nomSurTelephone": ""},
                  {"numero": "+33600000002", "personId": "p", "debutLe": "2026-05-06"}]
        sms = [{"numero": "CIC", "personId": None, "envoyeLe": "2026-02-01"},
               {"numero": "+33600000001", "personId": None, "envoyeLe": "2026-04-01"}]
        lignes = c.resumer_inconnus(appels, sms)
        self.assertEqual([l["numero"] for l in lignes], ["+33600000001", "CIC"])
        self.assertEqual((lignes[0]["appels"], lignes[0]["sms"], lignes[0]["dernier"]), (2, 1, "2026-04-01"))
        self.assertEqual(lignes[0]["noms"], {"Plombier"})


class Dossier(unittest.TestCase):
    def setUp(self):
        import barre_laterale

        self.b = barre_laterale
        self.objet = {"id": "obj"}
        self.champ = {"id": "champ", "options": [{"label": "Pro", "value": "PRO", "position": 1},
                                                  {"label": "Famille", "value": "FAMILLE", "position": 0}]}
        self.entree = {"id": "e1", "type": "OBJECT", "targetObjectMetadataId": "obj", "folderId": None, "position": 2}

    def test_premier_lancement_cree_tout_dans_l_ordre_des_valeurs(self):
        plan = self.b.plan_dossier(self.objet, self.champ, [], {}, [self.entree], "People")
        self.assertEqual([o["value"] for o in plan["vues_a_creer"]], ["FAMILLE", "PRO"])
        self.assertIsNone(plan["dossier"])
        self.assertEqual(len(plan["entrees_a_creer"]), 2)

    def test_rejeu_ne_cree_rien(self):
        vues = [{"id": "v1", "objectMetadataId": "obj"}, {"id": "v2", "objectMetadataId": "obj"}]
        filtres = {"v1": [{"fieldMetadataId": "champ", "operand": "IS", "value": '["FAMILLE"]'}],
                   "v2": [{"fieldMetadataId": "champ", "operand": "IS", "value": '["PRO"]'}]}
        dossier = {"id": "d", "type": "FOLDER", "name": "People"}
        elements = [dossier, dict(self.entree, folderId="d"),
                    {"id": "e2", "type": "VIEW", "viewId": "v1", "folderId": "d"},
                    {"id": "e3", "type": "VIEW", "viewId": "v2", "folderId": "d"}]
        plan = self.b.plan_dossier(self.objet, self.champ, vues, filtres, elements, "People")
        self.assertEqual((plan["vues_a_creer"], plan["entrees_a_creer"]), ([], []))

    def test_nouvelle_etiquette_ajoutee_seule(self):
        self.champ["options"].append({"label": "Voisins", "value": "VOISINS", "position": 2})
        vues = [{"id": "v1", "objectMetadataId": "obj"}]
        filtres = {"v1": [{"fieldMetadataId": "champ", "operand": "IS", "value": '["FAMILLE"]'}]}
        plan = self.b.plan_dossier(self.objet, self.champ, vues, filtres, [self.entree], "People")
        self.assertEqual([o["value"] for o in plan["vues_a_creer"]], ["PRO", "VOISINS"])


class EcritureIsolee(unittest.TestCase):
    """Le 11/11, un enregistrement de 34 Mo coupait la connexion et le passage entier tombait : plus rien n'arrivait."""

    class Twenty:
        def __init__(self):
            self.crees, self.modifies = [], []

        def televerser(self, chemin, champ_uid, nom=None):
            if "gros" in chemin.name:
                raise c.NonAbouti("PUT gros.ogg : Connection reset by peer")
            return "fichier-" + chemin.stem

        def creer_lot(self, pluriel, lot):
            self.crees += lot

        def modifier(self, pluriel, identifiant, champs):
            self.modifies.append((identifiant, champs))

    def test_un_fichier_en_echec_ne_bloque_ni_son_appel_ni_les_suivants(self):
        twenty = self.Twenty()
        dossier = Path(tempfile.mkdtemp())
        gros, petit = dossier / "gros.txt", dossier / "petit.txt"
        gros.write_text("x"), petit.write_text("y")
        creations = [({"idSource": "a"}, {"piecesJointes": [gros]}), ({"idSource": "b"}, {"piecesJointes": [petit]}),
                     ({"idSource": "c"}, None)]
        complements = [("id-d", {"titre": "T"}, {"piecesJointes": [gros]})]
        erreurs = c.ecrire(twenty, "appels", creations, complements)
        self.assertEqual(erreurs, 2)
        self.assertEqual(sorted(r["idSource"] for r in twenty.crees), ["a", "b", "c"])
        self.assertEqual([r for r in twenty.crees if r["idSource"] == "a"][0].get("piecesJointes"), None)
        self.assertEqual([r for r in twenty.crees if r["idSource"] == "b"][0]["piecesJointes"][0]["fileId"], "fichier-petit")
        self.assertEqual(twenty.modifies, [("id-d", {"titre": "T"})])


class MessagerieVocale(unittest.TestCase):
    """12/11 : les messages vocaux arrivent au CRM en appels de direction MESSAGERIE, avec audio et transcription."""

    def test_transcription_sur_plusieurs_lignes_lue_en_entier(self):
        sortie = ("Row: 0 _id=2, number=+33600000001, transcription=bonjour Robert\n ligne deux, avec virgule\n fin\n"
                  "Row: 1 _id=3, number=+33600000002, transcription=NULL\n")
        lignes = c.parser_content_query(sortie, ["_id", "number", "transcription"])
        self.assertEqual(lignes[0]["transcription"], "bonjour Robert\n ligne deux, avec virgule\n fin")
        self.assertIsNone(lignes[1]["transcription"])

    def test_message_vocal_est_un_appel_messagerie(self):
        vocal = c.message_vocal(1793607462000, "06 12 34 56 78", "85", "PIXEL_8_PRO", "allô", "GOOGLE")
        self.assertEqual(vocal["direction"], "MESSAGERIE")
        self.assertEqual(vocal["titre"], "Messagerie · 1 min 25 s")
        self.assertEqual(vocal["idSource"], "messagerie:1793607462000:+33612345678")
        self.assertEqual((vocal["transcription"], vocal["sourceTranscription"]), ("allô", "GOOGLE"))
        self.assertNotIn("transcription", c.message_vocal(1, "+33612345678", 3, "PIXEL_8_PRO", "", None))

    def test_rejeu_ne_cree_rien_et_ne_double_pas_l_appel_manque(self):
        vocal = c.message_vocal(1793607462000, "+33612345678", 85, "PIXEL_8_PRO", "allô", "GOOGLE")
        manque = c.appel(1793607440000, "+33612345678", 0, "3", "", "PIXEL_8_PRO")
        creations, _, _ = c.planifier("appels", [vocal, manque], [], {})
        self.assertEqual(len(creations), 2)
        existants = [dict(corps, id=f"r{i}") for i, (corps, _) in enumerate(creations)]
        self.assertEqual(c.planifier("appels", [vocal, manque], existants, {})[:2], ([], []))


class Transcriptions(unittest.TestCase):
    def setUp(self):
        self.voulu = c.appel(1794322382233, "+33612345678", 10, "1", "Alice", "PIXEL_8_PRO")
        self.existant = {k: self.voulu[k] for k in c.CHAMPS["appels"] if k in self.voulu}
        self.existant.update(id="r1", personId="alice")

    def test_source_ecrite_avec_la_transcription_jamais_seule(self):
        self.voulu.update(transcription="[  0.0-  1.0] Allô", sourceTranscription="PARAKEET")
        creations, _, _ = c.planifier("appels", [self.voulu], [], {})
        self.assertEqual(creations[0][0]["sourceTranscription"], "PARAKEET")
        _, complements, _ = c.planifier("appels", [self.voulu], [dict(self.existant, transcription="")], {})
        self.assertEqual(complements[0][1], {"transcription": "[  0.0-  1.0] Allô", "sourceTranscription": "PARAKEET"})
        # Le CRM a déjà une transcription venue d'ailleurs : la source ne la décrit pas, rien n'est écrit.
        _, complements, _ = c.planifier("appels", [self.voulu], [dict(self.existant, transcription="autre")], {})
        self.assertEqual(complements, [])

    def test_meilleure_transcription_remplace_seulement_celle_de_l_outil(self):
        self.voulu.update(transcription="Parakeet", sourceTranscription="PARAKEET", _remplace={"transcription": "whisper\n"})
        _, complements, _ = c.planifier("appels", [self.voulu], [dict(self.existant, transcription="whisper")], {})
        self.assertEqual(complements[0][1], {"transcription": "Parakeet", "sourceTranscription": "PARAKEET"})
        _, complements, _ = c.planifier("appels", [self.voulu], [dict(self.existant, transcription="retouchée")], {})
        self.assertEqual(complements, [])
        _, complements, _ = c.planifier("appels", [self.voulu], [dict(self.existant, transcription="Parakeet",
                                                                      sourceTranscription="PARAKEET")], {})
        self.assertEqual(complements, [])


class AudioTeleverse(unittest.TestCase):
    def ffmpeg(self, taille):
        def faux(commande, **_):
            Path(commande[-1]).write_bytes(b"o" * taille)
        return faux

    def test_fichier_de_travail_dans_le_dossier_temporaire_jamais_tmp(self):
        from unittest import mock
        with tempfile.TemporaryDirectory() as dossier, tempfile.TemporaryDirectory() as travail:
            source = Path(dossier) / "20261111_150805_in.ogg"
            source.write_bytes(b"x" * 100)
            ancien, tempfile.tempdir = tempfile.tempdir, travail
            try:
                with mock.patch.dict("os.environ", {}, clear=True), \
                        mock.patch.object(c.subprocess, "run", side_effect=self.ffmpeg(10)):
                    sortie = c.compresser_audio(source)
            finally:
                tempfile.tempdir = ancien
            self.assertEqual(sortie.parent, Path(travail))

    def test_amr_toujours_converti_lisible_par_le_navigateur(self):
        from unittest import mock
        with tempfile.TemporaryDirectory() as dossier:
            source = Path(dossier) / "20261112_093015_messagerie.amr"
            source.write_bytes(b"x" * 10)
            ancien, tempfile.tempdir = tempfile.tempdir, dossier
            try:
                with mock.patch.object(c.subprocess, "run", side_effect=self.ffmpeg(50)):
                    sortie = c.compresser_audio(source)
            finally:
                tempfile.tempdir = ancien
            self.assertEqual(sortie.suffix, ".ogg")


if __name__ == "__main__":
    unittest.main()
