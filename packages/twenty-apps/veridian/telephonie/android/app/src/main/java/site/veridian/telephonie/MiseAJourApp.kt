package site.veridian.telephonie

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.telephony.TelephonyManager
import site.veridian.telephonie.contrat.MiseAJour
import site.veridian.telephonie.contrat.MiseAJour.Action
import site.veridian.telephonie.contrat.MiseAJour.Lecture
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors

/**
 * L'app se met à jour elle-même : manifeste public lu au démarrage, au retour du réseau et au plus une fois par jour,
 * APK téléchargé hors réseau limité, vérifié, puis installé par PackageInstaller. Les décisions sont dans
 * `contrat/MiseAJour.kt`. Un seul fil ; aucun réveil propre : tout part d'un événement du service.
 *
 * Sans geste (Android 12 et plus) quand l'app a le droit d'installer (« Installer des applis inconnues », donné une fois) :
 * elle se met à jour elle-même et le déclare. Sinon Android demande un accord : une notification, un toucher.
 */
class MiseAJourApp(private val synchro: Synchro) {
    private val ctx get() = synchro.ctx
    private val base get() = synchro.base
    private val reglages get() = synchro.reglages
    private val fil = Executors.newSingleThreadExecutor { r -> Thread(r, "mise-a-jour").apply { isDaemon = true } }
    private val dossier get() = File(ctx.filesDir, "maj")
    @Volatile var etat: String = "pas encore vérifiée"; private set
    @Volatile var finAppelMs = 0L
    @Volatile private var prevu = false

    /** Un événement du service (démarrage, réseau, fin d'appel, filet) : au plus une lecture par jour. */
    fun evenement(origine: String) {
        if (prevu) return
        prevu = true
        fil.execute { prevu = false; passer(origine, manuel = false) }
    }

    /** Bouton « Vérifier » : lecture tout de suite. Réseau limité, appel et coupe-circuit valent toujours. */
    fun verifierMaintenant() { etat = "vérification…"; fil.execute { passer("bouton", manuel = true) } }

    /** Au démarrage : la version a-t-elle changé ? Journalisé, fichiers et notification de la mise à jour retirés. */
    fun noterVersion() = fil.execute {
        val code = installe().versionCode.toString()
        val avant = base.lire("maj.version")
        if (avant != null && avant != code) {
            Journal.log("mise à jour : $avant → $code (${version(ctx)}), ${base.taille()} en file")
            dossier.deleteRecursively()
            base.ecrire("maj.echecs", ""); base.ecrire("maj.geste", "0")
            notifications().cancel(NOTIF)
        }
        base.ecrire("maj.version", code)
    }

    private fun passer(origine: String, manuel: Boolean) {
        try {
            val canal = reglages.canalMaj
            val maintenant = System.currentTimeMillis()
            // Canal changé : ce qui a été lu pour l'autre ne vaut plus.
            if (base.lire("maj.canal") != canal.valeur) { base.ecrire("maj.manifeste", ""); base.ecrire("maj.lu", "0"); base.ecrire("maj.essai", "0"); base.ecrire("maj.canal", canal.valeur) }
            if (manuel || MiseAJour.doitLire(nombre("maj.lu"), nombre("maj.essai"), maintenant)) lireManifeste(canal)
            var d = decider(canal, manuel) ?: run { poser("manifeste pas encore lu"); return }
            if (d.action == Action.TELECHARGER) {
                poser(d.raison)
                telecharger((lecture(canal) as Lecture.Bon).m)
                d = decider(canal, manuel) ?: return
            }
            if (d.action == Action.INSTALLER) {
                // Le coupe-circuit vaut jusqu'au dernier moment : pas d'installation sur un manifeste vieux de plus de 10 min.
                if (!MiseAJour.frais(nombre("maj.lu"), System.currentTimeMillis()) && !lireManifeste(canal)) { poser("prête, attend de relire le manifeste"); return }
                d = decider(canal, manuel) ?: return
            }
            if (d.action == Action.INSTALLER) { poser(d.raison); installer((lecture(canal) as Lecture.Bon).m) } else poser(d.raison)
            if (lecture(canal) is Lecture.Suspendu) abandonner()
        } catch (e: Exception) {
            Journal.erreur("mise à jour ($origine)", e)
            etat = "non vérifiée : ${e.message?.take(120)}"
        }
    }

    private fun poser(texte: String) {
        if (texte != etat) Journal.log("mise à jour : $texte")
        etat = texte
    }

    private fun nombre(cle: String) = base.lire(cle)?.toLongOrNull() ?: 0L

    // ------------------------------------------------------------ manifeste

    private fun lecture(canal: MiseAJour.Canal): Lecture? {
        val texte = base.lire("maj.manifeste")?.takeIf { it.isNotEmpty() } ?: return null
        return try { MiseAJour.lire(Json.objet(texte), canal) } catch (_: org.json.JSONException) { Lecture.Refuse("manifeste illisible") }
    }

    private fun lireManifeste(canal: MiseAJour.Canal): Boolean {
        base.ecrire("maj.essai", System.currentTimeMillis().toString())
        return try {
            val octets = java.io.ByteArrayOutputStream()
            lirePublic(MiseAJour.adresseManifeste(canal), 64_000) { b, n -> octets.write(b, 0, n) }
            base.ecrire("maj.manifeste", octets.toString(Charsets.UTF_8.name()))
            base.ecrire("maj.lu", System.currentTimeMillis().toString())
            true
        } catch (e: IOException) { Journal.log("mise à jour : manifeste non lu (${e.message})"); false }
    }

    /**
     * Seule connexion de ce fichier : une lecture publique, sans accès ni cookie. L'agent est fixe, car celui d'Android nomme
     * le modèle et la version du téléphone. L'hébergeur voit une adresse IP, comme pour toute page.
     */
    private fun lirePublic(adresse: String, plafond: Long, recevoir: (ByteArray, Int) -> Unit) {
        val cnx = URL(adresse).openConnection() as HttpURLConnection
        try {
            cnx.connectTimeout = 10_000; cnx.readTimeout = 60_000; cnx.useCaches = false
            cnx.setRequestProperty("User-Agent", AGENT)
            if (cnx.responseCode != 200) throw IOException("HTTP ${cnx.responseCode}")
            if (cnx.url.protocol != "https") throw IOException("connexion non chiffrée")
            var total = 0L
            cnx.inputStream.use { i ->
                val b = ByteArray(1 shl 16)
                while (true) {
                    val n = i.read(b); if (n < 0) break
                    total += n; if (total > plafond) throw IOException("plus gros qu'annoncé")
                    recevoir(b, n)
                }
            }
        } finally { cnx.disconnect() }
    }

    // ------------------------------------------------------------ décision

    private fun decider(canal: MiseAJour.Canal, manuel: Boolean): MiseAJour.Decision? {
        val lecture = lecture(canal) ?: return null
        val sha = (lecture as? Lecture.Bon)?.m?.sha256
        return MiseAJour.decider(lecture, MiseAJour.Telephone(
            versionCode = installe().versionCode, sdk = Build.VERSION.SDK_INT, tranche = MiseAJour.tranche(graine()), auto = reglages.majAuto,
            nonLimite = nonLimite(), occupe = occupation(), fichierSha256 = base.lire("maj.pret")?.takeIf { it.isNotEmpty() && apk(it).exists() },
            echecs = base.lire("maj.echecs")?.takeIf { sha != null && it.startsWith("$sha:") }?.substringAfter(':')?.toIntOrNull() ?: 0,
            gesteAttendu = System.currentTimeMillis() - nombre("maj.geste") in 0 until MiseAJour.JOUR_MS, manuel = manuel))
    }

    /** Tirée une fois au hasard, gardée sur l'appareil, jamais envoyée : elle ne sert qu'au déploiement progressif. */
    private fun graine() = base.lire("maj.graine") ?: UUID.randomUUID().toString().also { base.ecrire("maj.graine", it) }

    private fun nonLimite(): Boolean {
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun occupation(): String? {
        val appel = try { ctx.getSystemService(TelephonyManager::class.java).callStateForSubscription } catch (_: SecurityException) { null }
        val transcription = synchro.transcriptions.lireEtat()
        val ecrit = reglages.jemrec.listFiles()?.maxOfOrNull { it.lastModified() } ?: 0L
        return MiseAJour.occupation(appel, ctx.getSystemService(AudioManager::class.java).mode, finAppelMs, ecrit,
            transcription != null && !transcription.isNull("en_cours"), transcription?.optLong("ecrit") ?: 0L, System.currentTimeMillis())
    }

    // ------------------------------------------------------------ téléchargement et vérifications

    private fun apk(sha: String) = File(dossier, "$sha.apk")

    private fun telecharger(m: MiseAJour.Manifeste) {
        dossier.deleteRecursively(); dossier.mkdirs()
        base.ecrire("maj.pret", "")
        val part = File(dossier, "telechargement.part")
        val md = MessageDigest.getInstance("SHA-256")
        var morceaux = 0
        part.outputStream().use { s ->
            lirePublic(m.url, m.taille) { b, n ->
                // Le réseau passe en limité, un appel arrive : on s'arrête, on reprendra au prochain événement.
                if (!nonLimite()) throw IOException("réseau devenu limité")
                if (morceaux++ % 16 == 0) occupation()?.let { throw IOException(it) }
                s.write(b, 0, n); md.update(b, 0, n)
            }
        }
        val faute = MiseAJour.verifierFichier(m, part.length(), md.digest().hex()) ?: MiseAJour.verifierApk(m, lirePaquet(part), installe())
        if (faute != null) {
            part.delete(); compterEchec(m, "téléchargement refusé : $faute")
            return
        }
        if (!part.renameTo(apk(m.sha256))) throw IOException("fichier non rangé")
        base.ecrire("maj.pret", m.sha256)
        Journal.log("mise à jour : version ${m.versionName} téléchargée et vérifiée")
    }

    private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }

    private fun compterEchec(m: MiseAJour.Manifeste, raison: String) {
        val n = (base.lire("maj.echecs")?.takeIf { it.startsWith("${m.sha256}:") }?.substringAfter(':')?.toIntOrNull() ?: 0) + 1
        base.ecrire("maj.echecs", "${m.sha256}:$n")
        base.ecrire("maj.pret", "")
        Journal.log("mise à jour : $raison (échec $n)")
    }

    private fun installe(): MiseAJour.Paquet =
        paquet(ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNING_CERTIFICATES))

    private fun lirePaquet(f: File): MiseAJour.Paquet? =
        ctx.packageManager.getPackageArchiveInfo(f.path, PackageManager.GET_SIGNING_CERTIFICATES)?.let { paquet(it) }

    /** Empreintes des signataires actuels ; vide si Android ne les rend pas (refus). */
    private fun paquet(p: PackageInfo): MiseAJour.Paquet = MiseAJour.Paquet(p.packageName, p.longVersionCode,
        p.signingInfo?.apkContentsSigners.orEmpty().map { MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).hex() }.toSet())

    // ------------------------------------------------------------ installation

    private fun installer(m: MiseAJour.Manifeste) {
        val f = apk(m.sha256)
        MiseAJour.verifierApk(m, lirePaquet(f), installe())?.let { compterEchec(m, "installation refusée : $it"); poser("refusée : $it"); return }
        abandonner()
        val pi = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(MiseAJour.PAQUET)
            setSize(m.taille)
            setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = pi.createSession(params)
        pi.openSession(id).use { s ->
            val md = MessageDigest.getInstance("SHA-256")
            var total = 0L
            s.openWrite("telephonie-crm.apk", 0, m.taille).use { sortie ->
                f.inputStream().use { i ->
                    val b = ByteArray(1 shl 16)
                    while (true) { val n = i.read(b); if (n < 0) break; sortie.write(b, 0, n); md.update(b, 0, n); total += n }
                }
                s.fsync(sortie)
            }
            // Ce sont les octets remis à Android qui sont vérifiés, pas le fichier d'il y a une heure.
            val faute = MiseAJour.verifierFichier(m, total, md.digest().hex())
            if (faute != null) { s.abandon(); compterEchec(m, "installation refusée : $faute"); poser("refusée : $faute"); return }
            occupation()?.let { s.abandon(); poser("version ${m.versionName} prête : $it"); return }
            Journal.log("mise à jour : version ${m.versionName} remise à Android, ${base.taille()} en file (gardés)")
            val retour = Intent(ctx, ResultatInstallation::class.java).putExtra("sha256", m.sha256).putExtra("version", m.versionName)
            s.commit(PendingIntent.getBroadcast(ctx, id, retour, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE).intentSender)
        }
    }

    /** Sessions d'avant (refusées, oubliées, suspendues) : retirées, avec leur notification. */
    private fun abandonner() {
        val pi = ctx.packageManager.packageInstaller
        pi.mySessions.forEach { try { pi.abandonSession(it.sessionId) } catch (_: Exception) {} }
        notifications().cancel(NOTIF)
    }

    private fun notifications() = ctx.getSystemService(NotificationManager::class.java)

    /** Réponse d'Android à l'installation. Une réussite tue ce processus : la suite est dans `noterVersion`. */
    fun resultat(statut: Int, texte: String?, confirmer: Intent?, sha: String, version: String) = fil.execute {
        when (statut) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                base.ecrire("maj.geste", System.currentTimeMillis().toString())
                poser("version $version prête : Android attend votre accord (notification)")
                if (confirmer != null) notifier(version, confirmer)
            }
            PackageInstaller.STATUS_SUCCESS -> poser("version $version installée")
            PackageInstaller.STATUS_FAILURE_ABORTED -> {
                // Refus de l'utilisateur : pas un échec, on redemandera demain.
                base.ecrire("maj.geste", System.currentTimeMillis().toString())
                poser("version $version : installation refusée sur le téléphone, proposée de nouveau demain")
            }
            else -> {
                val n = (base.lire("maj.echecs")?.takeIf { it.startsWith("$sha:") }?.substringAfter(':')?.toIntOrNull() ?: 0) + 1
                base.ecrire("maj.echecs", "$sha:$n")
                poser("version $version non installée par Android : ${texte ?: "statut $statut"}")
            }
        }
    }

    private fun notifier(version: String, confirmer: Intent) {
        notifications().createNotificationChannel(NotificationChannel(CANAL, "Mise à jour de l'app", NotificationManager.IMPORTANCE_DEFAULT))
        val ouvrir = PendingIntent.getActivity(ctx, NOTIF, confirmer.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val texte = "Une nouvelle version est prête. Vos appels, vos SMS en attente et votre connexion sont gardés."
        notifications().notify(NOTIF, Notification.Builder(ctx, CANAL).setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("Mise à jour de Téléphonie CRM").setContentText(texte)
            .setStyle(Notification.BigTextStyle().bigText("$texte (version $version)")).setContentIntent(ouvrir).setAutoCancel(true)
            .addAction(Notification.Action.Builder(null, "Installer", ouvrir).build()).build())
    }

    companion object {
        const val AGENT = "TelephonieCRM"
        const val CANAL = "maj"
        const val NOTIF = 5

        fun version(ctx: Context): String = ctx.packageManager.getPackageInfo(ctx.packageName, 0).let { "${it.versionName} (code ${it.longVersionCode})" }

        /** L'utilisateur a donné à l'app le droit d'installer (« Installer des applis inconnues ») : sans lui, un geste à chaque fois. */
        fun silencieuse(ctx: Context): Boolean = ctx.packageManager.canRequestPackageInstalls()
    }
}

class ResultatInstallation : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        Journal.init(ctx)
        val confirmer = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
            else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
        Synchro.de(ctx).misesAJour.resultat(intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE),
            intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE), confirmer, intent.getStringExtra("sha256") ?: "", intent.getStringExtra("version") ?: "")
    }
}
