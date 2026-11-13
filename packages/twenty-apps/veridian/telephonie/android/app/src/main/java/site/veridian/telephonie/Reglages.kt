package site.veridian.telephonie

import android.app.Application
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Réglages de l'app, dans ses préférences privées. Les valeurs par défaut sont celles de `telephone.py`
 * (REGLAGES_DEFAUT), mesurées le 12/11/2026 ; `reglages.json` déposé par la commande `configurer` les remplace
 * clé par clé. L'accès au CRM (url, clé du rôle Téléphone) arrive de la même façon et n'est jamais journalisé.
 */
class Reglages(private val ctx: Context) {
    // Le processus de transcription relit le fichier s'il a changé (mode, transcription choisis dans l'app) :
    // sans MODE_MULTI_PROCESS, il garderait la copie lue à son démarrage.
    @Suppress("DEPRECATION")
    private val prefs get() = ctx.getSharedPreferences("reglages",
        if (Application.getProcessName().endsWith(":transcription")) Context.MODE_MULTI_PROCESS else Context.MODE_PRIVATE)
    val dossierExterne: File = ctx.getExternalFilesDir(null) ?: File(ctx.filesDir, "externe")

    init { migrer() }

    /**
     * Schéma 2 (13/11/2026, app installable par un tiers) : les défauts propres à Robert (appareil PIXEL_8_PRO,
     * dossier JemRec, transcription et messagerie actives) disparaissent des défauts. Un téléphone déjà configuré
     * (accès CRM présent) les reçoit ici en valeurs explicites, une fois : sa configuration ne change pas d'un octet,
     * la clé chiffrée n'est pas touchée, le mode reste celui qu'il était (miroir écrit explicitement s'il était au
     * défaut), et `appareil` garde la valeur qui sert au rapprochement avec ce qui est déjà au CRM (aucun doublon).
     */
    private fun migrer() {
        val schema = prefs.getInt("schema", 1)
        if (schema >= SCHEMA) return
        val e = prefs.edit()
        if (prefs.contains("url")) {
            if (!prefs.contains("mode")) e.putString("mode", "miroir")
            if (!prefs.contains("r.appareil")) e.putString("r.appareil", "PIXEL_8_PRO")
            if (!prefs.contains("r.jemrec")) e.putString("r.jemrec", "/sdcard/Recordings/JemRec")
            if (!prefs.contains("r.transcription")) e.putString("r.transcription", "1")
            if (!prefs.contains("r.messagerie")) e.putString("r.messagerie", "1")
            if (!prefs.contains("acces")) e.putString("acces", ACCES_CLE)
        }
        e.putInt("schema", SCHEMA).commit()
    }

    /** « miroir » : tout est lu et planifié, rien n'est écrit au CRM (plan journalisé dans miroir.jsonl). */
    var mode: String
        get() = prefs.getString("mode", "miroir")!!
        set(v) { prefs.edit().putString("mode", v).commit() }
    val miroir get() = mode != "ecriture"

    val url: String? get() = prefs.getString("url", null)
    /** « cle » : clé API (rôle Téléphone) ; « oauth » : connexion par le navigateur (jetons renouvelés). */
    val acces: String get() = prefs.getString("acces", ACCES_CLE)!!
    /** Clé du rôle « Téléphone », chiffrée par une clé AES du Keystore Android (non exportable) ; jamais journalisée. */
    val cle: String? get() = if (acces == ACCES_CLE) prefs.getString("cle_chiffree", null)?.let { Coffre.dechiffrer(it) } else null
    val configure: Boolean get() = url != null && (if (acces == ACCES_OAUTH) prefs.contains("oauth_refresh") else prefs.contains("cle_chiffree"))

    /** Enregistre un accès par clé API ; efface un éventuel accès OAuth. */
    fun enregistrerCle(url: String, cle: String) {
        prefs.edit().putString("url", url.trimEnd('/')).putString("acces", ACCES_CLE).putString("cle_chiffree", Coffre.chiffrer(cle))
            .remove("oauth_client").remove("oauth_refresh").remove("oauth_jeton").remove("oauth_expire").remove("reconnexion").commit()
    }

    /** Enregistre un accès OAuth (client public enregistré dynamiquement, jetons chiffrés). */
    fun enregistrerOAuth(url: String, client: String, jeton: String, expireMs: Long, refresh: String) {
        prefs.edit().putString("url", url.trimEnd('/')).putString("acces", ACCES_OAUTH).putString("oauth_client", client)
            .putString("oauth_jeton", Coffre.chiffrer(jeton)).putLong("oauth_expire", expireMs)
            .putString("oauth_refresh", Coffre.chiffrer(refresh)).remove("cle_chiffree").remove("reconnexion").commit()
    }

    fun jetonsRenouveles(jeton: String, expireMs: Long, refresh: String) {
        prefs.edit().putString("oauth_jeton", Coffre.chiffrer(jeton)).putLong("oauth_expire", expireMs)
            .putString("oauth_refresh", Coffre.chiffrer(refresh)).commit()
    }

    val oauthClient: String? get() = prefs.getString("oauth_client", null)
    val oauthJeton: String? get() = prefs.getString("oauth_jeton", null)?.let { Coffre.dechiffrer(it) }
    val oauthExpire: Long get() = prefs.getLong("oauth_expire", 0)
    val oauthRefresh: String? get() = prefs.getString("oauth_refresh", null)?.let { Coffre.dechiffrer(it) }

    /** Accès refusé par le CRM (jeton révoqué, refresh expiré, clé révoquée) : tout attend en file une reconnexion. */
    var reconnexion: String?
        get() = prefs.getString("reconnexion", null)
        set(v) { prefs.edit().apply { if (v == null) remove("reconnexion") else putString("reconnexion", v) }.commit() }

    fun drapeau(cle: String) = prefs.getString("r.$cle", null) == "1"
    /** Toute bascule d'option est journalisée avec sa source : le 13/11/2026, la transcription s'est retrouvée coupée
     *  sans aucune trace (dix appels non transcrits), impossible de dire quand ni par quoi. */
    fun poserDrapeau(cle: String, actif: Boolean, source: String = "?") {
        val avant = prefs.getString("r.$cle", null)
        prefs.edit().putString("r.$cle", if (actif) "1" else "0").commit()
        if (avant != (if (actif) "1" else "0")) Journal.log("option $cle : ${if (actif) "activée" else "désactivée"} ($source)")
    }
    fun poserTexte(cle: String, valeur: String) { prefs.edit().putString("r.$cle", valeur).commit() }

    /** Transcription Parakeet sur le téléphone : choisie par l'utilisateur et modèle présent. */
    val transcriptionVoulue get() = drapeau("transcription")
    val transcriptionActive get() = transcriptionVoulue && modele.exists()
    /** Messagerie vocale par le shell du téléphone (adb vers lui-même) : fonction avancée, choisie. */
    val messagerieActive get() = drapeau("messagerie")
    /** Événements plus anciens que cette date (ms) ignorés ; 0 = tout l'historique. */
    val historiqueDepuisMs get() = nombre("historique_depuis_ms").toLong()

    fun nombre(cle: String): Double = prefs.getString("r.$cle", null)?.toDoubleOrNull() ?: DEFAUT.getValue(cle)
    fun texte(cle: String): String = prefs.getString("r.$cle", null) ?: DEFAUT_TEXTE.getValue(cle)

    val tronconS get() = nombre("troncon_s")
    val chevauchementS get() = nombre("chevauchement_s")
    /** Reprises « en charge » (anciennes transcriptions) : sur secteur et au-dessus de ce niveau. */
    val batterieMinPct get() = nombre("batterie_min_pct").toInt()
    /** Appel neuf : transcrit dès qu'il arrive, sauf sous ce niveau débranché (il part alors au branchement). */
    val batterieMinNeufPct get() = nombre("batterie_min_neuf_pct").toInt()
    val memoireMinKo get() = nombre("memoire_min_ko").toLong()
    val fils get() = nombre("fils").toInt()
    val ameliorerAnciennes get() = nombre("ameliorer_anciennes") != 0.0
    /** Après ce nombre d'échecs de suite sur réseau facturé, un fichier attend le Wi-Fi ; 0 = n'importe quel réseau
     *  (Robert, 12/11/2026 : « j'ai illimité »). Le backoff de 30 s à 30 min, sans limite, s'applique toujours. */
    val echecsAvantWifi get() = nombre("audio_wifi_apres_echecs").toInt()
    /** Valeur du champ SELECT `appareil` du CRM (options fixes de l'app Twenty) : déduite du modèle réel. */
    val appareil get() = texte("appareil").ifEmpty { appareilDe(android.os.Build.MANUFACTURER, android.os.Build.MODEL) }
    val jemrec get() = File(texte("jemrec"))
    /** JemRec (F-Droid) installé et son dossier lisible : l'enregistrement des appels est proposé, sinon masqué. */
    val jemrecPresent get() = jemrec.isDirectory

    /** Modèle Parakeet : chemin des réglages, sinon le dossier de l'app (poussé par adb, il n'entre pas dans l'APK). */
    val modele: File get() = File(texte("modele").ifEmpty { File(dossierExterne, "modeles/ggml-parakeet-tdt-0.6b-v3-q8_0.bin").path })

    /** Lit `acces.json` et `reglages.json` déposés dans le dossier externe de l'app, puis les efface. */
    fun importer(): String {
        val faits = mutableListOf<String>()
        val acces = File(dossierExterne, "acces.json")
        if (acces.exists()) {
            val j = JSONObject(acces.readText())
            enregistrerCle(j.getString("url"), j.getString("cle"))
            acces.delete()
            faits += "accès"
        }
        val regl = File(dossierExterne, "reglages.json")
        if (regl.exists()) {
            val j = JSONObject(regl.readText())
            val edit = prefs.edit()
            for (k in j.keys()) {
                if (k == "mode") edit.putString("mode", j.getString(k)) else edit.putString("r.$k", j.get(k).toString())
                Journal.log("réglage $k importé (commande configurer)")
            }
            edit.commit()
            regl.delete()
            faits += "réglages (${j.length()})"
        }
        return faits.joinToString(", ").ifEmpty { "rien à importer" }
    }

    fun resume(): JSONObject = JSONObject().put("mode", mode).put("crm", configure).put("acces", acces)
        .put("reconnexion", reconnexion).put("appareil", appareil).put("schema", prefs.getInt("schema", 1))
        .put("transcription", transcriptionVoulue).put("messagerie", messagerieActive).put("jemrec", jemrecPresent)
        .put("historique_depuis_ms", historiqueDepuisMs)
        .put("cle_sha256_12", cle?.let { site.veridian.telephonie.contrat.Contrat.sha256(it).take(12) })
        .put("modele", modele.path).put("modele_present", modele.exists()).put("troncon_s", tronconS)
        .put("chevauchement_s", chevauchementS).put("batterie_min_pct", batterieMinPct).put("batterie_min_neuf_pct", batterieMinNeufPct).put("fils", fils)
        .put("audio_wifi_apres_echecs", echecsAvantWifi)

    companion object {
        const val SCHEMA = 2
        const val ACCES_CLE = "cle"
        const val ACCES_OAUTH = "oauth"
        val DEFAUT = mapOf("troncon_s" to 30.0, "chevauchement_s" to 0.0, "batterie_min_pct" to 30.0, "batterie_min_neuf_pct" to 10.0,
            "memoire_min_ko" to 1_500_000.0, "fils" to 4.0, "ameliorer_anciennes" to 1.0,
            "audio_wifi_apres_echecs" to 0.0, "historique_depuis_ms" to 0.0)
        val DEFAUT_TEXTE = mapOf("appareil" to "", "jemrec" to "/sdcard/Recordings/JemRec", "modele" to "")

        /** Options du SELECT `appareil` (appel.object.ts, text-message.object.ts) : PIXEL_8_PRO, GALAXY_S10E, sinon AUTRE. */
        fun appareilDe(fabricant: String?, modele: String?): String {
            val m = (modele ?: "").lowercase().trim()
            return when {
                m == "pixel 8 pro" -> "PIXEL_8_PRO"
                m.startsWith("sm-g970") -> "GALAXY_S10E"
                else -> "AUTRE"
            }
        }
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
