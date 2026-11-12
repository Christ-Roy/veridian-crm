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
    private lateinit var fil: HandlerThread
    private lateinit var handler: Handler
    private val observateurs = mutableListOf<ContentObserver>()
    private var jemrec: FileObserver? = null
    private var reseau: ConnectivityManager.NetworkCallback? = null
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
        observer(CallLog.Calls.CONTENT_URI) { synchro.signaler(Synchro.Flux.APPELS) }
        observer(Uri.parse("content://sms")) { synchro.signaler(Synchro.Flux.SMS) }
        observer(Uri.parse("content://mms")) { synchro.signaler(Synchro.Flux.MMS) }
        try { observer(Uri.parse(Sources.MESSAGERIE)) { rafale() } } catch (_: SecurityException) {}
        surveillerJemrec()
        surveillerReseau()
        surveillerAppels()
        registerReceiver(transcriptionPrete, IntentFilter(TRANSCRIPTION_PRETE), RECEIVER_NOT_EXPORTED)
        bindService(Intent(this, ServiceTranscription::class.java), liaison, BIND_AUTO_CREATE)
        Journal.log("service prêt (${synchro.reglages.mode}) : ${synchro.base.taille()} en file, ${synchro.base.taille("televersements")} fichiers")
        synchro.signalerTout(complet = synchro.base.lire("premiere-lecture") == null)
        synchro.base.ecrire("premiere-lecture", "faite")
        synchro.demanderVidange()
        if (enCharge()) synchro.demanderAmeliorations()
        handler.post(boucleSonde)
        handler.postDelayed(filet, FILET_MS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        premierPlan()
        when (intent?.action) {
            RAFALE -> rafale()
            CHARGE -> synchro.demanderAmeliorations()
            SMS -> { synchro.signaler(Synchro.Flux.SMS); rafale() }
            MMS -> synchro.signaler(Synchro.Flux.MMS)
        }
        return START_STICKY
    }

    private fun premierPlan() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CANAL, "Synchronisation CRM", NotificationManager.IMPORTANCE_MIN))
        val ouvrir = PendingIntent.getActivity(this, 0, Intent(this, EtatActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val mode = Reglages(this).mode
        val n = Notification.Builder(this, CANAL).setSmallIcon(android.R.drawable.sym_action_call)
            .setContentTitle(if (mode == "miroir") "CRM : mode miroir (rien n'est écrit)" else "CRM : appels et SMS synchronisés")
            .setContentIntent(ouvrir).setOngoing(true).build()
        startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
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
        contentResolver.registerContentObserver(uri, true, o)
        observateurs += o
    }

    private fun surveillerJemrec() {
        val dossier = synchro.reglages.jemrec
        jemrec = object : FileObserver(dossier, CLOSE_WRITE or MOVED_TO) {
            override fun onEvent(event: Int, nom: String?) {
                if (nom == null || !nom.endsWith(".ogg")) return
                val (debut, _) = Contrat.lireNomJemrec(nom.removeSuffix(".ogg")) ?: return
                Journal.log("JemRec : enregistrement fini")
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
    }

    private fun surveillerAppels() {
        val tm = getSystemService(TelephonyManager::class.java)
        try {
            etatAppel = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                override fun onCallStateChanged(etat: Int) {
                    if (etat == TelephonyManager.CALL_STATE_IDLE && dernierEtatAppel != TelephonyManager.CALL_STATE_IDLE) {
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
        val e = synchro.sources.sondeMessagerie() ?: return@execute
        if (e != derniereSonde) {
            if (derniereSonde != null) Journal.log("messagerie : changement vu par la sonde")
            derniereSonde = e
            synchro.signaler(Synchro.Flux.MESSAGERIE)
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
        etatAppel?.let { getSystemService(TelephonyManager::class.java).unregisterTelephonyCallback(it) }
        try { unregisterReceiver(transcriptionPrete) } catch (_: Exception) {}
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
