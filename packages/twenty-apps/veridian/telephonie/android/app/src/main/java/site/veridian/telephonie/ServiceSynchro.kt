package site.veridian.telephonie

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.ServiceConnection
import android.content.pm.ServiceInfo
import android.database.ContentObserver
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.FileObserver
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.provider.CallLog
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import site.veridian.telephonie.contrat.Contrat
import java.util.concurrent.Executors

/**
 * Service de premier plan : tout ce qui déclenche une lecture, et rien d'autre. Aucune minuterie ne lit le
 * téléphone à vide : observateurs du journal d'appels, des SMS et des MMS, FileObserver sur JemRec, état d'appel,
 * SMS reçu ; seule la messagerie vocale, close aux apps, est sondée par le shell (60 s, 5 s pendant 3 min après un
 * appel, un SMS ou une notification du téléphone). Le filet (relecture locale toutes les 30 min, empreintes : rien
 * n'est renvoyé si rien n'a changé) rattrape un observateur qui aurait manqué.
 *
 * Redémarré par Android s'il est tué (START_STICKY, mémoire, plantage), au démarrage du téléphone (Recepteur),
 * et par WorkManager quand la file attend le réseau.
 */
class ServiceSynchro : Service() {
    private lateinit var synchro: Synchro
    private lateinit var enregistreur: Enregistreur
    private lateinit var fil: HandlerThread
    private lateinit var handler: Handler
    private val observateurs = mutableListOf<ContentObserver>()
    private var jemrec: FileObserver? = null
    private var reseau: ConnectivityManager.NetworkCallback? = null
    private var wifi: ConnectivityManager.NetworkCallback? = null
    private var etatAppel: TelephonyCallback? = null
    private val sonde = Executors.newSingleThreadExecutor()
    @Volatile private var derniereSonde: String? = null
    @Volatile private var rafaleJusqua = 0L
    private var dernierEtatAppel = TelephonyManager.CALL_STATE_IDLE
    @Volatile private var nonFacture = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Journal.init(this)
        premierPlan()
        synchro = Synchro.de(this)
        fil = HandlerThread("declencheurs").apply { start() }
        handler = Handler(fil.looper)
        enregistreur = Enregistreur(this, synchro, handler).also { Enregistreur.instance = it }
        observer(CallLog.Calls.CONTENT_URI) { synchro.signaler(Synchro.Flux.APPELS) }
        observer(Uri.parse("content://sms")) { synchro.signaler(Synchro.Flux.SMS) }
        observer(Uri.parse("content://mms")) { synchro.signaler(Synchro.Flux.MMS) }
        // Un MMS envoyé par Google Messages ne notifie que content://mms-sms (mesuré le 12/11 : _id 31 à 17h03:20,
        // aucun réveil sur content://mms) : ce point de convergence relit SMS et MMS.
        observer(Uri.parse("content://mms-sms/")) { synchro.signaler(Synchro.Flux.SMS); synchro.signaler(Synchro.Flux.MMS) }
        observer(Uri.parse(Sources.MESSAGERIE)) { rafale() }
        surveillerJemrec()
        surveillerReseau()
        surveillerAppels()
        registerReceiver(transcriptionPrete, IntentFilter(TRANSCRIPTION_PRETE), RECEIVER_NOT_EXPORTED)
        // Chargeur branché : déclaré dans le manifeste, ACTION_POWER_CONNECTED n'arrive plus aux apps depuis Android 8
        // (jamais vu au journal du 12 au 14/11). Inscrit ici, il arrive tant que le service vit.
        registerReceiver(branchement, IntentFilter(Intent.ACTION_POWER_CONNECTED))
        bindService(Intent(this, ServiceTranscription::class.java), liaison, BIND_AUTO_CREATE)
        Journal.log("service prêt (${synchro.reglages.mode}) : ${synchro.base.taille()} en file, ${synchro.base.taille("televersements")} fichiers")
        synchro.prechauffer()
        synchro.signalerTout(complet = synchro.base.lire("premiere-lecture") == null)
        synchro.base.ecrire("premiere-lecture", "faite")
        synchro.demanderVidange()
        if (enCharge()) synchro.demanderAmeliorations()
        handler.post { synchro.rattraper(origine = "démarrage du service"); synchro.reveillerTranscription() }
        // Démarrage (souvent celui du téléphone) : JemRec revient en ~45 s en Wi-Fi ; vérifié tout de suite puis
        // trois fois, une seule fois chacune (pas de minuterie qui tourne).
        enregistreur.verifier("démarrage du service", 60_000, 150_000, 300_000)
        handler.post(boucleSonde)
        handler.postDelayed(filet, FILET_MS)
        handler.postDelayed(etatNotification, 5_000)
        handler.post(sondeLocale)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        premierPlan()
        when (intent?.action) {
            RAFALE -> rafale()
            CHARGE -> { synchro.rattraper(origine = "chargeur branché"); synchro.demanderAmeliorations(); synchro.reveillerTranscription() }
            SMS -> { synchro.signaler(Synchro.Flux.SMS); rafale() }
            MMS -> synchro.signaler(Synchro.Flux.MMS)
        }
        return START_STICKY
    }

    private fun premierPlan() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CANAL, "Synchronisation CRM", NotificationManager.IMPORTANCE_MIN))
        val ouvrir = PendingIntent.getActivity(this, 0, Intent(this, AccueilActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        startForeground(1, notification(ouvrir), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    }

    /** État dans la notification : mode, file, adb, dernières lignes du journal. Lisible en 4G sans adb
     *  (`termux-notification-list` par ssh pixel), pour diagnostiquer quand le port 5555 est fermé. */
    private fun notification(ouvrir: PendingIntent): Notification {
        val mode = Reglages(this).mode
        val s = Synchro.de(this)
        val texte = "mode $mode · file ${s.base.taille()} · fichiers ${s.base.taille("televersements")} · adb ${s.adb.etat}\n" +
            "enregistrement : ${Enregistreur.instance?.resume() ?: "non vérifié"}\ntranscription : ${s.transcriptions.resume()}\n" +
            synchronized(Journal) { Journal.dernieres.joinToString("\n") }
        return Notification.Builder(this, CANAL).setSmallIcon(android.R.drawable.sym_action_call)
            .setContentTitle(when {
                Reglages(this).reconnexion != null -> "CRM : reconnexion à Twenty requise (rien n'est perdu)"
                mode == "miroir" -> "CRM : mode essai (rien n'est écrit)"
                else -> "CRM : appels et SMS synchronisés" })
            .setContentText(texte.lineSequence().first()).setStyle(Notification.BigTextStyle().bigText(texte))
            .setContentIntent(ouvrir).setOngoing(true).setOnlyAlertOnce(true).build()
    }

    private var notifiee = 0L
    private val etatNotification = object : Runnable {
        override fun run() {
            if (Journal.change != notifiee) {
                notifiee = Journal.change
                Commandes.exporterEtat(this@ServiceSynchro, synchro)
                try {
                    val ouvrir = PendingIntent.getActivity(this@ServiceSynchro, 0, Intent(this@ServiceSynchro, AccueilActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
                    getSystemService(NotificationManager::class.java).notify(1, notification(ouvrir))
                } catch (e: Exception) { Journal.erreur("notification", e) }
            }
            handler.postDelayed(this, 15_000)
        }
    }

    private fun observer(uri: Uri, action: () -> Unit) {
        val o = object : ContentObserver(handler) {
            private var prevu = false
            override fun onChange(selfChange: Boolean) {
                // un événement écrit souvent plusieurs lignes : une seule lecture 300 ms après la rafale
                if (prevu) return
                prevu = true
                handler.postDelayed({ prevu = false; action() }, 300)
            }
        }
        try {
            contentResolver.registerContentObserver(uri, true, o)
            observateurs += o
        } catch (e: SecurityException) {
            // Autorisation pas encore accordée (premier lancement) : l'écran relance le service une fois accordée.
            Journal.log("observateur $uri : autorisation manquante")
        }
    }

    private fun surveillerJemrec() {
        val dossier = synchro.reglages.jemrec
        jemrec = object : FileObserver(dossier, CLOSE_WRITE or MOVED_TO) {
            override fun onEvent(event: Int, nom: String?) {
                if (nom == null || !nom.endsWith(".ogg")) return
                val (debut, _) = Contrat.lireNomJemrec(nom.removeSuffix(".ogg")) ?: return
                Journal.log("JemRec : enregistrement fini")
                enregistreur.fichierEcrit()
                synchro.signaler(Synchro.Flux.APPELS, fenetre = (debut - 180_000)..(debut + 180_000))
            }
        }.also { it.startWatching() }
        if (!dossier.canRead()) Journal.log("JemRec : dossier illisible (MANAGE_EXTERNAL_STORAGE à accorder)")
    }

    private fun surveillerReseau() {
        val cm = getSystemService(ConnectivityManager::class.java)
        reseau = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { handler.postDelayed({ synchro.demanderVidange(); sonder() }, 2000) }
            override fun onCapabilitiesChanged(network: Network, caps: android.net.NetworkCapabilities) {
                val libre = caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
                if (libre && !nonFacture) synchro.reveillerFichiers()

                nonFacture = libre
            }
        }.also { cm.registerDefaultNetworkCallback(it) }
        // Le réseau par défaut est souvent le VPN (Tailscale) : le Wi-Fi a son propre rappel. À son retour, le shell
        // (messagerie, réouverture de 5555 par le débogage sans fil) est retenté tout de suite.
        wifi = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                Journal.log("réseau : Wi-Fi disponible")
                enregistreur.verifier("Wi-Fi revenu", 20_000, 60_000, 180_000)
                synchro.sources.reessayerAdb(); synchro.reveillerFichiers()
                handler.postDelayed({ sonder() }, 3000)
            }
        }.also { cm.registerNetworkCallback(android.net.NetworkRequest.Builder()
            .addTransportType(android.net.NetworkCapabilities.TRANSPORT_WIFI).build(), it) }
    }

    private fun surveillerAppels() {
        val tm = getSystemService(TelephonyManager::class.java)
        try {
            etatAppel = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                override fun onCallStateChanged(etat: Int) {
                    if (etat == TelephonyManager.CALL_STATE_OFFHOOK && dernierEtatAppel != TelephonyManager.CALL_STATE_OFFHOOK) enregistreur.appelCommence()
                    if (etat == TelephonyManager.CALL_STATE_IDLE && dernierEtatAppel != TelephonyManager.CALL_STATE_IDLE) {
                        enregistreur.appelFini()
                        // fin d'appel : le journal est écrit dans la seconde (observateur), la messagerie peut suivre
                        synchro.signaler(Synchro.Flux.APPELS); rafale()
                    }
                    dernierEtatAppel = etat
                }
            }.also { tm.registerTelephonyCallback(mainExecutor, it) }
        } catch (e: SecurityException) { Journal.erreur("état d'appel", e) }
    }

    /** Messagerie sondée toutes les 5 s pendant 3 min : après un appel, un SMS reçu (avis visuel), une notification. */
    fun rafale() {
        rafaleJusqua = System.currentTimeMillis() + 180_000
        handler.removeCallbacks(boucleSonde)
        handler.post(boucleSonde)
    }

    private val boucleSonde = object : Runnable {
        override fun run() {
            sonder()
            handler.postDelayed(this, if (System.currentTimeMillis() < rafaleJusqua) 5_000 else 60_000)
        }
    }

    private fun sonder() = sonde.execute {
        val e = try { synchro.sources.sondeMessagerie() } catch (t: Throwable) { Journal.erreur("sonde", t); null } ?: return@execute
        if (e != derniereSonde) {
            if (derniereSonde != null) Journal.log("messagerie : changement vu par la sonde")
            derniereSonde = e
            synchro.signaler(Synchro.Flux.MESSAGERIE)
        }
    }

    /** Dernier _id des SMS et des MMS, lu toutes les 60 s dans le fournisseur local (une requête, pas de shell) :
     *  le filet de l'observateur, comme la sonde de 60 s de l'agent Termux. */
    private val derniersId = HashMap<String, Long>()
    private val sondeLocale = object : Runnable {
        override fun run() {
            for ((uri, flux) in listOf("content://sms" to Synchro.Flux.SMS, "content://mms" to Synchro.Flux.MMS)) {
                try {
                    contentResolver.query(Uri.parse(uri), arrayOf("_id"), null, null, "_id DESC LIMIT 1")?.use { c ->
                        if (c.moveToFirst()) {
                            val id = c.getLong(0)
                            val avant = derniersId.put(uri, id)
                            if (avant != null && avant != id) { Journal.log("${flux.nom} : nouveau message vu par la sonde locale"); synchro.signaler(flux) }
                        }
                    }
                } catch (e: Exception) { Journal.erreur("sonde locale $uri", e) }
            }
            handler.postDelayed(this, 60_000)
        }
    }

    private val filet = object : Runnable {
        override fun run() {
            synchro.signalerTout()
            synchro.demanderVidange()
            handler.postDelayed(this, FILET_MS)
        }
    }

    private val transcriptionPrete = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            synchro.transcriptionPrete(i.getStringExtra("stem") ?: return, i.getStringExtra("flux") ?: "appels")
        }
    }

    private val branchement = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            Journal.log("chargeur branché")
            handler.post { synchro.rattraper(origine = "chargeur branché"); synchro.demanderAmeliorations(); synchro.reveillerTranscription() }
        }
    }

    private val liaison = object : ServiceConnection {
        override fun onServiceConnected(n: ComponentName?, b: IBinder?) {}
        override fun onServiceDisconnected(n: ComponentName?) { Journal.log("transcription : processus arrêté, Android le relance") }
    }

    private fun enCharge(): Boolean {
        val i = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return false
        val s = i.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1)
        return s == android.os.BatteryManager.BATTERY_STATUS_CHARGING || s == android.os.BatteryManager.BATTERY_STATUS_FULL
    }

    override fun onDestroy() {
        Journal.log("service arrêté")
        observateurs.forEach { contentResolver.unregisterContentObserver(it) }
        jemrec?.stopWatching()
        reseau?.let { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) }
        wifi?.let { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) }
        etatAppel?.let { getSystemService(TelephonyManager::class.java).unregisterTelephonyCallback(it) }
        try { unregisterReceiver(transcriptionPrete) } catch (_: Exception) {}
        try { unregisterReceiver(branchement) } catch (_: Exception) {}
        try { unbindService(liaison) } catch (_: Exception) {}
        handler.removeCallbacksAndMessages(null)
        fil.quitSafely()
        super.onDestroy()
    }

    companion object {
        const val CANAL = "synchro"
        const val RAFALE = "site.veridian.telephonie.RAFALE"
        const val CHARGE = "site.veridian.telephonie.CHARGE"
        const val SMS = "site.veridian.telephonie.SMS"
        const val MMS = "site.veridian.telephonie.MMS"
        const val TRANSCRIPTION_PRETE = "site.veridian.telephonie.TRANSCRIPTION_PRETE"
        const val FILET_MS = 30 * 60_000L

        fun demarrer(ctx: Context, action: String? = null, origine: String) {
            try {
                ctx.startForegroundService(Intent(ctx, ServiceSynchro::class.java).setAction(action))
            } catch (e: Exception) {
                Journal.erreur("démarrage du service ($origine) refusé", e)
            }
        }
    }
}
