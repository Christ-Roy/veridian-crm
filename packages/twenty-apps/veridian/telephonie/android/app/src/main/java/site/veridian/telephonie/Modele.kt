package site.veridian.telephonie

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import java.io.File
import java.security.MessageDigest

/**
 * Le modèle de transcription, téléchargé par l'app elle-même au premier usage (il n'entre pas dans l'APK) :
 * Parakeet TDT 0.6B v3 q8_0 au format ggml, dépôt Hugging Face `ggml-org/parakeet-GGUF` (licence MIT), épinglé à une
 * révision. Somme SHA-256 vérifiée le 12/11/2026 identique au fichier du Pixel de Robert (668 757 119 octets).
 * Téléchargement par le DownloadManager d'Android : Wi-Fi seulement, reprise après coupure, notification de progrès.
 * Le fichier n'est utilisé qu'après vérification de sa somme ; une somme fausse l'efface.
 */
object Modele {
    const val NOM = "ggml-parakeet-tdt-0.6b-v3-q8_0.bin"
    const val REVISION = "35156454d1a39de06863303dd209fd2bed6ee079"
    const val URL = "https://huggingface.co/ggml-org/parakeet-GGUF/resolve/$REVISION/$NOM"
    const val SHA256 = "4d64e9e96c2792186d072fde0034df0ad670cf680a2f53069052ead827fd600e"
    const val TAILLE = 668_757_119L

    private fun partiel(ctx: Context) = File(Reglages(ctx).dossierExterne, "modeles/$NOM.telechargement")
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("modele", Context.MODE_PRIVATE)

    fun lancer(ctx: Context): String {
        val r = Reglages(ctx)
        if (r.modele.exists()) return "modèle déjà présent"
        enCours(ctx)?.let { return "téléchargement déjà en cours" }
        val partiel = partiel(ctx).apply { parentFile?.mkdirs(); delete() }
        val dm = ctx.getSystemService(DownloadManager::class.java)
        val id = dm.enqueue(DownloadManager.Request(Uri.parse(URL))
            .setTitle("Modèle de transcription (640 Mo)").setDescription("Téléphonie CRM, Wi-Fi seulement")
            .setAllowedOverMetered(false).setAllowedOverRoaming(false)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationUri(Uri.fromFile(partiel)))
        prefs(ctx).edit().putLong("id", id).commit()
        Journal.log("modèle : téléchargement lancé (Wi-Fi seulement)")
        return "téléchargement lancé, en Wi-Fi"
    }

    /** Identifiant du téléchargement s'il est en attente ou en cours. */
    fun enCours(ctx: Context): Long? {
        val id = prefs(ctx).getLong("id", -1).takeIf { it >= 0 } ?: return null
        val s = statut(ctx, id) ?: return null
        return if (s.first in setOf(DownloadManager.STATUS_PENDING, DownloadManager.STATUS_RUNNING, DownloadManager.STATUS_PAUSED)) id else null
    }

    private fun statut(ctx: Context, id: Long): Triple<Int, Long, Long>? {
        val dm = ctx.getSystemService(DownloadManager::class.java)
        dm.query(DownloadManager.Query().setFilterById(id))?.use { c ->
            if (!c.moveToFirst()) return null
            return Triple(c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)),
                c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),
                c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)))
        }
        return null
    }

    /** Texte d'état pour l'écran : présent, pourcentage, en attente du Wi-Fi, échec. */
    fun etat(ctx: Context): String {
        if (Reglages(ctx).modele.exists()) return "présent et vérifié"
        prefs(ctx).getString("echec", null)?.let { return "échec : $it" }
        val id = prefs(ctx).getLong("id", -1).takeIf { it >= 0 } ?: return "absent"
        val (s, fait, total) = statut(ctx, id) ?: return "absent"
        val pct = if (total > 0) " ${fait * 100 / total} %" else ""
        return when (s) {
            DownloadManager.STATUS_PENDING -> "en attente"
            DownloadManager.STATUS_PAUSED -> "en pause (attend le Wi-Fi)$pct"
            DownloadManager.STATUS_RUNNING -> "téléchargement$pct"
            DownloadManager.STATUS_SUCCESSFUL -> "vérification…"
            else -> "échec du téléchargement"
        }
    }

    /** Fin du téléchargement : somme vérifiée, puis le fichier prend son nom définitif. Fil de travail. */
    fun terminer(ctx: Context) {
        val id = prefs(ctx).getLong("id", -1).takeIf { it >= 0 } ?: return
        val (s, _, _) = statut(ctx, id) ?: return
        if (s != DownloadManager.STATUS_SUCCESSFUL) {
            if (s == DownloadManager.STATUS_FAILED) prefs(ctx).edit().putString("echec", "téléchargement interrompu").remove("id").commit()
            return
        }
        val f = partiel(ctx)
        val somme = sha256(f)
        val r = Reglages(ctx)
        if (f.length() == TAILLE && somme == SHA256) {
            r.modele.parentFile?.mkdirs()
            if (!f.renameTo(r.modele)) { f.copyTo(r.modele, overwrite = true); f.delete() }
            prefs(ctx).edit().remove("id").remove("echec").commit()
            Journal.log("modèle : téléchargé et vérifié (SHA-256 conforme)")
            Synchro.de(ctx).demanderAmeliorations()
        } else {
            f.delete()
            prefs(ctx).edit().putString("echec", "somme SHA-256 différente, fichier effacé").remove("id").commit()
            Journal.log("modèle : somme SHA-256 différente (${somme.take(12)}…), fichier effacé")
        }
    }

    fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { i -> val b = ByteArray(1 shl 20); while (true) { val n = i.read(b); if (n < 0) break; md.update(b, 0, n) } }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}

/** DownloadManager : téléchargement fini (le système l'envoie à notre paquet). */
class FinTelechargement : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val r = goAsync()
        Thread { try { Modele.terminer(ctx) } catch (e: Exception) { Journal.erreur("modèle", e) } finally { r.finish() } }.start()
    }
}
