package site.veridian.telephonie

import android.content.Context
import android.util.Log
import java.io.File
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * Journal de l'app, sans donnée personnelle (ni numéro, ni texte) : `files/journal.log` (2 Mo, un ancien gardé), et
 * la même ligne, au même moment, dans `/sdcard/Android/data/<paquet>/files/journal.log`, lisible par `adb pull` sans
 * rien demander à l'app (le 13/11/2026, un journal seulement interne laissait la file de transcription invisible).
 * Aussi dans logcat, étiquette `TelephonieCRM`, et ses dernières lignes à l'écran de l'app.
 */
object Journal {
    private const val ETIQUETTE = "TelephonieCRM"
    private val HEURE = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
    private var fichier: File? = null
    private var delais: File? = null
    private var externe: File? = null

    fun init(ctx: Context) {
        fichier = File(ctx.filesDir, "journal.log")
        delais = File(ctx.filesDir, "delais.tsv")
        externe = try { ctx.getExternalFilesDir(null)?.let { File(it, "journal.log") } } catch (_: Exception) { null }
    }

    private fun ajouter(f: File, ligne: String) {
        try {
            if (f.length() > 2_000_000) f.renameTo(File(f.parentFile, "journal.1.log"))
            f.appendText(ligne)
        } catch (_: Exception) {
        }
    }

    /** Les dernières lignes, pour la notification du service : lisibles sans adb (Termux:API, écran), sans donnée personnelle. */
    val dernieres = java.util.ArrayDeque<String>()
    @Volatile var change = 0L

    @Synchronized
    fun log(message: String) {
        dernieres.addLast("${LocalDateTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss"))} ${message.take(160)}")
        while (dernieres.size > 4) dernieres.removeFirst()
        change = System.currentTimeMillis()
        val processus = android.app.Application.getProcessName().substringAfter(':', "principal")
        Log.i(ETIQUETTE, "[$processus] $message")
        val ligne = "[${LocalDateTime.now().format(HEURE)}] [$processus] $message\n"
        fichier?.let { ajouter(it, ligne) }
        externe?.let { ajouter(it, ligne) }
    }

    fun erreur(message: String, e: Throwable) = log("$message : ${e.javaClass.simpleName} ${e.message?.take(300)}")

    /** Délai mesuré entre l'événement et son arrivée au CRM (ou l'envoi qui aurait eu lieu, en miroir). */
    @Synchronized
    fun delai(flux: String, secondes: Double, mode: String) {
        try {
            delais?.appendText("${LocalDateTime.now().format(HEURE)}\t$flux\t${"%.1f".format(java.util.Locale.ROOT, secondes)}\t$mode\n")
        } catch (_: Exception) {
        }
    }
}
