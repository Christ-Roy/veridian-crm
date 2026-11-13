package site.veridian.telephonie

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.SystemClock
import android.provider.CallLog
import android.provider.Settings
import site.veridian.telephonie.contrat.Contrat
import site.veridian.telephonie.contrat.Politique
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.Executors

/**
 * L'enregistreur d'appels (JemRec) tourne-t-il ? Jamais d'échec silencieux : tant qu'il ne peut pas enregistrer, une
 * notification persistante le dit, effacée dès qu'il revient ; un appel décroché resté sans fichier est signalé.
 *
 * JemRec enregistre par un processus du shell (`app_process … com.jemcik.jemrec.shell.Main`), lancé par adb. Après
 * un redémarrage, adb n'existe qu'avec le Wi-Fi (débogage sans fil) : sans Wi-Fi, ni JemRec ni l'app ne peuvent le
 * relancer sans root (mesuré le 14/11/2026 : `setprop persist.adb.tcp.port` refusé au shell, `default_prop`). Le
 * port 5555, une fois rouvert (par l'app ou par JemRec), reste ouvert jusqu'au prochain redémarrage, Wi-Fi ou non.
 *
 * Vérifié par la vérité, pas par une supposition : le processus vu par le shell de l'app, et après chaque appel
 * décroché, la présence de son fichier. Aucune minuterie : des vérifications ponctuelles à des événements
 * (démarrage du service, Wi-Fi revenu, début et fin d'appel, fichier de JemRec écrit).
 */
class Enregistreur(private val ctx: Context, private val synchro: Synchro, private val handler: Handler) {
    private val reglages get() = synchro.reglages
    private val fil = Executors.newSingleThreadExecutor()
    @Volatile var etat: String = "non vérifié"; private set
    @Volatile var actif: Boolean? = null; private set
    @Volatile var depuis: Long = System.currentTimeMillis(); private set

    /** Vérifie maintenant, puis aux délais donnés (ms), une fois chacun. */
    fun verifier(origine: String, vararg ensuite: Long) {
        fil.execute { verifierMaintenant(origine) }
        for (d in ensuite) handler.postDelayed({ fil.execute { verifierMaintenant("$origine +${d / 1000} s") } }, d)
    }

    private fun verifierMaintenant(origine: String) {
        if (!reglages.jemrecPresent) { poser(null, "JemRec absent : enregistrement non proposé", origine); return }
        val parShell: Boolean? = try {
            val lignes = synchro.adb.texte("ps -A -o ARGS | grep '[c]om.jemcik.jemrec.shell.Main' || true", 20_000).lines().filter { it.isNotBlank() }
            // Le port de la boucle locale du processus de JemRec (dernier argument) : il sert à le voir sans le shell.
            lignes.firstNotNullOfOrNull { it.trim().substringAfterLast(' ').toIntOrNull() }?.let { synchro.base.ecrire("jemrec.port", it.toString()) }
            lignes.isNotEmpty()
        } catch (e: Exception) { null }
        // Sans shell (5555 fermé et pas de Wi-Fi) : le processus de JemRec écoute sur 127.0.0.1:<port> ; une connexion
        // ouverte puis refermée aussitôt, sans rien envoyer, dit s'il est là.
        val port = synchro.base.lire("jemrec.port")?.toIntOrNull()
        val parPort: Boolean? = if (parShell == null && port != null) try {
            java.net.Socket().use { it.connect(java.net.InetSocketAddress("127.0.0.1", port), 1000) }; true
        } catch (_: Exception) { false } else null
        val vivant = parShell ?: parPort
        when (vivant) {
            true -> poser(true, if (parShell == true) "actif (processus de JemRec vu par le shell)" else "actif (JemRec répond sur la boucle locale)", origine)
            false -> {
                poser(false, when {
                    parShell == false && wifi() -> "JemRec ne tourne pas ; en Wi-Fi il se relance seul en quelques secondes, sinon ouvrez JemRec"
                    parShell == false -> "JemRec ne tourne pas ; il ne peut redémarrer qu'en Wi-Fi"
                    wifi() -> "JemRec ne répond pas sur sa boucle locale (shell injoignable : ${synchro.adb.etat})"
                    else -> "pas de Wi-Fi depuis le redémarrage : l'enregistreur ne peut pas démarrer, il reprendra au premier Wi-Fi"
                }, origine)
                if (wifi()) rallumerDebogageSansFil()
            }
            null -> poser(false, if (wifi()) "état inconnu : le shell du téléphone ne répond pas (${synchro.adb.etat})"
                else "pas de Wi-Fi et shell injoignable (téléphone redémarré hors Wi-Fi ?) : état inconnu, l'enregistreur ne peut démarrer qu'en Wi-Fi", origine)
        }
    }

    /** JemRec a besoin du débogage sans fil pour se relancer ; Android le coupe à chaque perte du Wi-Fi. */
    private fun rallumerDebogageSansFil() {
        try {
            if (Settings.Global.getInt(ctx.contentResolver, "adb_wifi_enabled", 0) != 1) {
                Settings.Global.putInt(ctx.contentResolver, "adb_wifi_enabled", 1)
                Journal.log("enregistrement : débogage sans fil rallumé pour JemRec")
            }
        } catch (e: SecurityException) { Journal.erreur("enregistrement : WRITE_SECURE_SETTINGS manquant", e) }
    }

    private fun poser(vivant: Boolean?, texte: String, origine: String) {
        val change = vivant != actif || texte != etat
        if (vivant != actif) depuis = System.currentTimeMillis()
        actif = vivant; etat = texte
        if (change) Journal.log("enregistrement : $texte ($origine)")
        // Juste après le démarrage, JemRec met environ 45 s à revenir (mesuré le 13/11 : 47 s après le noyau) :
        // pas d'alerte pendant ces 2 minutes, sauf si un appel commence.
        val jeune = SystemClock.elapsedRealtime() < 120_000 && !origine.startsWith("appel")
        if (vivant == false && !jeune) notifierInactif(texte) else if (vivant != false) effacer(NOTIF_INACTIF)
    }

    private fun wifi(): Boolean {
        val cm = ctx.getSystemService(android.net.ConnectivityManager::class.java)
        return cm.allNetworks.any { cm.getNetworkCapabilities(it)?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) == true }
    }

    // ------------------------------------------------------------ appels

    private var debutAppel = 0L

    fun appelCommence() {
        debutAppel = System.currentTimeMillis()
        verifier("appel commencé")
    }

    /** Fin d'appel : 150 s plus tard (JemRec écrit son fichier à la fin, en quelques secondes), le fichier doit exister. */
    fun appelFini() {
        val depuisMs = (if (debutAppel > 0) debutAppel else System.currentTimeMillis()) - 120_000
        debutAppel = 0
        if (!reglages.jemrecPresent) return
        handler.postDelayed({ fil.execute { controlerFichiers(depuisMs) } }, 150_000)
    }

    /** Un fichier de JemRec vient d'être écrit : l'enregistreur tourne. */
    fun fichierEcrit() = fil.execute { if (actif != true) verifierMaintenant("fichier de JemRec écrit") }

    private fun controlerFichiers(depuisMs: Long) {
        val debuts = (reglages.jemrec.listFiles { f -> f.name.endsWith(".ogg") } ?: emptyArray())
            .mapNotNull { Contrat.lireNomJemrec(it.nameWithoutExtension)?.first }.filter { it >= depuisMs - 600_000 }
        val manques = mutableListOf<String>()
        try {
            ctx.contentResolver.query(CallLog.Calls.CONTENT_URI, arrayOf(CallLog.Calls.DATE, CallLog.Calls.DURATION),
                "${CallLog.Calls.DATE} >= ?", arrayOf(depuisMs.toString()), "${CallLog.Calls.DATE} ASC")?.use { c ->
                while (c.moveToNext()) {
                    val debut = c.getLong(0); val duree = c.getLong(1)
                    if (Politique.nonEnregistre(debut, duree, debuts)) manques += "${HEURE.format(Instant.ofEpochMilli(debut).atZone(ZoneId.systemDefault()))} (${duree} s)"
                }
            }
        } catch (e: Exception) { Journal.erreur("enregistrement : contrôle après l'appel", e); return }
        if (manques.isEmpty()) return
        Journal.log("enregistrement : appel décroché sans fichier de JemRec : ${manques.joinToString(", ")}")
        val nm = canal()
        nm.notify(NOTIF_MANQUE, Notification.Builder(ctx, CANAL).setSmallIcon(android.R.drawable.stat_notify_error)
            .setContentTitle("Appel non enregistré : ${manques.joinToString(", ")}")
            .setContentText("JemRec n'a écrit aucun fichier pour cet appel.")
            .setContentIntent(ouvrirJemrec()).setAutoCancel(true).build())
        verifierMaintenant("appel non enregistré")
    }

    // ------------------------------------------------------------ notifications

    private fun canal(): NotificationManager {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CANAL, "Enregistrement des appels", NotificationManager.IMPORTANCE_DEFAULT))
        return nm
    }

    private fun ouvrirJemrec(): PendingIntent {
        val i = ctx.packageManager.getLaunchIntentForPackage(JEMREC) ?: Intent(ctx, AccueilActivity::class.java)
        return PendingIntent.getActivity(ctx, 3, i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)
    }

    private var notifie: String? = null

    private fun notifierInactif(texte: String) {
        if (notifie == texte) return
        notifie = texte
        canal().notify(NOTIF_INACTIF, Notification.Builder(ctx, CANAL).setSmallIcon(android.R.drawable.stat_notify_error)
            .setContentTitle(if (texte.contains("état inconnu")) "Enregistrement des appels : état inconnu" else "Enregistrement des appels inactif")
            .setContentText(texte).setStyle(Notification.BigTextStyle().bigText("$texte\nTouchez pour ouvrir JemRec."))
            .setContentIntent(ouvrirJemrec()).setOngoing(true).setOnlyAlertOnce(true).build())
    }

    private fun effacer(id: Int) {
        if (id == NOTIF_INACTIF) { if (notifie == null) return; notifie = null }
        ctx.getSystemService(NotificationManager::class.java).cancel(id)
    }

    /** Une ligne pour l'écran et `etat`. */
    fun resume(): String = when (actif) {
        null -> etat
        else -> "${if (actif == true) "actif" else "INACTIF"} depuis ${DEPUIS.format(Instant.ofEpochMilli(depuis).atZone(ZoneId.systemDefault()))} : $etat"
    }

    companion object {
        const val JEMREC = "com.jemcik.jemrec"
        const val CANAL = "enregistrement"
        const val NOTIF_INACTIF = 4
        const val NOTIF_MANQUE = 5
        private val HEURE = DateTimeFormatter.ofPattern("HH:mm")
        private val DEPUIS = DateTimeFormatter.ofPattern("dd/MM HH:mm:ss")
        @Volatile var instance: Enregistreur? = null
    }
}
