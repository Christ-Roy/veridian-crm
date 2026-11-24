package site.veridian.telephonie.contrat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import site.veridian.telephonie.contrat.MiseAJour.Action
import site.veridian.telephonie.contrat.MiseAJour.Canal
import site.veridian.telephonie.contrat.MiseAJour.Lecture
import site.veridian.telephonie.contrat.MiseAJour.Paquet
import site.veridian.telephonie.contrat.MiseAJour.Telephone
import java.io.File

class MiseAJourTest {
    private val sha = "a".repeat(64)
    private val json = mapOf<String, Any?>("format" to 1L, "canal" to "stable", "suspendu" to false, "raison" to "",
        "versionCode" to 200L, "versionName" to "20261124.1800-abc", "taille" to 13_000_000L, "sha256" to sha,
        "url" to "https://github.com/Christ-Roy/veridian-crm/releases/download/telephonie-android/telephonie-crm-200.apk",
        "versionMinimale" to 50L, "pourcentage" to 100L, "minSdk" to 31L)
    private val tel = Telephone(versionCode = 100, sdk = 34, tranche = 42, auto = true, nonLimite = true, occupe = null, fichierSha256 = null)

    private fun lire(vararg change: Pair<String, Any?>, canal: Canal = Canal.STABLE) = MiseAJour.lire(json + change, canal)
    private fun action(t: Telephone, vararg change: Pair<String, Any?>) = MiseAJour.decider(lire(*change), t).action
    private val bon get() = (lire() as Lecture.Bon).m

    // ------------------------------------------------------------ manifeste

    @Test fun `manifeste complet`() {
        assertEquals(200L, bon.versionCode); assertEquals(json["url"], bon.url)
        assertEquals("https://github.com/Christ-Roy/veridian-crm/releases/download/telephonie-android/manifeste.json", MiseAJour.adresseManifeste(Canal.STABLE))
        assertEquals("https://github.com/Christ-Roy/veridian-crm/releases/download/telephonie-android-essai/manifeste.json", MiseAJour.adresseManifeste(Canal.ESSAI))
    }

    @Test fun `chaque champ absent ou faux est un refus, jamais une supposition`() {
        for (champ in json.keys - "raison") assertTrue("$champ absent", MiseAJour.lire(json - champ, Canal.STABLE) is Lecture.Refuse)
        for ((champ, valeur) in listOf("format" to 2L, "canal" to "essai", "suspendu" to "false", "versionCode" to 0L, "versionCode" to "200",
            "versionCode" to 3_000_000_000L, "versionName" to " ", "taille" to 0L, "taille" to 300_000_000L, "sha256" to "A".repeat(64),
            "sha256" to "a".repeat(63), "versionMinimale" to 201L, "versionMinimale" to -1L, "pourcentage" to 101L, "pourcentage" to -1L, "minSdk" to 0L))
            assertTrue("$champ=$valeur", lire(champ to valeur) is Lecture.Refuse)
        // Android plafonne le versionCode : au-delà, aucun APK ne peut le porter, même avec une adresse cohérente.
        val trop = 2_100_000_001L
        assertTrue(lire("versionCode" to trop, "url" to MiseAJour.adresseApk(Canal.STABLE, trop)) is Lecture.Refuse)
    }

    @Test fun `l'APK ne vient que de la release du canal suivi, sous son nom versionné`() {
        val b = "https://github.com/Christ-Roy/veridian-crm/releases/download/"
        for (u in listOf("http://github.com/Christ-Roy/veridian-crm/releases/download/telephonie-android/telephonie-crm-200.apk",
            "https://exemple.com/telephonie-crm-200.apk", b + "telephonie-android-essai/telephonie-crm-200.apk",
            b + "telephonie-android/telephonie-crm-201.apk", b + "telephonie-android/telephonie-crm.apk", b + "telephonie-android/../x/telephonie-crm-200.apk"))
            assertTrue(u, lire("url" to u) is Lecture.Refuse)
    }

    @Test fun `le coupe-circuit passe avant tout et se suffit`() {
        val seul = MiseAJour.lire(mapOf("format" to 1L, "canal" to "stable", "suspendu" to true, "raison" to "essai"), Canal.STABLE)
        assertEquals(Lecture.Suspendu("essai"), seul)
        for (t in listOf(tel, tel.copy(fichierSha256 = sha), tel.copy(manuel = true, fichierSha256 = sha), tel.copy(versionCode = 1, fichierSha256 = sha)))
            assertEquals(Action.ATTENDRE, MiseAJour.decider(seul, t).action)
    }

    @Test fun `canal inconnu, stable`() {
        assertEquals(Canal.STABLE, Canal.de(null)); assertEquals(Canal.STABLE, Canal.de("nimporte")); assertEquals(Canal.ESSAI, Canal.de("essai"))
    }

    // ------------------------------------------------------------ décision

    @Test fun `le parcours normal, télécharger puis installer`() {
        assertEquals(Action.TELECHARGER, action(tel))
        assertEquals(Action.INSTALLER, action(tel.copy(fichierSha256 = sha)))
        assertEquals("un autre fichier ne s'installe pas", Action.TELECHARGER, action(tel.copy(fichierSha256 = "b".repeat(64))))
    }

    @Test fun `version égale ou inférieure, rien, même à la main`() {
        for (v in listOf(200L, 201L)) for (manuel in listOf(false, true))
            assertEquals(Action.A_JOUR, action(tel.copy(versionCode = v, manuel = manuel, fichierSha256 = sha)))
        assertEquals(Action.TELECHARGER, action(tel.copy(versionCode = 199)))
    }

    @Test fun `manifeste refusé ou Android trop ancien`() {
        assertEquals(Action.REFUSER, action(tel.copy(fichierSha256 = sha), "sha256" to "x"))
        assertEquals(Action.REFUSER, action(tel.copy(sdk = 30, manuel = true, fichierSha256 = sha)))
        assertEquals(Action.INSTALLER, action(tel.copy(sdk = 31, fichierSha256 = sha)))
    }

    @Test fun `jamais hors d'un réseau non limité, même à la main, sauf fichier déjà là`() {
        assertEquals(Action.ATTENDRE, action(tel.copy(nonLimite = false)))
        assertEquals(Action.ATTENDRE, action(tel.copy(nonLimite = false, manuel = true)))
        assertEquals(Action.INSTALLER, action(tel.copy(nonLimite = false, fichierSha256 = sha)))
    }

    @Test fun `jamais pendant un appel, un enregistrement ou une transcription`() {
        for (f in listOf(null, sha)) for (manuel in listOf(false, true)) for (installee in listOf(100L, 10L)) {
            val d = MiseAJour.decider(lire(), tel.copy(occupe = "un appel est en cours", fichierSha256 = f, manuel = manuel, versionCode = installee))
            assertEquals(Action.ATTENDRE, d.action); assertTrue("appel" in d.raison)
        }
    }

    @Test fun `mise à jour automatique coupée par l'utilisateur`() {
        assertEquals(Action.ATTENDRE, action(tel.copy(auto = false)))
        assertEquals("même sous la version minimale", Action.ATTENDRE, action(tel.copy(auto = false, versionCode = 10)))
        assertEquals(Action.TELECHARGER, action(tel.copy(auto = false, manuel = true)))
    }

    @Test fun `déploiement progressif`() {
        assertEquals(Action.ATTENDRE, action(tel.copy(tranche = 42), "pourcentage" to 42L))
        assertEquals(Action.TELECHARGER, action(tel.copy(tranche = 42), "pourcentage" to 43L))
        assertEquals(Action.ATTENDRE, action(tel.copy(tranche = 0), "pourcentage" to 0L))
        assertEquals(Action.TELECHARGER, action(tel.copy(tranche = 99)))
        assertEquals("un bouton ne double pas la file", Action.ATTENDRE, action(tel.copy(manuel = true), "pourcentage" to 10L))
        // Sous la version minimale, le pourcentage ne retient plus.
        assertEquals(Action.TELECHARGER, action(tel.copy(versionCode = 49), "pourcentage" to 0L))
        assertEquals(Action.ATTENDRE, action(tel.copy(versionCode = 50), "pourcentage" to 0L))
    }

    @Test fun `tranche stable par appareil, répartie, monotone quand le pourcentage monte`() {
        val tranches = (1..5000).map { MiseAJour.tranche("appareil-$it") }
        assertTrue(tranches.all { it in 0..99 }); assertEquals(MiseAJour.tranche("x"), MiseAJour.tranche("x"))
        for (p in listOf(10, 50, 90)) assertTrue("$p %", tranches.count { it < p } in (p * 50 - 200)..(p * 50 + 200))
    }

    @Test fun `échecs répétés, on cesse d'insister, la main peut reprendre`() {
        assertEquals(Action.INSTALLER, action(tel.copy(fichierSha256 = sha, echecs = 2)))
        assertEquals(Action.ATTENDRE, action(tel.copy(fichierSha256 = sha, echecs = 3)))
        assertEquals(Action.ATTENDRE, action(tel.copy(echecs = 3)))
        assertEquals(Action.INSTALLER, action(tel.copy(fichierSha256 = sha, echecs = 3, manuel = true)))
    }

    @Test fun `accord demandé par Android, une notification par jour, pas un harcèlement`() {
        assertEquals(Action.ATTENDRE, action(tel.copy(fichierSha256 = sha, gesteAttendu = true)))
        assertEquals(Action.INSTALLER, action(tel.copy(fichierSha256 = sha, gesteAttendu = true, manuel = true)))
    }

    @Test fun `une seule session à la fois, même à la main`() {
        for (manuel in listOf(false, true)) assertEquals(Action.ATTENDRE, action(tel.copy(fichierSha256 = sha, remise = true, manuel = manuel)))
        assertTrue(MiseAJour.remiseEnCours(1_000_000, 1_000_000)); assertTrue(MiseAJour.remiseEnCours(1_000_000, 1_059_999))
        assertFalse(MiseAJour.remiseEnCours(1_000_000, 1_060_000)); assertFalse("jamais remise", MiseAJour.remiseEnCours(0, NOW))
    }

    @Test fun `autoriser l'installation n'attend pas le lendemain`() {
        assertTrue(MiseAJour.gesteAttendu(NOW - 1, false, false, NOW)); assertTrue(MiseAJour.gesteAttendu(NOW - 1, true, true, NOW))
        assertFalse(MiseAJour.gesteAttendu(NOW - 1, false, true, NOW)); assertFalse(MiseAJour.gesteAttendu(NOW - MiseAJour.JOUR_MS, false, false, NOW))
        assertFalse(MiseAJour.gesteAttendu(0, false, false, NOW))
    }

    // ------------------------------------------------------------ fréquence

    @Test fun `une lecture réussie par jour, une heure après un échec`() {
        val j = MiseAJour.JOUR_MS; val now = 10 * j
        assertTrue(MiseAJour.doitLire(0, 0, now))
        assertFalse(MiseAJour.doitLire(now - j + 1, 0, now)); assertTrue(MiseAJour.doitLire(now - j, 0, now))
        assertFalse(MiseAJour.doitLire(0, now - 3_599_999, now)); assertTrue(MiseAJour.doitLire(0, now - 3_600_000, now))
        assertTrue("horloge reculée", MiseAJour.doitLire(now + 1, now + 1, now))
        // Une journée d'événements à la minute : une seule lecture.
        var lu = 0L; var lectures = 0
        for (m in 0 until 1440) { val t = now + m * 60_000L; if (MiseAJour.doitLire(lu, lu, t)) { lectures++; lu = t } }
        assertEquals(1, lectures)
    }

    @Test fun `installer exige un manifeste frais`() {
        assertTrue(MiseAJour.frais(1_000_000, 1_000_000 + 599_999)); assertFalse(MiseAJour.frais(1_000_000, 1_000_000 + 600_000))
        assertFalse("horloge reculée", MiseAJour.frais(2_000_000, 1_000_000))
    }

    // ------------------------------------------------------------ occupation

    private fun occ(appel: Int? = 0, audio: Int = 0, fin: Long = 0, fichier: Long = 0, trans: Boolean = false, ecrite: Long = 0) =
        MiseAJour.occupation(appel, audio, fin, fichier, trans, ecrite, NOW)

    @Test fun `au repos`() { assertNull(occ()); assertNull("état d'appel illisible, audio normal", occ(appel = null)) }

    @Test fun `appel, sonnerie, visio`() {
        for (e in listOf(1, 2)) assertEquals("un appel est en cours", occ(appel = e))
        for (a in listOf(1, 2, 3, 4)) assertEquals("un appel est en cours", occ(audio = a))
        assertEquals("un appel est en cours", occ(appel = null, audio = 3))
    }

    @Test fun `enregistrement en train de s'écrire`() {
        assertNotNull(occ(fin = NOW - 179_999)); assertNull(occ(fin = NOW - 180_000))
        assertNotNull(occ(fichier = NOW - 59_999)); assertNull(occ(fichier = NOW - 60_000))
    }

    @Test fun `transcription en cours, pas la trace d'un processus tué`() {
        assertNotNull(occ(trans = true, ecrite = NOW - 60_000)); assertNull(occ(trans = false, ecrite = NOW - 60_000))
        assertNotNull(occ(trans = true, ecrite = NOW - 2 * 3_600_000)); assertNull(occ(trans = true, ecrite = NOW - 3 * 3_600_000))
    }

    // ------------------------------------------------------------ vérifications avant installation

    @Test fun `fichier`() {
        assertNull(MiseAJour.verifierFichier(bon, 13_000_000, sha))
        assertNotNull(MiseAJour.verifierFichier(bon, 12_999_999, sha)); assertNotNull(MiseAJour.verifierFichier(bon, 13_000_000, "b".repeat(64)))
    }

    @Test fun `paquet, certificat, version`() {
        val p = "site.veridian.telephonie"
        val installe = Paquet(p, 100, setOf("cert"))
        val apk = Paquet(p, 200, setOf("cert"))
        assertNull(MiseAJour.verifierApk(bon, apk, installe))
        for (mauvais in listOf(null, apk.copy(nom = "site.veridian.autre"), apk.copy(certificats = setOf("autre")), apk.copy(certificats = emptySet()),
            apk.copy(certificats = setOf("cert", "autre")), apk.copy(versionCode = 199), apk.copy(versionCode = 201)))
            assertNotNull("$mauvais", MiseAJour.verifierApk(bon, mauvais, installe))
        assertNotNull("deux certificats illisibles ne sont pas identiques",
            MiseAJour.verifierApk(bon, apk.copy(certificats = emptySet()), installe.copy(certificats = emptySet())))
        for (v in listOf(200L, 201L)) assertNotNull("installée $v", MiseAJour.verifierApk(bon, apk, installe.copy(versionCode = v)))
        val autre = "site.veridian.autre"
        assertNotNull("même nom, mais pas le nôtre", MiseAJour.verifierApk(bon, apk.copy(nom = autre), installe.copy(nom = autre)))
    }

    // ------------------------------------------------------------ la file et la connexion survivent à la mise à jour

    /** Android garde les données privées d'un paquet mis à jour (même nom, même certificat, vérifiés plus haut). Reste ce
     *  que NOTRE code pourrait faire : renommer la base, les réglages ou la clé du coffre, ou vider à la montée. */
    @Test fun `rien dans le code ne renomme ni ne vide ce qui doit survivre`() {
        val app = File("../app/src/main")
        val kt = File(app, "java/site/veridian/telephonie")
        val base = File(kt, "Base.kt").readText()
        assertTrue("SQLiteOpenHelper(ctx, \"telephonie.db\", null, 1)" in base)
        assertTrue("montée de schéma non destructrice", Regex("onUpgrade\\([^)]*\\) \\{\\}").containsMatchIn(base))
        assertTrue("retour arrière : une base plus récente ne fait pas planter", Regex("onDowngrade\\([^)]*\\) \\{\\}").containsMatchIn(base))
        assertFalse("DROP TABLE" in base.uppercase())
        val reglages = File(kt, "Reglages.kt").readText()
        assertTrue("getSharedPreferences(\"reglages\"" in reglages)
        assertTrue("private const val ALIAS = \"crm\"" in reglages)
        val tout = kt.listFiles()!!.filter { it.extension == "kt" }
        for (f in tout) for (interdit in listOf("deleteDatabase", "deleteSharedPreferences", "deleteEntry(", "clearApplicationUserData", ".clear().commit", ".clear().apply"))
            assertFalse("${f.name} : $interdit", interdit in f.readText())
        val manifeste = File(app, "AndroidManifest.xml").readText()
        assertTrue("android.intent.action.MY_PACKAGE_REPLACED" in manifeste)
        for (p in listOf("REQUEST_INSTALL_PACKAGES", "UPDATE_PACKAGES_WITHOUT_USER_ACTION")) assertTrue(p, "android.permission.$p\"" in manifeste)
    }

    /** La lecture publique ne porte rien du téléphone, du client ni du CRM : ni jeton, ni en-tête qui nomme l'appareil. */
    @Test fun `vie privée de la lecture`() {
        val f = File("../app/src/main/java/site/veridian/telephonie/MiseAJourApp.kt").readText()
        assertEquals("un seul endroit ouvre une connexion", 1, Regex("openConnection\\(").findAll(f).count())
        assertTrue("agent fixe : celui d'Android nomme le modèle du téléphone", "setRequestProperty(\"User-Agent\", AGENT)" in f)
        assertTrue("const val AGENT = \"TelephonieCRM\"" in f)
        assertEquals("aucun autre en-tête", 1, Regex("setRequestProperty\\(").findAll(f).count())
        for (interdit in listOf("Authorization", "acces.jeton", "oauth", "reglages.url", "Build.MODEL", "ANDROID_ID", "DownloadManager", "doOutput", "POST", "Cookie"))
            assertFalse(interdit, interdit in f)
        assertTrue("jamais de paramètre dans l'adresse", '?' !in MiseAJour.adresseManifeste(Canal.STABLE) + MiseAJour.adresseApk(Canal.ESSAI, 1))
    }

    private companion object { const val NOW = 1_800_000_000_000L }
}
