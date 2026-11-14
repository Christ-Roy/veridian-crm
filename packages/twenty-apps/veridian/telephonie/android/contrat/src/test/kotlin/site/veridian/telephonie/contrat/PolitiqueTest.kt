package site.veridian.telephonie.contrat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PolitiqueTest {
    // Le cas du 13/11/2026 au soir : 22 %, débranché, deux appels neufs jamais transcrits.
    @Test fun appelNeufA22PourCentDebrancheEstTranscrit() = assertTrue(Politique.permise("neuf", 22, enCharge = false))

    @Test fun appelNeufA10PourCentDebrancheEstTranscrit() = assertTrue(Politique.permise("neuf", 10, enCharge = false))

    @Test fun appelNeufSous10PourCentDebrancheAttendLeChargeur() {
        assertFalse(Politique.permise("neuf", 9, enCharge = false))
        assertEquals("batterie 9 % débranché (sous 10 %) : reprise au branchement", Politique.attente("neuf", 9, false))
    }

    @Test fun appelNeufSous10PourCentEnChargePart() = assertTrue(Politique.permise("neuf", 3, enCharge = true))

    @Test fun maintenantSuitLaRegleDuNeuf() {
        assertTrue(Politique.permise("maintenant", 22, enCharge = false))
        assertFalse(Politique.permise("maintenant", 5, enCharge = false))
    }

    @Test fun niveauIllisibleNeBloquePasUnAppelNeuf() = assertTrue(Politique.permise("neuf", null, enCharge = false))

    @Test fun repriseEnChargeExigeLeChargeur() = assertFalse(Politique.permise("en_charge", 95, enCharge = false))

    // 12/11 : à 14 % sur un chargeur lent, une reprise de 1 h 42 empêchait la batterie de remonter.
    @Test fun repriseEnChargeExige30PourCent() {
        assertFalse(Politique.permise("en_charge", 14, enCharge = true))
        assertTrue(Politique.permise("en_charge", 30, enCharge = true))
    }

    @Test fun cleBatterieNeChangeQuAuxSeuils() {
        assertEquals(Politique.cleBatterie(22, false), Politique.cleBatterie(21, false))
        assertNotEquals(Politique.cleBatterie(10, false), Politique.cleBatterie(9, false))
        assertNotEquals(Politique.cleBatterie(29, true), Politique.cleBatterie(30, true))
        assertNotEquals(Politique.cleBatterie(50, true), Politique.cleBatterie(50, false))
    }

    @Test fun appelDecrocheSansFichierEstNonEnregistre() =
        assertTrue(Politique.nonEnregistre(1_000_000L, 32, listOf(1_000_000L - 600_000)))

    @Test fun appelDecrocheAvecFichierProcheEstEnregistre() =
        assertFalse(Politique.nonEnregistre(1_000_000L, 32, listOf(1_000_000L + 8_000)))

    @Test fun appelNonDecrocheNestJamaisReproche() = assertFalse(Politique.nonEnregistre(1_000_000L, 0, emptyList()))

    @Test fun toleranceDe90Secondes() {
        assertFalse(Politique.nonEnregistre(0L, 5, listOf(90_000L)))
        assertTrue(Politique.nonEnregistre(0L, 5, listOf(90_001L)))
    }

    private val jem = "com.jemcik.jemrec.shell.Main"
    private fun liste(vararg l: String) = (listOf("DEBUT-LISTE", "ARGS", "init second_stage", "system_server") + l + "FIN-LISTE").joinToString("\n")

    @Test fun processusVuDansUneListeComplete() =
        assertEquals(true, Politique.processus(liste("app_process / $jem 28472", "adbd"), jem))

    @Test fun absenceProuveeParUneListeComplete() = assertEquals(false, Politique.processus(liste("adbd"), jem))

    // Le cas du 14/11 : le shell rend une sortie vide, ce n'est pas une absence.
    @Test fun sortieVideNonVerifiable() = assertEquals(null, Politique.processus("", jem))

    @Test fun listeTronqueeNonVerifiable() =
        assertEquals(null, Politique.processus("DEBUT-LISTE\nsystem_server\nadbd\n", jem))

    @Test fun listeSansSystemeNonVerifiable() =
        assertEquals(null, Politique.processus("DEBUT-LISTE\nadbd\nFIN-LISTE\n", jem))

    @Test fun portLuSurLaLigneDuProcessus() {
        assertEquals(28472, Politique.portDe(liste("app_process / $jem 28472"), jem))
        assertEquals(null, Politique.portDe(liste("adbd"), jem))
    }
}
