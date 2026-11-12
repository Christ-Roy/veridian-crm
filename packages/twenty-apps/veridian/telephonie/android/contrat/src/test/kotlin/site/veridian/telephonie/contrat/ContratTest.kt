package site.veridian.telephonie.contrat

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64

/**
 * Le port Kotlin rend exactement ce que rend le Python de référence (fixtures générées par
 * `outils/fixtures_contrat.py` depuis `ingestion/crm_telephonie.py` et `ingestion/telephone.py`).
 */
class ContratTest {
    private val f: JSONObject by lazy {
        JSONObject(javaClass.getResourceAsStream("/fixtures.json")!!.readBytes().toString(Charsets.UTF_8))
    }

    /** JSON → Kotlin : entiers en Long, null pour JSONObject.NULL. */
    private fun k(x: Any?): Any? = when (x) {
        null, JSONObject.NULL -> null
        is JSONObject -> x.keys().asSequence().associateWithTo(LinkedHashMap()) { k(x.get(it)) }
        is JSONArray -> (0 until x.length()).map { k(x.get(it)) }
        is Int -> x.toLong()
        is Long -> x
        is java.math.BigInteger -> x.toLong()
        is java.math.BigDecimal -> x.toDouble()
        else -> x
    }

    /** Forme comparable : nombres en Double, paires et tableaux en listes. */
    private fun n(x: Any?): Any? = when (x) {
        is Map<*, *> -> x.entries.associate { (a, b) -> a.toString() to n(b) }
        is Collection<*> -> x.map { n(it) }
        is Pair<*, *> -> listOf(n(x.first), n(x.second))
        is Number -> x.toDouble()
        else -> x
    }

    private fun liste(cle: String) = k(f.getJSONArray(cle)) as List<List<Any?>>

    @Suppress("UNCHECKED_CAST")
    private fun <T> Any?.c() = this as T

    @Test fun normaliserEtCleNumero() {
        for ((brut, attendu) in liste("normaliser")) assertEquals("normaliser($brut)", attendu, Contrat.normaliserNumero(brut))
        for ((brut, attendu) in liste("cle_numero")) assertEquals("cle_numero($brut)", attendu, Contrat.cleNumero(brut))
    }

    @Test fun titresEtApercus() {
        for ((d, s, titre, ancien) in liste("titres")) {
            assertEquals(titre, Contrat.titreAppel(d as String, (s as Long).toInt()))
            assertEquals(ancien, Contrat.titreAncien(d, s.toInt()))
        }
        for ((sens, texte, attendu) in liste("apercu")) assertEquals(attendu, Contrat.apercuMessage(sens as String, texte as String))
        for ((texte, attendu) in liste("empreinte")) assertEquals(attendu, Contrat.empreinte(texte))
        for ((ms, attendu) in liste("iso_utc")) assertEquals(attendu, Contrat.isoUtc(ms as Long))
    }

    @Test fun appelsMessagesVocaux() {
        for (cas in liste("appels")) {
            val (ms, numero, duree, type, nom) = cas
            assertEquals(n(cas[5]), n(Contrat.appel(ms as Long, numero, (duree as Long).toInt(), type, nom as String?, "PIXEL_8_PRO")))
        }
        for (cas in liste("messages")) {
            val r = Contrat.message(cas[0] as Long, cas[1], cas[2], cas[3] as String?, cas[4] as String?, "PIXEL_8_PRO",
                cas[5] as String, cas[6] as String?)
            assertEquals(n(cas[7]), n(r))
        }
        for (cas in liste("vocaux")) {
            val r = Contrat.messageVocal(cas[0] as Long, cas[1], (cas[2] as String).toInt(), "PIXEL_8_PRO", cas[3] as String,
                cas[4] as String?, cas[5] as String?)
            assertEquals(n(cas[6]), n(r))
        }
    }

    @Test fun contentQuery() {
        for ((sortie, cles, attendu) in liste("content_query")) {
            assertEquals(n(attendu), n(Contrat.parserContentQuery(sortie as String, cles.c<List<String>>())))
        }
    }

    @Test fun personnesEtIndex() {
        val p = k(f.getJSONObject("personnes")).c<Map<String, Any?>>()
        val personnes = p["personnes"].c<List<Map<String, Any?>>>()
        assertEquals(p["numeros"], personnes.map { Contrat.numerosPersonne(it).sorted() })
        val (index, ambigus) = Contrat.indexTelephones(personnes)
        assertEquals(p["index"], index)
        assertEquals(p["ambigus"], ambigus.sorted())
    }

    @Test fun associer() {
        val a = k(f.getJSONObject("associer")).c<Map<String, Any?>>()
        val appels = a["appels_avant"].c<List<Map<String, Any?>>>().map { LinkedHashMap(it) as Enregistrement }
        val enregistrements = a["enregistrements"].c<List<List<Any?>>>().map {
            Contrat.EnregistrementAudio(it[0] as Long, it[1] as String, it[2] as String, it[3] as String) }
        val orphelins = Contrat.associerEnregistrements(appels, enregistrements)
        assertEquals(n(a["appels"]), n(appels))
        assertEquals(a["orphelins"], orphelins)
    }

    @Test fun planifier() {
        for (cas in k(f.getJSONArray("planifier")).c<List<Map<String, Any?>>>()) {
            val plan = Contrat.planifier(cas["pluriel"] as String, cas["voulus"].c(), cas["existants"].c(), cas["index"].c())
            assertEquals(n(cas["creations"]), n(plan.creations.map { listOf(it.corps, it.fichiers) }))
            assertEquals(n(cas["complements"]), n(plan.complements.map { listOf(it.id, it.champs, it.fichiers) }))
            assertEquals((cas["sans_personne"] as Long).toInt(), plan.sansPersonne)
        }
    }

    @Test fun nomsEtDates() {
        for ((stem, debut, sens) in liste("jemrec")) assertEquals(debut to sens, Contrat.lireNomJemrec(stem as String))
        assertEquals(null, Contrat.lireNomJemrec("20261112_1116_in"))
        for ((ms, attendu) in liste("nom_vocal")) assertEquals(attendu, Contrat.nomVocal(ms as Long))
        for ((e, attendu) in liste("date_evenement")) assertEquals(n(attendu), Contrat.dateEvenement(e.c())?.let { n(it) })
    }

    @Test fun decoupe() {
        for ((jetons, decalage, aPartirDe, attendu) in liste("lignes")) {
            val j = jetons.c<List<List<Any?>>>().map {
                Decoupe.Jeton((it[0] as Long) / 100.0, (it[1] as Long) / 100.0, it[2] as String, it[3] as Boolean) }
            assertEquals(attendu, Decoupe.lignesDepuisJetons(j, (decalage as Number).toDouble(), aPartirDe = (aPartirDe as Number?)?.toDouble()))
        }
        for ((duree, sil, cible, marge, attendu) in liste("troncons")) {
            val s = sil.c<List<List<Number>>>().map { it[0].toDouble() to it[1].toDouble() }
            assertEquals(n(attendu), n(Decoupe.troncons((duree as Number).toDouble(), s, (cible as Number).toDouble(), (marge as Number).toDouble())))
        }
        for ((troncon, chev, id, recette) in liste("recette")) {
            assertEquals(id, Decoupe.idModele("parakeet", "ggml-parakeet-tdt-0.6b-v3-q8_0.bin"))
            assertEquals(recette, Decoupe.recette(id as String, "parakeet-cli", (troncon as Number).toDouble(), (chev as Number).toDouble()))
        }
    }

    @Test fun silencesCommeFfmpeg() {
        val s = f.getJSONObject("silences")
        val octets = Base64.getDecoder().decode(s.getString("pcm_s16le_base64"))
        val pcm = ShortArray(octets.size / 2)
        ByteBuffer.wrap(octets).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(pcm)
        assertEquals(n(k(s.getJSONArray("silences"))), n(Decoupe.silences(pcm)))
    }
}
