package site.veridian.telephonie.contrat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import site.veridian.telephonie.contrat.Installation.Etat
import site.veridian.telephonie.contrat.Installation.Presence
import site.veridian.telephonie.contrat.Installation.Reponse

class InstallationTest {
    // Corps relevés sur le staging le 24/11/2026 (espace jetable, jeton OAuth du membre).
    private val absent = """{"statusCode":400,"error":"BadRequestException","messages":["object 'appels' not found. eg: companies"]}"""
    private val introuvable = """{"message":"Cannot POST /api/veridian/apps/telephonie/assurer","error":"Not Found","statusCode":404}"""

    @Test fun `la route du contrat`() = assertEquals("/api/veridian/apps/telephonie/assurer", Installation.CHEMIN)

    @Test fun `reponses de la route`() {
        for (e in listOf("installee", "mise_a_jour", "deja_installee"))
            assertEquals(Reponse.INSTALLEE, Installation.lire(200, """{"app":"telephonie","etat":"$e","version":"0.3.0"}"""))
        assertEquals(Reponse.EN_COURS, Installation.lire(200, """{"app":"telephonie","etat" : "en_cours","version":null}"""))
        assertEquals(Reponse.INSTALLEE, Installation.lire(201, """{"etat":"installee"}"""))  // POST Nest sans @HttpCode : 201
        assertEquals(Reponse.NON_MAISON, Installation.lire(403, """{"error":"app_non_maison"}"""))
        assertEquals(Reponse.INTERDIT, Installation.lire(403, """{"message":"Forbidden resource"}"""))
        assertEquals(Reponse.INTERDIT, Installation.lire(401, "{}"))
        assertEquals(Reponse.NON_SERVIE, Installation.lire(404, introuvable))
        for (c in listOf(429, 500, 502, 503)) assertEquals(Reponse.A_RETENTER, Installation.lire(c, ""))
        // 200 illisible (page du front servie à la place de l'API) : jamais pris pour une installation.
        assertEquals(Reponse.A_RETENTER, Installation.lire(200, "<!doctype html>"))
        assertEquals(Reponse.A_RETENTER, Installation.lire(200, """{"etat":"echec"}"""))
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

    /** Un CRM simulé : présence et réponses de la route, dans l'ordre. */
    private class Crm(var presence: Presence, vararg reponses: Reponse, private val oauth: Boolean = true) {
        val file = ArrayDeque(reponses.toList())
        var appels = 0
        val installateur = Installation.Installateur({ presence }, { appels++; if (file.size > 1) file.removeFirst() else file.first() }, { oauth })
    }

    @Test fun `espace deja pret, rien n est demande`() {
        val c = Crm(Presence.PRESENT, Reponse.INSTALLEE)
        val d = c.installateur.passer()
        assertEquals(Etat.PRET, d.etat); assertFalse(d.retient); assertEquals(0, c.appels)
    }

    @Test fun `a la connexion la route est appelee meme si les objets sont la`() {
        val c = Crm(Presence.PRESENT, Reponse.INSTALLEE)
        assertEquals(Etat.PRET, c.installateur.passer(forcer = true).etat); assertEquals(1, c.appels)
        // Une réponse défavorable ne casse pas un espace qui marche.
        for (r in Reponse.entries) {
            val d = Crm(Presence.PRESENT, r).installateur.passer(forcer = true)
            assertEquals("$r", Etat.PRET, d.etat); assertFalse(d.retient)
        }
    }

    @Test fun `espace neuf, la file est retenue jusqu a ce que les objets existent`() {
        val c = Crm(Presence.ABSENT, Reponse.EN_COURS, Reponse.EN_COURS, Reponse.INSTALLEE)
        var d = c.installateur.passer(forcer = true)
        assertEquals(Etat.INSTALLATION, d.etat); assertTrue(d.retient); assertEquals(2_000L, d.reessayerMs)
        d = c.installateur.passer(); assertTrue(d.retient); assertEquals(3_000L, d.reessayerMs)
        d = c.installateur.passer(); assertTrue("la route dit installée, les objets ne se lisent pas encore", d.retient)
        c.presence = Presence.PRESENT
        d = c.installateur.passer()
        assertEquals(Etat.PRET, d.etat); assertFalse(d.retient); assertEquals(null, d.reessayerMs)
    }

    @Test fun `objets apparus mais installation en cours, on attend la fin, pas indefiniment`() {
        val c = Crm(Presence.ABSENT, Reponse.EN_COURS)
        c.installateur.passer(forcer = true)
        c.presence = Presence.PRESENT
        assertTrue(c.installateur.passer().retient)
        repeat(20) { c.installateur.passer() }
        assertEquals(Etat.PRET, c.installateur.decision.etat)
        val fini = Crm(Presence.ABSENT, Reponse.EN_COURS, Reponse.INSTALLEE)
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

    @Test fun `route pas encore servie ou cle API, comportement d avant`() {
        for (c in listOf(Crm(Presence.ABSENT, Reponse.NON_SERVIE), Crm(Presence.ABSENT, Reponse.INSTALLEE, oauth = false))) {
            val d = c.installateur.passer(forcer = true)
            assertEquals(Etat.NON_GERE, d.etat); assertFalse(d.retient)
        }
        val cle = Crm(Presence.PRESENT, Reponse.INSTALLEE, oauth = false)
        assertEquals(Etat.PRET, cle.installateur.passer(forcer = true).etat); assertEquals(0, cle.appels)
        // La route arrive ensuite : le passage suivant la trouve.
        val ensuite = Crm(Presence.ABSENT, Reponse.NON_SERVIE, Reponse.INSTALLEE)
        ensuite.installateur.passer(); assertEquals(Etat.INSTALLATION, ensuite.installateur.passer().etat)
    }

    @Test fun `app non maison et refus retiennent sans marteler`() {
        val non = Crm(Presence.ABSENT, Reponse.NON_MAISON).installateur.passer(forcer = true)
        assertEquals(Etat.NON_PROPOSE, non.etat); assertTrue(non.retient); assertTrue(non.reessayerMs!! >= 3_600_000)
        val ref = Crm(Presence.ABSENT, Reponse.INTERDIT).installateur.passer(forcer = true)
        assertEquals(Etat.REFUSE, ref.etat); assertTrue(ref.retient); assertTrue(ref.reessayerMs!! >= 600_000)
        val pannes = Crm(Presence.ABSENT, Reponse.A_RETENTER)
        val delais = (0..8).map { pannes.installateur.passer().reessayerMs!! }
        assertEquals(30_000L, delais.first()); assertEquals(600_000L, delais.last()); assertEquals(delais.sorted(), delais)
    }

    @Test fun `plugin retire apres coup, retenu de nouveau puis reinstalle`() {
        val c = Crm(Presence.PRESENT, Reponse.INSTALLEE)
        c.installateur.passer()
        c.presence = Presence.ABSENT
        assertTrue(c.installateur.passer().retient)
        c.presence = Presence.PRESENT
        assertFalse(c.installateur.passer().retient)
    }

    @Test fun `installee mais illisible, la route n est pas martelee`() {
        val c = Crm(Presence.ABSENT, Reponse.INSTALLEE)
        repeat(12) { c.installateur.passer() }
        assertTrue("${c.appels} appels pour 12 passages", c.appels in 2..4)
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
}
