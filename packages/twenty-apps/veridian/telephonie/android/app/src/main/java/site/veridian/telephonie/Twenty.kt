package site.veridian.telephonie

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.net.URLEncoder

/** Le CRM n'a pas répondu (réseau) : ni vrai ni faux, on retentera au retour du réseau. */
class NonAbouti(message: String, cause: Throwable? = null) : Exception(message, cause)

/** Le CRM a refusé (HTTP) : retenté à 30 s, 1, 2, puis 5 min. */
class Refus(message: String) : Exception(message)

/**
 * Client REST et GraphQL de Twenty, comme `crm_telephonie.Twenty` (essais=2 pour le téléphone : hors réseau, il
 * échoue vite au lieu de bloquer). Fichiers : envoi direct `createFileUpload` → PUT en flux → `completeFileUpload`,
 * jamais le multipart GraphQL, plafonné à 5 Mo (mesuré le 11/11/2026).
 */
class Twenty(val url: String, private val acces: Acces?, private val essais: Int = 2, private val cleFixe: String? = null) {
    /** Clé fixe (outils, tests de connexion avant enregistrement), sinon l'accès du téléphone (clé ou OAuth). */
    constructor(url: String, cle: String, essais: Int = 2) : this(url, null, essais, cle)

    private fun jeton(): String = cleFixe ?: acces!!.jeton()

    fun requete(methode: String, chemin: String, corps: Any? = null): JSONObject {
        var derniere: Exception? = null
        var jeton = jeton()
        var renouvele = false
        for (essai in 0 until essais) {
            val cnx = (URL(url + chemin).openConnection() as HttpURLConnection)
            try {
                cnx.requestMethod = methode
                // Réseau mobile qui décroche : une requête pendue ne doit pas retenir l'envoi deux minutes (mesuré
                // le 12/11 en 4G : 121 s pour un appel). Deux essais de 10 + 30 s au plus, puis la file attend.
                cnx.connectTimeout = 10_000
                cnx.readTimeout = 30_000
                cnx.setRequestProperty("Authorization", "Bearer $jeton")
                cnx.setRequestProperty("Content-Type", "application/json")
                if (corps != null) {
                    cnx.doOutput = true
                    cnx.outputStream.use { it.write(Json.texte(corps).toByteArray()) }
                }
                val code = cnx.responseCode
                if (code in 200..299) {
                    val texte = cnx.inputStream.use { it.readBytes() }.toString(Charsets.UTF_8)
                    return if (texte.isBlank()) JSONObject() else JSONObject(texte)
                }
                val texte = (cnx.errorStream?.use { it.readBytes() } ?: ByteArray(0)).toString(Charsets.UTF_8).take(400)
                if (code == 401 && acces != null && cleFixe == null) {
                    // Jeton expiré ou révoqué : un renouvellement, une seule fois ; sinon reconnexion requise (lève).
                    if (renouvele) throw acces.signaler("accès refusé par le CRM (HTTP 401)")
                    renouvele = true; jeton = acces.refuse(); continue
                }
                if (code in setOf(429, 502, 503, 504) && essai + 1 < essais) {
                    Thread.sleep(minOf(60_000L, (1L shl essai) * 3000)); continue
                }
                throw Refus("$methode ${chemin.substringBefore('?')} : HTTP $code $texte")
            } catch (e: IOException) {
                derniere = e
                if (essai + 1 < essais) { Thread.sleep(minOf(60_000L, (1L shl essai) * 3000)); continue }
            } finally {
                cnx.disconnect()
            }
        }
        throw NonAbouti("$methode ${chemin.substringBefore('?')} : ${derniere?.javaClass?.simpleName} ${derniere?.message}", derniere)
    }

    @Suppress("UNCHECKED_CAST")
    fun toutLister(pluriel: String, filtre: String? = null): List<Map<String, Any?>> {
        val tous = mutableListOf<Map<String, Any?>>()
        var curseur: String? = null
        while (true) {
            var chemin = "/rest/$pluriel?limit=200&depth=0"
            if (filtre != null) chemin += "&filter=" + URLEncoder.encode(filtre, "UTF-8").replace("+", "%20")
            if (curseur != null) chemin += "&starting_after=" + URLEncoder.encode(curseur, "UTF-8")
            val r = requete("GET", chemin)
            val donnees = r.getJSONObject("data").getJSONArray(pluriel)
            tous += Json.versKotlin(donnees) as List<Map<String, Any?>>
            val page = r.optJSONObject("pageInfo")
            if (page == null || !page.optBoolean("hasNextPage")) return tous
            curseur = page.getString("endCursor")
        }
    }

    fun creerLot(pluriel: String, lot: List<Map<String, Any?>>): JSONObject = requete("POST", "/rest/batch/$pluriel", lot)

    fun modifier(pluriel: String, id: String, champs: Map<String, Any?>): JSONObject = requete("PATCH", "/rest/$pluriel/$id", champs)

    fun graphql(requete: String, variables: Map<String, Any?>): JSONObject {
        val r = requete("POST", "/metadata", mapOf("query" to requete, "variables" to variables))
        val erreurs = r.optJSONArray("errors")
        if (erreurs != null && erreurs.length() > 0) throw Refus(erreurs.getJSONObject(0).optString("message"))
        return r.getJSONObject("data")
    }

    /** Envoi direct vers un champ FILES : le serveur écrit le flux dans son stockage sans le garder en mémoire. */
    fun televerser(fichier: File, champUid: String, nom: String): String {
        val taille = fichier.length()
        val cible = graphql("mutation(\$nom: String!, \$taille: Float!, \$uid: String!) { createFileUpload(filename: \$nom, " +
            "size: \$taille, fileFolder: FilesField, fieldMetadataUniversalIdentifier: \$uid) { fileId uploadUrl contentType } }",
            mapOf("nom" to nom, "taille" to taille.toDouble(), "uid" to champUid)).getJSONObject("createFileUpload")
        val adresse = cible.getString("uploadUrl").let { if ("://" in it) it else url + it }
        val cnx = URL(adresse).openConnection() as HttpURLConnection
        try {
            cnx.requestMethod = "PUT"
            cnx.doOutput = true
            cnx.setFixedLengthStreamingMode(taille)
            cnx.setRequestProperty("Content-Type", cible.getString("contentType"))
            cnx.connectTimeout = 15_000
            cnx.readTimeout = maxOf(120_000, (taille / 50).toInt())
            cnx.outputStream.use { sortie -> fichier.inputStream().use { it.copyTo(sortie, 256 * 1024) } }
            val code = cnx.responseCode
            if (code !in 200..299) throw Refus("PUT ${fichier.name} : HTTP $code")
        } catch (e: IOException) {
            throw NonAbouti("PUT ${fichier.name} : ${e.message}", e)
        } finally {
            cnx.disconnect()
        }
        graphql("mutation(\$id: String!) { completeFileUpload(fileId: \$id) { id } }", mapOf("id" to cible.getString("fileId")))
        return cible.getString("fileId")
    }

    /** Une connexion TCP au CRM, 3 s au plus : savoir que le réseau est revenu sans rien relire. */
    fun joignable(): Boolean = try {
        val u = URL(url)
        Socket().use { it.connect(InetSocketAddress(u.host, if (u.port > 0) u.port else if (u.protocol == "https") 443 else 80), 3000) }
        true
    } catch (_: IOException) { false }

    companion object {
        fun lotDe(liste: List<Map<String, Any?>>) = JSONArray().also { a -> liste.forEach { a.put(Json.versJson(it)) } }
    }
}
