package site.veridian.telephonie

import android.content.Context
import android.net.Uri
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.Telephony
import site.veridian.telephonie.contrat.Contrat
import site.veridian.telephonie.contrat.Enregistrement
import java.io.File

/**
 * Lecture du téléphone par le ContentResolver, directement (plus de Termux:API, qui se figeait 120 s) et de façon
 * incrémentale : seules les lignes dont la date dépasse `depuisMs` sont lues. Même forme que les lectures de
 * `telephone.py` (appels_locaux, sms_locaux, mms_locaux, messages_vocaux_locaux), passée par les mêmes fonctions
 * du contrat ; la date est celle du fournisseur, à la milliseconde, comme l'ingestion de `mail`.
 */
class Sources(private val ctx: Context, private val reglages: Reglages, private val adb: Adb) {
    private val cr = ctx.contentResolver
    private val etat = ctx.filesDir
    val appareil get() = reglages.appareil

    fun appels(depuisMs: Long, jusquaMs: Long = Long.MAX_VALUE): List<Enregistrement> {
        val liste = mutableListOf<Enregistrement>()
        cr.query(CallLog.Calls.CONTENT_URI, arrayOf(CallLog.Calls.DATE, CallLog.Calls.NUMBER, CallLog.Calls.DURATION,
            CallLog.Calls.TYPE, CallLog.Calls.CACHED_NAME), "${CallLog.Calls.DATE} >= ? AND ${CallLog.Calls.DATE} <= ?",
            arrayOf(depuisMs.toString(), jusquaMs.toString()), "${CallLog.Calls.DATE} ASC")?.use { c ->
            while (c.moveToNext()) {
                liste += Contrat.appel(c.getLong(0), c.getString(1), c.getInt(2), c.getInt(3).toString(), c.getString(4), appareil)
            }
        }
        return liste
    }

    /** Nom du contact pour un SMS reçu, « You » (donc rien) pour un envoyé : ce que rendait `termux-sms-list`. */
    private val noms = HashMap<String, String?>()

    private fun nomContact(numero: String?): String? {
        if (numero.isNullOrEmpty()) return null
        return noms.getOrPut(numero) {
            try {
                cr.query(Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(numero)),
                    arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null }
            } catch (_: Exception) { null }
        }
    }

    fun sms(depuisMs: Long): List<Enregistrement> {
        noms.clear()
        val liste = mutableListOf<Enregistrement>()
        cr.query(Telephony.Sms.CONTENT_URI, arrayOf(Telephony.Sms.DATE, Telephony.Sms.ADDRESS, Telephony.Sms.TYPE, Telephony.Sms.BODY),
            "${Telephony.Sms.DATE} >= ?", arrayOf(depuisMs.toString()), "${Telephony.Sms.DATE} ASC")?.use { c ->
            while (c.moveToNext()) {
                val type = c.getInt(2)
                val contact = nomContact(c.getString(1))
                val nom = if (contact == null || type != Telephony.Sms.MESSAGE_TYPE_INBOX) "" else contact
                liste += Contrat.message(c.getLong(0), c.getString(1), type.toString(), c.getString(3), nom, appareil)
            }
        }
        return liste
    }

    fun mms(depuisMs: Long): List<Enregistrement> {
        val liste = mutableListOf<Enregistrement>()
        // date des MMS en secondes
        cr.query(Telephony.Mms.CONTENT_URI, arrayOf(Telephony.Mms._ID, Telephony.Mms.DATE, Telephony.Mms.MESSAGE_BOX),
            "${Telephony.Mms.DATE} >= ?", arrayOf((depuisMs / 1000).toString()), "${Telephony.Mms.DATE} ASC")?.use { c ->
            while (c.moveToNext()) {
                try {
                    liste += unMms(c.getLong(0), c.getLong(1), c.getInt(2).toString())
                } catch (e: Exception) {
                    Journal.erreur("MMS ${c.getLong(0)} non lu", e)
                }
            }
        }
        return liste
    }

    private fun unMms(id: Long, date: Long, boite: String): Enregistrement {
        val sens = if (boite == "1") "RECU" else "ENVOYE"
        val voulu = if (sens == "RECU") "137" else "151"
        val adresses = mutableListOf<String>()
        cr.query(Uri.parse("content://mms/$id/addr"), arrayOf("address", "type"), null, null, null)?.use { c ->
            while (c.moveToNext()) if (c.getString(1) == voulu) c.getString(0)?.let { adresses += it }
        }
        val textes = mutableListOf<String>()
        val fichiers = mutableListOf<String>()
        val types = mutableListOf<String>()
        cr.query(Uri.parse("content://mms/part"), arrayOf("_id", "ct", "name", "text"), "mid=?", arrayOf(id.toString()), null)?.use { c ->
            while (c.moveToNext()) {
                val partie = c.getLong(0)
                val ct = c.getString(1) ?: ""
                val nom = c.getString(2)
                if (ct == "application/smil") continue
                // `content query` puis `split("text=")[1].rstrip("\n")` côté Python : mêmes retours à la ligne finaux retirés
                if (ct == "text/plain") { c.getString(3)?.let { textes += it.trimEnd('\n') }; continue }
                val extension = if (nom != null && "." in nom) nom.substringAfterLast('.') else ct.substringAfterLast('/')
                val chemin = File(etat, "mms/mms$id-piece$partie.$extension")
                if (!chemin.exists()) {
                    chemin.parentFile!!.mkdirs()
                    val provisoire = File(chemin.path + ".part")
                    cr.openInputStream(Uri.parse("content://mms/part/$partie"))!!.use { e -> provisoire.outputStream().use { e.copyTo(it) } }
                    provisoire.renameTo(chemin)
                }
                fichiers += chemin.path
                types += ct
            }
        }
        var texte = textes.filter { it.isNotEmpty() }.joinToString("\n")
        if (types.isNotEmpty()) texte = (if (texte.isNotEmpty()) texte + "\n" else "") +
            "[${types.size} pièce(s) jointe(s) : ${types.toSortedSet().joinToString(", ")}]"
        val numero = adresses.firstOrNull { Contrat.normaliserNumero(it) != null } ?: adresses.firstOrNull()
        val message = Contrat.message(date * 1000, numero, null, texte, "", appareil, canal = "MMS", sens = sens)
        if (fichiers.isNotEmpty()) message["_fichiers"] = mapOf("piecesJointes" to fichiers.take(Contrat.MAX_PIECES_JOINTES))
        return message
    }

    /** Enregistrements JemRec : (début, direction, chemin, transcription faite ici). */
    fun enregistrements(transcriptions: Transcriptions): List<Contrat.EnregistrementAudio> =
        (reglages.jemrec.listFiles { f -> f.name.endsWith(".ogg") } ?: emptyArray()).sortedBy { it.name }.mapNotNull { f ->
            Contrat.lireNomJemrec(f.nameWithoutExtension)?.let { (debut, direction) ->
                Contrat.EnregistrementAudio(debut, direction, f.path, transcriptions.texte(f))
            }
        }

    // ------------------------------------------------------------ messagerie vocale, par le shell (adb)

    private var adbEssaiLe = 0L

    /** Dernier message vocal (_id, has_content) : la sonde, une machine Java côté shell. Null si adb est absent. */
    fun sondeMessagerie(): String? {
        if (!adbPermis()) return null
        return try {
            adb.texte("content query --uri $MESSAGERIE --projection _id:has_content --sort '_id DESC LIMIT 1'", 30_000).trim()
        } catch (e: Exception) { adbEchec(e); null }
    }

    private fun adbPermis(): Boolean {
        val attente = when {
            adb.etat.startsWith("clé") -> 600_000
            adb.etat.contains("pas de Wi-Fi") -> 300_000  // le retour du Wi-Fi relance tout de suite (reessayerAdb)
            else -> 60_000
        }
        return adb.etat.startsWith("connecté") || System.currentTimeMillis() - adbEssaiLe > attente
    }

    fun reessayerAdb() { adbEssaiLe = 0 }

    private fun adbEchec(e: Exception) {
        adbEssaiLe = System.currentTimeMillis()
        Journal.log("messagerie : adb indisponible (${adb.etat}) : ${e.message}")
    }

    /** Messages vocaux en appels de direction MESSAGERIE, l'audio copié une fois ; null si adb est absent. */
    fun vocaux(transcriptions: Transcriptions): List<Pair<Enregistrement, File?>>? {
        if (!adbPermis()) return null
        val cles = listOf("_id", "number", "date", "duration", "has_content", "mime_type", "transcription")
        val liste = try {
            Contrat.parserContentQuery(adb.texte("content query --uri $MESSAGERIE --projection ${cles.joinToString(":")}", 60_000), cles)
        } catch (e: Exception) { adbEchec(e); return null }
        return liste.map { v ->
            val extension = (v["mime_type"] ?: "audio/amr").substringAfterLast('/').replace("x-", "").ifEmpty { "amr" }
            val audio = File(etat, "messagerie/${Contrat.nomVocal(v["date"]!!.toLong())}.$extension")
            if (v["has_content"] == "1" && !audio.exists()) {
                try {
                    val octets = adb.executer("content read --uri $MESSAGERIE/${v["_id"]!!.toLong()}", 120_000)
                    audio.parentFile!!.mkdirs()
                    File(audio.path + ".part").apply { writeBytes(octets); renameTo(audio) }
                } catch (e: Exception) { Journal.erreur("audio du message vocal ${v["_id"]} non lu", e) }
            }
            val google = Contrat.pyStrip(v["transcription"] ?: "")
            val (texte, source, moteur) = if (google.isNotEmpty()) Triple(google, "GOOGLE", "google-messagerie")
            else Triple(transcriptions.texte(audio), transcriptions.source(audio), transcriptions.moteur(audio))
            val appel = Contrat.messageVocal(v["date"]!!.toLong(), v["number"], Contrat.pyStr(v["duration"] ?: "0").let {
                if (it == "None" || it.isEmpty()) 0 else it.toInt() }, appareil, texte, source, moteur)
            if (audio.exists()) appel["_fichiers"] = mapOf("enregistrement" to listOf(audio.path))
            transcriptions.remplacements(audio)?.let { appel["_remplace"] = it }
            appel to (if (audio.exists() && google.isEmpty()) audio else null)
        }
    }

    companion object {
        const val MESSAGERIE = "content://com.android.voicemail/voicemail"
    }
}
