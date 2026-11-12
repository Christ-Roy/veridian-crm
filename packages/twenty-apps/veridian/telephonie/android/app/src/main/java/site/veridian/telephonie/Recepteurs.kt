package site.veridian.telephonie

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.work.Configuration
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/** L'application : journal, WorkManager configuré à la main, service démarré dans le processus principal. */
class App : Application(), Configuration.Provider {
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setMinimumLoggingLevel(android.util.Log.WARN).build()

    override fun onCreate() {
        super.onCreate()
        Journal.init(this)
        if (getProcessName() == packageName) {
            Thread.setDefaultUncaughtExceptionHandler(Thread.getDefaultUncaughtExceptionHandler().let { avant ->
                Thread.UncaughtExceptionHandler { t, e -> Journal.erreur("plantage (${t.name})", e); avant?.uncaughtException(t, e) }
            })
            ServiceSynchro.demarrer(this, origine = "processus")
        }
    }
}

/** Démarrage du téléphone, mise à jour de l'app, état d'appel, SMS et MMS reçus, branchement du chargeur. */
class Recepteur : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val action = when (intent.action) {
            "android.provider.Telephony.SMS_RECEIVED" -> ServiceSynchro.SMS
            "android.provider.Telephony.WAP_PUSH_RECEIVED" -> ServiceSynchro.MMS
            "android.intent.action.PHONE_STATE" -> ServiceSynchro.RAFALE.takeIf {
                intent.getStringExtra("state") == "IDLE" }
            Intent.ACTION_POWER_CONNECTED -> ServiceSynchro.CHARGE
            else -> null
        }
        if (intent.action != "android.intent.action.PHONE_STATE") Journal.log("réception : ${intent.action?.substringAfterLast('.')}")
        ServiceSynchro.demarrer(ctx, action, intent.action ?: "?")
    }
}

/** Une notification du téléphone (nouveau message vocal) : la messagerie est sondée tout de suite. */
class EcouteNotifications : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val paquet = sbn.packageName ?: return
        if (paquet.contains("dialer") || paquet.contains("telecom") || paquet == "com.android.phone" || paquet.contains("voicemail")) {
            ServiceSynchro.demarrer(this, ServiceSynchro.RAFALE, "notification")
        }
    }
}

/** WorkManager, sous contrainte réseau : vide la file quand le réseau revient, et relance le service s'il manque. */
class Vidange(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        ServiceSynchro.demarrer(applicationContext, origine = "WorkManager")
        return if (Synchro.de(applicationContext).vider(depuisTravail = true)) Result.success() else Result.retry()
    }
}
