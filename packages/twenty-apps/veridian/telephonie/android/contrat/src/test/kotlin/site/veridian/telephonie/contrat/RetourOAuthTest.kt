package site.veridian.telephonie.contrat

import org.junit.Assert.assertEquals
import org.junit.Test

class RetourOAuthTest {
    @Test fun deuxAdressesSurLeMemePort() =
        assertEquals(listOf("http://127.0.0.1:43117/retour", "http://localhost:43117/retour"), RetourOAuth.adresses(43117))

    @Test fun navigateurSurLocalhost() =
        assertEquals("http://localhost:43117/retour", RetourOAuth.appelee("localhost:43117", 43117))

    @Test fun navigateurSurLocalhostEnMajuscules() =
        assertEquals("http://localhost:43117/retour", RetourOAuth.appelee(" LocalHost:43117 ", 43117))

    @Test fun navigateurSur127() =
        assertEquals("http://127.0.0.1:43117/retour", RetourOAuth.appelee("127.0.0.1:43117", 43117))

    @Test fun sansEnTeteHostOnGardeLAdresseDOrigine() =
        assertEquals("http://127.0.0.1:43117/retour", RetourOAuth.appelee(null, 43117))

    @Test fun hoteInconnuNeDevientJamaisLocalhost() =
        assertEquals("http://127.0.0.1:43117/retour", RetourOAuth.appelee("localhost.exemple.com:43117", 43117))

    @Test fun lectureDeLEnTeteHost() {
        val lignes = listOf("User-Agent: Chrome", "host: localhost:43117", "Accept: */*")
        assertEquals("localhost:43117", RetourOAuth.host(lignes))
        assertEquals(null, RetourOAuth.host(listOf("Accept: */*")))
    }
}
