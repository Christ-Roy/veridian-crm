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
            self.assertEqual(entrant["_fichier"].name, "20261110_155305_in.ogg")
            self.assertEqual(entrant["transcription"], "[ 0.0- 2.0] Allô")
            self.assertNotIn("_fichier", sortant)
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

    def test_numero_inconnu_reste_sans_lien(self):
        inconnu = c.appel(1, "+33600000000", 5, "1", "", "PIXEL_8_PRO")
        creations, _, bilan = c.planifier("appels", [inconnu], [], self.index)
        self.assertNotIn("personId", creations[0][0])
        self.assertEqual(bilan["sans_personne"], 1)


if __name__ == "__main__":
    unittest.main()


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
