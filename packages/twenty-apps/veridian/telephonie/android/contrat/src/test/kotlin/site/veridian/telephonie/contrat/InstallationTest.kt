package site.veridian.telephonie.contrat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import site.veridian.telephonie.contrat.Installation.Demande
import site.veridian.telephonie.contrat.Installation.Etat
import site.veridian.telephonie.contrat.Installation.Presence
import site.veridian.telephonie.contrat.Installation.Reponse

class InstallationTest {
    // Corps relevés sur le staging le 24/11/2026 (espace jetable, jeton OAuth du membre).
    private val absent = """{"statusCode":400,"error":"BadRequestException","messages":["object 'appels' not found. eg: companies"]}"""
    // /metadata, même jour, mêmes jetons : tout est en HTTP 200.
    private val travail = "install-application.6304833e-3367-4872-8137-92259e473304.e3df4b02-559e-4624-b985-3fd49cfd1725-ce1a8a8e-9efa-402b-886d-be9c723b9010"
    private val acceptee = """{"data":{"triggerInstallApplication":{"jobId":"$travail"}}}"""
    private fun etatTravail(etat: String, raison: String? = null) =
        """{"data":{"findInstallApplicationJobStatus":{"state":"$etat","failedReason":${raison?.let { "\"$it\"" } ?: "null"}}}}"""
    private fun erreur(code: String, message: String) = """{"errors":[{"message":"$message","extensions":{"code":"$code"}}],"data":null}"""
    private val garde = "Installation of application e3df4b02-559e-4624-b985-3fd49cfd1725 is not allowed on workspace 6304833e-3367-4872-8137-92259e473304"

    @Test fun `l application est celle du plugin, la mutation est native`() {
        assertEquals("e3df4b02-559e-4624-b985-3fd49cfd1725", Installation.APPLICATION); assertEquals("/metadata", Installation.CHEMIN)
        assertTrue("triggerInstallApplication(input: \$input) { jobId }" in Installation.DECLENCHER)
        assertTrue("findInstallApplicationJobStatus(universalIdentifier: \$app, jobId: \$travail)" in Installation.SUIVRE)
    }

    @Test fun `reponse a la demande, accepter n est pas installer`() {
        assertEquals(Demande(Reponse.EN_COURS, travail), Installation.lireDemande(200, acceptee))
        val refusees = listOf(erreur("FORBIDDEN", "Entity performing the request does not have permission") to Reponse.INTERDIT,
            erreur("FORBIDDEN", garde) to Reponse.NON_PROPOSEE,
            erreur("NOT_FOUND", "No application registration found for identifier") to Reponse.NON_SERVIE,
            erreur("GRAPHQL_VALIDATION_FAILED", "Cannot query field") to Reponse.NON_SERVIE,
            erreur("UNAUTHENTICATED", "Token invalid.") to Reponse.A_RETENTER,
            erreur("BAD_USER_INPUT", "Cannot install application while its uninstall is in progress") to Reponse.A_RETENTER,
            erreur("INTERNAL_SERVER_ERROR", "oups") to Reponse.A_RETENTER)
        for ((corps, attendu) in refusees) assertEquals(corps, Demande(attendu), Installation.lireDemande(200, corps))
        // org.json peut ajouter des espaces : même lecture.
        assertEquals(Reponse.INTERDIT, Installation.lireDemande(200, refusees[0].first.replace(":", " : ").replace("[{", "[ {")).reponse)
        for ((code, attendu) in listOf(0 to Reponse.A_RETENTER, 401 to Reponse.A_RETENTER, 403 to Reponse.INTERDIT, 404 to Reponse.NON_SERVIE,
            429 to Reponse.A_RETENTER, 500 to Reponse.A_RETENTER, 503 to Reponse.A_RETENTER)) assertEquals("$code", Demande(attendu), Installation.lireDemande(code, ""))
        for (corps in listOf("<!doctype html>", "{}", """{"data":{"triggerInstallApplication":null}}""")) assertEquals(Demande(Reponse.A_RETENTER), Installation.lireDemande(200, corps))
    }

    @Test fun `suivi du travail, c est lui qui dit la garde`() {
        for (e in listOf("WAITING", "PRIORITIZED", "ACTIVE", "DELAYED")) assertEquals(e, Reponse.EN_COURS, Installation.lireTravail(200, etatTravail(e)))
        assertEquals(Reponse.INSTALLEE, Installation.lireTravail(200, etatTravail("COMPLETED")))
        assertEquals(Reponse.NON_PROPOSEE, Installation.lireTravail(200, etatTravail("FAILED", garde)))
        assertEquals(Reponse.ECHEC, Installation.lireTravail(200, etatTravail("FAILED", "Validation errors")))
        assertEquals("le CRM a oublié ce travail", Reponse.A_RETENTER, Installation.lireTravail(200, """{"data":{"findInstallApplicationJobStatus":null}}"""))
        assertEquals(Reponse.INTERDIT, Installation.lireTravail(200, erreur("FORBIDDEN", "x")))
        assertEquals(Reponse.A_RETENTER, Installation.lireTravail(502, etatTravail("COMPLETED")))
    }

    @Test fun `presence des objets`() {
        assertEquals(Presence.PRESENT, Installation.presence(200, "{}"))
        assertEquals(Presence.PRESENT, Installation.presence(403, "{}"))
        assertEquals(Presence.ABSENT, Installation.presence(400, absent))
        // Un autre 400 n'est pas une absence : il ne doit pas retenir l'envoi d'un téléphone qui marche.
        assertEquals(Presence.INCONNU, Installation.presence(400, """{"messages":["invalid filter"]}"""))
        assertEquals(Presence.INCONNU, Installation.presence(400, absent.replace("appels", "people")))
        assertEquals(Presence.INCONNU, Installation.presence(502, absent))
        // Objet déjà lisible, champs pas encore tous là (migrations différées) : pas prêt.
        val incomplet = """{"statusCode":400,"messages":["Object appel doesn't have any \"titre\" field. Filter keys must be field names"]}"""
        assertEquals(Presence.ABSENT, Installation.presence(400, incomplet))
        assertEquals(Presence.ABSENT, Installation.presence(400, incomplet.replace("\\", "").replace("appel", "textMessage")))
        assertEquals(Presence.INCONNU, Installation.presence(400, incomplet.replace("Object appel", "Object person")))
        val sonde = java.net.URLDecoder.decode(Installation.cheminSonde("appels"), "UTF-8")
        for (champ in Contrat.CHAMPS.getValue("appels") + "personId") assertTrue(champ, "$champ[is]:NULL" in sonde)
        assertTrue("depth=0" in sonde && "limit=1" in sonde)
        assertEquals(Presence.ABSENT, Installation.ensemble(listOf(Presence.PRESENT, Presence.ABSENT)))
        assertEquals(Presence.INCONNU, Installation.ensemble(listOf(Presence.PRESENT, Presence.INCONNU)))
        assertEquals(Presence.PRESENT, Installation.ensemble(listOf(Presence.PRESENT, Presence.PRESENT)))
        assertEquals(Presence.INCONNU, Installation.ensemble(emptyList()))
    }

    /** Un CRM simulé : présence, réponses à la demande, puis au suivi du travail, dans l'ordre (la dernière se répète). */
    private class Crm(var presence: Presence, vararg reponses: Reponse, suivis: List<Reponse> = listOf(Reponse.EN_COURS), private val oauth: Boolean = true) {
        val file = ArrayDeque(reponses.toList()); val suite = ArrayDeque(suivis)
        var demandes = 0; var nbSuivis = 0
        private fun <T> ArrayDeque<T>.tirer() = if (size > 1) removeFirst() else first()
        val installateur = Installation.Installateur({ presence },
            { demandes++; file.tirer().let { Demande(it, if (it == Reponse.EN_COURS) "travail-$demandes" else null) } },
            { nbSuivis++; assertEquals("travail-$demandes", it); suite.tirer() }, { oauth })
    }

    @Test fun `espace deja pret, rien n est demande, meme a la connexion`() {
        for (forcer in listOf(false, true)) for (r in Reponse.entries) {
            val c = Crm(Presence.PRESENT, r)
            val d = c.installateur.passer(forcer)
            assertEquals(Etat.PRET, d.etat); assertFalse(d.retient); assertEquals(0, c.demandes); assertEquals(0, c.nbSuivis)
        }
    }

    @Test fun `espace neuf, la file est retenue jusqu a ce que les objets existent`() {
        val c = Crm(Presence.ABSENT, Reponse.EN_COURS, suivis = listOf(Reponse.EN_COURS, Reponse.INSTALLEE))
        var d = c.installateur.passer(forcer = true)
        assertEquals(Etat.INSTALLATION, d.etat); assertTrue(d.retient); assertEquals(2_000L, d.reessayerMs)
        d = c.installateur.passer(); assertTrue(d.retient); assertEquals(3_000L, d.reessayerMs)
        d = c.installateur.passer(); assertTrue("travail fini, les objets ne se lisent pas encore", d.retient)
        assertEquals("une seule demande, le reste est du suivi", 1, c.demandes); assertEquals(2, c.nbSuivis)
        c.presence = Presence.PRESENT
        d = c.installateur.passer()
        assertEquals(Etat.PRET, d.etat); assertFalse(d.retient); assertEquals(null, d.reessayerMs)
    }

    @Test fun `garde de l instance, le refus arrive par le travail`() {
        val c = Crm(Presence.ABSENT, Reponse.EN_COURS, suivis = listOf(Reponse.EN_COURS, Reponse.NON_PROPOSEE))
        assertEquals(Etat.INSTALLATION, c.installateur.passer(forcer = true).etat)
        c.installateur.passer()
        var d = c.installateur.passer()
        assertEquals(Etat.NON_PROPOSE, d.etat); assertTrue(d.retient); assertTrue(d.reessayerMs!! >= 1_800_000)
        repeat(8) { d = c.installateur.passer(); assertEquals(Etat.NON_PROPOSE, d.etat) }
        assertEquals("la demande n'est pas martelée", 1, c.demandes)
        // Veridian l'active ensuite pour cet espace : la sonde suffit.
        c.presence = Presence.PRESENT
        assertEquals(Etat.PRET, c.installateur.passer().etat)
    }

    @Test fun `simple membre, un administrateur active, la sonde le voit`() {
        val c = Crm(Presence.ABSENT, Reponse.INTERDIT)
        var d = c.installateur.passer(forcer = true)
        assertEquals(Etat.REFUSE, d.etat); assertTrue(d.retient); assertEquals(300_000L, d.reessayerMs)
        repeat(11) { c.installateur.passer() }
        assertEquals("une demande par heure au plus", 1, c.demandes)
        c.installateur.passer(); assertEquals(2, c.demandes)
        c.installateur.passer(forcer = true); assertEquals("le bouton redemande", 3, c.demandes)
        c.presence = Presence.PRESENT
        d = c.installateur.passer()
        assertEquals(Etat.PRET, d.etat); assertFalse(d.retient)
        assertTrue("Un administrateur doit activer Téléphonie dans Paramètres > Applications." in Installation.message(Etat.REFUSE, 2))
        assertTrue("pas encore proposé dans votre CRM" in Installation.message(Etat.NON_PROPOSE, 2))
    }

    @Test fun `installation ratee, redemandee de plus en plus tard`() {
        val c = Crm(Presence.ABSENT, Reponse.EN_COURS, suivis = listOf(Reponse.ECHEC))
        val delais = (0..14).map { c.installateur.passer() }.filter { it.etat == Etat.A_RETENTER }.map { it.reessayerMs!! }
        assertTrue(delais.size >= 5); assertEquals(delais.sorted(), delais); assertEquals(3_600_000L, delais.last()); assertTrue(delais.first() >= 60_000)
        assertTrue("redemandée", c.demandes >= 5)
    }

    @Test fun `travail oublie par le CRM, redemande`() {
        val c = Crm(Presence.ABSENT, Reponse.EN_COURS, suivis = listOf(Reponse.A_RETENTER, Reponse.EN_COURS))
        c.installateur.passer(); assertEquals(Etat.A_RETENTER, c.installateur.passer().etat)
        assertEquals(Etat.INSTALLATION, c.installateur.passer().etat); assertEquals(2, c.demandes)
    }

    @Test fun `objets apparus mais installation en cours, on attend la fin, pas indefiniment`() {
        val c = Crm(Presence.ABSENT, Reponse.EN_COURS)
        c.installateur.passer(forcer = true)
        c.presence = Presence.PRESENT
        assertTrue(c.installateur.passer().retient)
        repeat(20) { c.installateur.passer() }
        assertEquals(Etat.PRET, c.installateur.decision.etat)
        val fini = Crm(Presence.ABSENT, Reponse.EN_COURS, suivis = listOf(Reponse.INSTALLEE))
        fini.installateur.passer(forcer = true); fini.presence = Presence.PRESENT
        assertEquals(Etat.PRET, fini.installateur.passer().etat)
    }

    @Test fun `reseau coupe pendant l installation, la file reste retenue`() {
        val c = Crm(Presence.ABSENT, Reponse.EN_COURS)
        c.installateur.passer(forcer = true)
        c.presence = Presence.INCONNU
        val d = c.installateur.passer()
        assertTrue(d.retient); assertEquals(Etat.INSTALLATION, d.etat); assertTrue(d.reessayerMs!! >= 30_000)
        // Réseau coupé sans avoir jamais vu d'absence : rien n'est retenu (l'envoi échoue et garde tout, comme avant).
        assertFalse(Crm(Presence.INCONNU, Reponse.INSTALLEE).installateur.passer(forcer = true).retient)
    }

    @Test fun `app inconnue de ce CRM ou cle API, comportement d avant`() {
        for (c in listOf(Crm(Presence.ABSENT, Reponse.NON_SERVIE), Crm(Presence.ABSENT, Reponse.EN_COURS, oauth = false))) {
            val d = c.installateur.passer(forcer = true)
            assertEquals(Etat.NON_GERE, d.etat); assertFalse(d.retient)
        }
        val cle = Crm(Presence.ABSENT, Reponse.EN_COURS, oauth = false)
        cle.installateur.passer(forcer = true); assertEquals("une clé ne demande rien", 0, cle.demandes)
        // L'app arrive ensuite sur l'instance : le passage suivant la trouve.
        val ensuite = Crm(Presence.ABSENT, Reponse.NON_SERVIE, Reponse.EN_COURS)
        ensuite.installateur.passer(); assertEquals(Etat.INSTALLATION, ensuite.installateur.passer().etat)
    }

    @Test fun `panne du CRM, de plus en plus espace`() {
        val pannes = Crm(Presence.ABSENT, Reponse.A_RETENTER)
        val delais = (0..8).map { pannes.installateur.passer().reessayerMs!! }
        assertEquals(30_000L, delais.first()); assertEquals(600_000L, delais.last()); assertEquals(delais.sorted(), delais)
        assertTrue(pannes.installateur.decision.retient)
    }

    @Test fun `plugin retire apres coup, retenu de nouveau puis reinstalle`() {
        val c = Crm(Presence.PRESENT, Reponse.EN_COURS, suivis = listOf(Reponse.INSTALLEE))
        c.installateur.passer()
        c.presence = Presence.ABSENT
        assertTrue(c.installateur.passer().retient)
        c.presence = Presence.PRESENT
        assertFalse(c.installateur.passer().retient)
    }

    @Test fun `installee mais illisible, la demande n est pas martelee`() {
        val c = Crm(Presence.ABSENT, Reponse.EN_COURS, suivis = listOf(Reponse.INSTALLEE))
        repeat(24) { c.installateur.passer() }
        assertTrue("${c.demandes} demandes pour 24 passages", c.demandes in 2..7)
    }

    @Test fun `messages simples, la file y est comptee`() {
        for (e in Etat.entries) if (e != Etat.PRET && e != Etat.INCONNU) {
            assertTrue("$e", "rien n'est perdu" in Installation.message(e, 3).lowercase())
            assertTrue("$e", "3 appels et SMS" in Installation.message(e, 3))
            assertTrue("$e", "1 appel ou SMS attend" in Installation.message(e, 1))
            assertFalse("pas de jargon", Regex("HTTP|OAuth|plugin|API|\\b4\\d\\d\\b").containsMatchIn(Installation.message(e, 0)))
        }
        assertEquals("", Installation.message(Etat.PRET, 3))
    }

    // ------------------------------------------------------------ rien ne se perd dans la file

    @Test fun `une fiche creee apres des refus est toujours reverifiee, sinon son audio ne part jamais`() {
        for (essais in 0..50) assertEquals("essais $essais", Suite.REVERIFIE_A_NEUF, Suite.de(true, true, false, false, essais))
    }

    @Test fun `la file rejouee de bout en bout garde l audio apres n refus`() {
        for (refus in listOf(0, 2, 3, 4, 40)) {
            var essais = refus; var fiche = false; var audio = false; var televersement = false; var enFile = true
            repeat(10) {
                if (!enFile) return@repeat
                val cree = !fiche
                val fichiers = fiche && !audio
                if (cree) fiche = true
                if (fichiers) televersement = true
                when (Suite.de(cree || fichiers, cree, false, televersement && !audio, essais)) {
                    Suite.TERMINE, Suite.LAISSE -> enFile = false
                    Suite.ATTEND_FICHIER -> { audio = true; televersement = false }  // le fil des fichiers le porte
                    Suite.REVERIFIE_A_NEUF -> essais = 0
                    Suite.REVERIFIE -> essais++
                }
            }
            assertTrue("après $refus refus, l'enregistrement est porté", audio); assertFalse(enFile)
        }
    }

    @Test fun `un complement qui ne prend pas ne boucle pas`() {
        assertEquals(Suite.REVERIFIE, Suite.de(true, false, true, false, 2))
        assertEquals(Suite.LAISSE, Suite.de(true, false, true, false, 3))
        assertEquals(Suite.ATTEND_FICHIER, Suite.de(true, false, true, true, 9))
        assertEquals(Suite.TERMINE, Suite.de(false, false, false, false, 9))
    }

    // ------------------------------------------------------------ adresse tapée par un client

    @Test fun `adresse du CRM`() {
        assertEquals("https://mon-entreprise.crm.app.veridian.site", Adresse.normaliser(" Mon-Entreprise "))
        assertEquals("https://monespace.twenty.com", Adresse.normaliser("monespace.twenty.com"))
        assertEquals("https://monespace.twenty.com", Adresse.normaliser("https://monespace.twenty.com/objects/people?x=1"))
        assertEquals("https://x.crm.app.veridian.site", Adresse.normaliser("x.crm.app.veridian.site/"))
        assertEquals("http://localhost:3000", Adresse.normaliser("http://localhost:3000/"))
        assertEquals("http://10.0.2.2:3000", Adresse.normaliser("http://10.0.2.2:3000"))
    }

    @Test fun `une version qui n'a jamais noté l'adresse du CRM n'est pas sur un autre CRM`() {
        val url = "https://veridian-4.crm.app.veridian.site"
        assertFalse("14/11 : rien n'était noté, rien ne s'oublie", Adresse.autreCrm(null, url))
        assertFalse(Adresse.autreCrm(url, url))
        assertFalse(Adresse.autreCrm("$url/", url))
        assertFalse(Adresse.autreCrm(url.uppercase(), url))
        assertTrue(Adresse.autreCrm("https://essai.crm.app.veridian.site", url))
        assertTrue(Adresse.autreCrm("http://10.0.2.2:3000", url))
    }
}
