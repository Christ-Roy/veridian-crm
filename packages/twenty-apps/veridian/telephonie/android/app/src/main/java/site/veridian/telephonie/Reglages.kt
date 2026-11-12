package site.veridian.telephonie

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Réglages de l'app, dans ses préférences privées. Les valeurs par défaut sont celles de `telephone.py`
 * (REGLAGES_DEFAUT), mesurées le 12/11/2026 ; `reglages.json` déposé par la commande `configurer` les remplace
 * clé par clé. L'accès au CRM (url, clé du rôle Téléphone) arrive de la même façon et n'est jamais journalisé.
 */
class Reglages(ctx: Context) {
    private val prefs = ctx.getSharedPreferences("reglages", Context.MODE_PRIVATE)
    val dossierExterne: File = ctx.getExternalFilesDir(null) ?: File(ctx.filesDir, "externe")

    /** « miroir » : tout est lu et planifié, rien n'est écrit au CRM (plan journalisé dans miroir.jsonl). */
    var mode: String
        get() = prefs.getString("mode", "miroir")!!
        set(v) { prefs.edit().putString("mode", v).commit() }
    val miroir get() = mode != "ecriture"

    val url: String? get() = prefs.getString("url", null)
    /** Clé du rôle « Téléphone », chiffrée par une clé AES du Keystore Android (non exportable) ; jamais journalisée. */
    val cle: String? get() = prefs.getString("cle_chiffree", null)?.let { Coffre.dechiffrer(it) }

    fun nombre(cle: String): Double = prefs.getString("r.$cle", null)?.toDoubleOrNull() ?: DEFAUT.getValue(cle)
    fun texte(cle: String): String = prefs.getString("r.$cle", null) ?: DEFAUT_TEXTE.getValue(cle)

    val tronconS get() = nombre("troncon_s")
    val chevauchementS get() = nombre("chevauchement_s")
    val batterieMinPct get() = nombre("batterie_min_pct").toInt()
    val memoireMinKo get() = nombre("memoire_min_ko").toLong()
    val fils get() = nombre("fils").toInt()
    val ameliorerAnciennes get() = nombre("ameliorer_anciennes") != 0.0
    /** Après ce nombre d'échecs de suite sur réseau facturé, un fichier attend le Wi-Fi ; 0 = n'importe quel réseau
     *  (Robert, 12/11/2026 : « j'ai illimité »). Le backoff de 30 s à 30 min, sans limite, s'applique toujours. */
    val echecsAvantWifi get() = nombre("audio_wifi_apres_echecs").toInt()
    val appareil get() = texte("appareil")
    val jemrec get() = File(texte("jemrec"))

    /** Modèle Parakeet : chemin des réglages, sinon le dossier de l'app (poussé par adb, il n'entre pas dans l'APK). */
    val modele: File get() = File(texte("modele").ifEmpty { File(dossierExterne, "modeles/ggml-parakeet-tdt-0.6b-v3-q8_0.bin").path })

    /** Lit `acces.json` et `reglages.json` déposés dans le dossier externe de l'app, puis les efface. */
    fun importer(): String {
        val faits = mutableListOf<String>()
        val acces = File(dossierExterne, "acces.json")
        if (acces.exists()) {
            val j = JSONObject(acces.readText())
            prefs.edit().putString("url", j.getString("url").trimEnd('/')).putString("cle_chiffree", Coffre.chiffrer(j.getString("cle")))
                .remove("cle").commit()
            acces.delete()
            faits += "accès"
        }
        val regl = File(dossierExterne, "reglages.json")
        if (regl.exists()) {
            val j = JSONObject(regl.readText())
            val edit = prefs.edit()
            for (k in j.keys()) {
                if (k == "mode") edit.putString("mode", j.getString(k)) else edit.putString("r.$k", j.get(k).toString())
            }
            edit.commit()
            regl.delete()
            faits += "réglages (${j.length()})"
        }
        return faits.joinToString(", ").ifEmpty { "rien à importer" }
    }

    fun resume(): JSONObject = JSONObject().put("mode", mode).put("crm", url != null && cle != null)
        .put("cle_sha256_12", cle?.let { site.veridian.telephonie.contrat.Contrat.sha256(it).take(12) })
        .put("modele", modele.path).put("modele_present", modele.exists()).put("troncon_s", tronconS)
        .put("chevauchement_s", chevauchementS).put("batterie_min_pct", batterieMinPct).put("fils", fils)
        .put("audio_wifi_apres_echecs", echecsAvantWifi)

    companion object {
        val DEFAUT = mapOf("troncon_s" to 30.0, "chevauchement_s" to 0.0, "batterie_min_pct" to 30.0,
            "memoire_min_ko" to 1_500_000.0, "fils" to 4.0, "ameliorer_anciennes" to 1.0,
            "audio_wifi_apres_echecs" to 0.0)
        val DEFAUT_TEXTE = mapOf("appareil" to "PIXEL_8_PRO", "jemrec" to "/sdcard/Recordings/JemRec", "modele" to "")
    }
}

/** JSON ↔ Kotlin : entiers en Long, JSONObject.NULL en null, ordre des clés gardé. */
object Json {
    fun versKotlin(x: Any?): Any? = when (x) {
        null, JSONObject.NULL -> null
        is JSONObject -> x.keys().asSequence().associateWithTo(LinkedHashMap()) { versKotlin(x.get(it)) }
        is JSONArray -> (0 until x.length()).map { versKotlin(x.get(it)) }
        is Int -> x.toLong()
        else -> x
    }

    @Suppress("UNCHECKED_CAST")
    fun objet(texte: String): MutableMap<String, Any?> = versKotlin(JSONObject(texte)) as MutableMap<String, Any?>

    /** Kotlin → JSON, valeurs nulles gardées (JSONObject(Map) les retirerait). */
    fun versJson(x: Any?): Any = when (x) {
        null -> JSONObject.NULL
        is Map<*, *> -> JSONObject().also { o -> x.forEach { (k, v) -> o.put(k.toString(), versJson(v)) } }
        is Collection<*> -> JSONArray().also { a -> x.forEach { a.put(versJson(it)) } }
        is Array<*> -> JSONArray().also { a -> x.forEach { a.put(versJson(it)) } }
        is Pair<*, *> -> JSONArray().put(versJson(x.first)).put(versJson(x.second))
        is File -> x.path
        else -> x
    }

    fun texte(x: Any?): String = versJson(x).toString()

    /** Forme canonique (clés triées) : base des empreintes. */
    fun canonique(x: Any?): String = when (x) {
        null -> "null"
        is Map<*, *> -> x.entries.sortedBy { it.key.toString() }.joinToString(",", "{", "}") {
            JSONObject.quote(it.key.toString()) + ":" + canonique(it.value) }
        is Collection<*> -> x.joinToString(",", "[", "]") { canonique(it) }
        is String -> JSONObject.quote(x)
        is Number -> if (x.toDouble() == Math.floor(x.toDouble())) x.toLong().toString() else x.toString()
        else -> JSONObject.quote(x.toString())
    }
}

/** Chiffrement par une clé AES-GCM du Keystore Android (alias « crm »), créée au premier usage. */
object Coffre {
    private const val ALIAS = "crm"

    private fun cle(): javax.crypto.SecretKey {
        val ks = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? javax.crypto.SecretKey)?.let { return it }
        val g = javax.crypto.KeyGenerator.getInstance(android.security.keystore.KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(android.security.keystore.KeyGenParameterSpec.Builder(ALIAS,
            android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return g.generateKey()
    }

    fun chiffrer(texte: String): String {
        val c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding").apply { init(javax.crypto.Cipher.ENCRYPT_MODE, cle()) }
        val b = java.util.Base64.getEncoder()
        return b.encodeToString(c.iv) + ":" + b.encodeToString(c.doFinal(texte.toByteArray()))
    }

    fun dechiffrer(valeur: String): String? = try {
        val (iv, donnees) = valeur.split(":").map { java.util.Base64.getDecoder().decode(it) }
        val c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(javax.crypto.Cipher.DECRYPT_MODE, cle(), javax.crypto.spec.GCMParameterSpec(128, iv)) }
        String(c.doFinal(donnees))
    } catch (e: Exception) { Journal.erreur("clé du CRM illisible", e); null }
}
