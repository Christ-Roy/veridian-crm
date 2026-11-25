"""Le faux CRM des épreuves sur émulateur doit filtrer comme Twenty : s'il rendait tout, un doublon que le vrai CRM
provoquerait (fenêtre de dates ou appareil manqués) passerait inaperçu. Lancé par la CI (job contrat)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import faux_crm as f  # noqa: E402


class Filtres(unittest.TestCase):
    appel = {"appareil": "PIXEL_8_PRO", "debutLe": "2026-11-25T10:00:00.123000Z", "titre": None, "numero": "+33611111111"}

    def garde(self, filtre, record=None):
        return all(f.correspond(record or self.appel, c) for c in f.clauses(filtre))

    def test_filtre_de_l_app(self):
        base = 'and(appareil[eq]:PIXEL_8_PRO,debutLe[gte]:"2026-11-25T09:59:59Z",debutLe[lte]:"2026-11-25T10:00:02Z")'
        self.assertTrue(self.garde(base))
        self.assertFalse(self.garde(base.replace("PIXEL_8_PRO", "AUTRE")))

    def test_les_microsecondes_ne_sortent_pas_de_la_fenetre(self):
        # « 10:00:00.123000Z » est après « 10:00:00Z » : une comparaison de textes dirait le contraire
        self.assertTrue(self.garde('debutLe[gte]:"2026-11-25T10:00:00Z"'))
        self.assertFalse(self.garde('debutLe[lte]:"2026-11-25T09:59:59Z"'))

    def test_sonde_is_null(self):
        sonde = "and(titre[is]:NULL,numero[is]:NULL)"
        self.assertFalse(self.garde(sonde))
        self.assertTrue(self.garde("titre[is]:NULL"))

    def test_operateur_inconnu_n_est_pas_ignore(self):
        with self.assertRaises(ValueError):
            self.garde('numero[like]:"%33%"')


if __name__ == "__main__":
    unittest.main()
