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

    /**
     * Trois états, jamais deux : ACTIF (processus vu, ou son port répond), INACTIF (absence PROUVÉE : liste complète
     * des processus sans lui, ou son port refuse la connexion), NON VÉRIFIABLE (le shell ne rend pas de liste
     * complète et le port n'est pas connu). Seul INACTIF alerte ; NON VÉRIFIABLE se montre à l'écran et attend le
     * prochain événement (Wi-Fi, appel, fichier, 5555 rouvert), sans conclure.
     */
    private fun verifierMaintenant(origine: String) {
        if (!reglages.jemrecPresent) { poser(null, "JemRec absent : enregistrement non proposé", origine, sansObjet = true); return }
        var parShell = lireShell()
        if (parShell == null && synchro.adb.etat.startsWith("connecté")) {
            // Connexion adb restée ouverte mais qui ne rend plus rien (Wi-Fi changé) : une seule reprise, neuve.
            synchro.adb.fermer(); parShell = lireShell()
        }
        val port = synchro.base.lire("jemrec.port")?.toIntOrNull()
        // Sans liste complète : le processus de JemRec écoute sur 127.0.0.1:<port> (28472, stable aux redémarrages du
        // 13 et du 14/11) ; une connexion ouverte puis refermée aussitôt, sans rien envoyer, dit s'il est là.
        val parPort: Boolean? = if (parShell == null && port != null) try {
            java.net.Socket().use { it.connect(java.net.InetSocketAddress("127.0.0.1", port), 1000) }; true
        } catch (_: java.net.ConnectException) { false } catch (_: Exception) { null } else null
        when (parShell ?: parPort) {
            true -> poser(true, if (parShell == true) "actif (processus de JemRec vu par le shell)" else "actif (JemRec répond sur son port $port)", origine)
            false -> {
                poser(false, when {
                    parShell == false && wifi() -> "JemRec ne tourne pas (absent de la liste des processus) ; en Wi-Fi il se relance seul, sinon ouvrez JemRec"
                    parShell == false -> "JemRec ne tourne pas (absent de la liste des processus) ; il ne peut redémarrer qu'en Wi-Fi"
                    wifi() -> "JemRec ne répond pas sur son port $port ; en Wi-Fi il se relance seul, sinon ouvrez JemRec"
                    else -> "JemRec ne répond pas sur son port $port et pas de Wi-Fi : il ne peut redémarrer qu'en Wi-Fi"
                }, origine)
                if (wifi()) rallumerDebogageSansFil()
            }
            null -> poser(null, "NON VÉRIFIABLE : le shell ne rend pas la liste des processus (${synchro.adb.etat})" +
                (if (port == null) ", port de JemRec inconnu" else "") + " ; nouvel essai au prochain événement", origine)
        }
    }

    /** Vrai/faux sur une liste de processus prouvée complète, null sinon (jamais une sortie vide prise pour une absence). */
    private fun lireShell(): Boolean? = try {
        val sortie = synchro.adb.texte(Politique.COMMANDE_PROCESSUS, 20_000)
        Politique.processus(sortie, MOTIF)?.also { present ->
            if (present) Politique.portDe(sortie, MOTIF)?.let { synchro.base.ecrire("jemrec.port", it.toString()) }
        }
    } catch (_: Exception) { null }

    /** JemRec a besoin du débogage sans fil pour se relancer ; Android le coupe à chaque perte du Wi-Fi. */
    private fun rallumerDebogageSansFil() {
        try {
            if (Settings.Global.getInt(ctx.contentResolver, "adb_wifi_enabled", 0) != 1) {
                Settings.Global.putInt(ctx.contentResolver, "adb_wifi_enabled", 1)
                Journal.log("enregistrement : débogage sans fil rallumé pour JemRec")
            }
        } catch (e: SecurityException) { Journal.erreur("enregistrement : WRITE_SECURE_SETTINGS manquant", e) }
    }

    private fun poser(vivant: Boolean?, texte: String, origine: String, sansObjet: Boolean = false) {
        // Non vérifiable après une preuve : l'état prouvé reste affiché (et son alerte aussi), on ne conclut rien de neuf.
        if (vivant == null && !sansObjet && actif != null) {
            if (texte != verification) { verification = texte; Journal.log("enregistrement : $texte ($origine), dernier état prouvé gardé") }
            return
        }
        verification = null
        val change = vivant != actif || texte != etat
        if (vivant != actif) depuis = System.currentTimeMillis()
        actif = vivant; etat = texte
        if (change) Journal.log("enregistrement : $texte ($origine)")
        // Juste après le démarrage, JemRec met environ 45 s à revenir (mesuré le 13/11 : 47 s après le noyau) :
        // pas d'alerte pendant ces 2 minutes, sauf si un appel commence. Alerte seulement sur une absence prouvée.
        val jeune = SystemClock.elapsedRealtime() < 120_000 && !origine.startsWith("appel")
        if (vivant == false && !jeune) notifierInactif(texte) else if (vivant == true || sansObjet) effacer(NOTIF_INACTIF)
    }

    /** Dernière vérification non aboutie depuis le dernier état prouvé (affichée, jamais une conclusion). */
    @Volatile private var verification: String? = null

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
            .setContentTitle("Enregistrement des appels inactif")
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
        else -> "${if (actif == true) "actif" else "INACTIF"} depuis ${DEPUIS.format(Instant.ofEpochMilli(depuis).atZone(ZoneId.systemDefault()))} : $etat" +
            (verification?.let { " (dernière vérification : $it)" } ?: "")
    }

    companion object {
        const val JEMREC = "com.jemcik.jemrec"
        const val MOTIF = "com.jemcik.jemrec.shell.Main"
        const val CANAL = "enregistrement"
        const val NOTIF_INACTIF = 4
        const val NOTIF_MANQUE = 5
        private val HEURE = DateTimeFormatter.ofPattern("HH:mm")
        private val DEPUIS = DateTimeFormatter.ofPattern("dd/MM HH:mm:ss")
        @Volatile var instance: Enregistreur? = null
    }
}
