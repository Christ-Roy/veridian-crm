package site.veridian.telephonie.contrat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import site.veridian.telephonie.contrat.Retenue.Mode

class RetenueTest {
    private val index = mapOf("+33611111111" to "personne-1")
    private fun sms(id: String, e164: String?) = mapOf<String, Any?>("idSource" to id, "_e164" to e164, "texte" to "bonjour")
    private fun appel(id: String, e164: String?) = mapOf<String, Any?>("idSource" to id, "_e164" to e164, "numero" to e164, "titre" to "Appel",
        "dureeSecondes" to 12, "direction" to "ENTRANT", "debutLe" to "2026-11-25T10:00:00Z", "nomSurTelephone" to "Maman", "transcription" to "secret",
        "sourceTranscription" to "PARAKEET", "moteurTranscription" to "m", "_fichiers" to mapOf("enregistrement" to listOf("/a.opus")),
        "_remplace" to mapOf("transcription" to "ancien"))
    private fun ids(l: List<Map<String, Any?>>) = l.map { it["idSource"] }

    @Test fun unSmsInconnuResteSurLeTelephone() {
        for (mode in listOf(Mode.FICHE, Mode.RIEN)) {
            val t = Retenue.trier("textMessages", listOf(sms("a", "+33611111111"), sms("b", "+33622222222"), sms("c", null), sms("d", "")), index, mode)
            assertEquals(listOf("a"), ids(t.envoyes))
            assertEquals(listOf("b", "c", "d"), ids(t.retenus))
        }
    }

    @Test fun unAppelInconnuNeMontreQueSaLigne() {
        val t = Retenue.trier("appels", listOf(appel("a", "+33611111111"), appel("b", "+33622222222")), index, Mode.FICHE)
        assertEquals(listOf("a", "b"), ids(t.envoyes))
        assertEquals(1, t.reduits)
        assertEquals("secret", t.envoyes[0]["transcription"])
        assertTrue(t.envoyes[0].containsKey("_fichiers"))
        val inconnu = t.envoyes[1]
        Retenue.CONTENU.forEach { assertFalse("$it ne part pas", inconnu.containsKey(it)) }
        assertEquals("+33622222222", inconnu["_e164"])
        assertEquals("+33622222222", inconnu["numero"])
        assertFalse(inconnu.toString().contains("secret") || inconnu.toString().contains("Maman"))
    }

    @Test fun rienDUnInconnu() {
        val t = Retenue.trier("appels", listOf(appel("a", "+33611111111"), appel("b", "+33622222222"), appel("c", null)), index, Mode.RIEN)
        assertEquals(listOf("a"), ids(t.envoyes))
        assertEquals(listOf("b", "c"), ids(t.retenus))
    }

    @Test fun toutPart() {
        val v = listOf(appel("a", "+33611111111"), appel("b", "+33622222222"))
        assertEquals(v, Retenue.trier("appels", v, index, Mode.TOUT).envoyes)
        assertEquals(1, Retenue.trier("textMessages", listOf(sms("b", "+33622222222")), index, Mode.TOUT).envoyes.size)
    }

    /** Deux personnes portent le numéro : l'index l'écarte, rien ne part au hasard. */
    @Test fun unNumeroPartageEstInconnu() {
        val personnes = listOf("p1", "p2").map { mapOf<String, Any?>("id" to it, "phones" to mapOf("primaryPhoneNumber" to "0611111111",
            "primaryPhoneCallingCode" to "+33", "primaryPhoneCountryCode" to "FR", "additionalPhones" to emptyList<Any>())) }
        val (seul, _) = Contrat.indexTelephones(personnes.take(1))
        assertTrue("témoin : le numéro est reconnu", seul.containsKey("+33611111111"))
        val (partage, ambigus) = Contrat.indexTelephones(personnes)
        assertTrue(ambigus.contains("+33611111111"))
        assertEquals(listOf("a"), ids(Retenue.trier("textMessages", listOf(sms("a", "+33611111111")), partage, Mode.FICHE).retenus))
    }

    /** Le numéro apparaît : la ligne déjà au CRM est complétée (nom, texte, audio) et rattachée, sans doublon. */
    @Test fun laLigneSeCompleteQuandLaPersonneApparait() {
        val complet = appel("appel:1", "+33622222222")
        val ligne = Retenue.trier("appels", listOf(complet), index, Mode.FICHE).envoyes
        val cree = Contrat.planifier("appels", ligne, emptyList(), index)
        assertEquals(1, cree.creations.size)
        assertFalse(cree.creations[0].corps.containsKey("transcription"))
        assertEquals(null, cree.creations[0].fichiers)
        val auCrm = listOf(cree.creations[0].corps + mapOf("id" to "r1", "canal" to "TELEPHONE"))
        val index2 = index + ("+33622222222" to "personne-2")
        val suite = Contrat.planifier("appels", Retenue.trier("appels", listOf(complet), index2, Mode.FICHE).envoyes, auCrm, index2)
        assertEquals(0, suite.creations.size)
        val c = suite.complements.single()
        assertEquals("personne-2", c.champs["personId"])
        assertEquals("secret", c.champs["transcription"])
        assertEquals(setOf("enregistrement"), c.fichiers!!.keys)
    }

    @Test fun leModeParDefautEstPrudent() {
        assertEquals(Mode.FICHE, Mode.de(null))
        assertEquals(Mode.FICHE, Mode.de("n'importe"))
        assertEquals(Mode.TOUT, Mode.de("tout"))
    }
}
