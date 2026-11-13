package site.veridian.telephonie

import android.app.Service
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Binder
import android.os.IBinder
import android.os.Process
import org.json.JSONArray
import site.veridian.telephonie.contrat.Decoupe
import site.veridian.telephonie.contrat.Politique
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Transcription sur le téléphone, hors ligne, dans le processus `:transcription` : Parakeet TDT 0.6B v3 q8_0 par
 * whisper.cpp (JNI), en tronçons de 30 s coupés au milieu d'un silence, sans chevauchement, un fichier et un moteur
 * à la fois, le plus récent d'abord. Chaque tronçon fait est gardé : un arrêt (mémoire, batterie) reprend au
 * tronçon. Un appel neuf part dès qu'il arrive, sauf sous 10 % débranché (`Politique`) ; une retranscription en masse
 * attend le chargeur et 30 %, et cède la place à un appel neuf. Mémoire disponible vérifiée avant de charger le
 * modèle ; aucun autre parakeet-cli ou whisper-cli ne doit tourner (vu par le shell).
 *
 * Aucune minuterie : le fil dort jusqu'à un événement (demande déposée, branchement, changement de batterie qui
 * franchit un seuil). Seule une attente de mémoire ou d'un autre moteur, qui n'a pas d'événement, est retentée
 * (60 s, tant qu'elle dure).
 */
class ServiceTranscription : Service() {
    private lateinit var reglages: Reglages
    private lateinit var transcriptions: Transcriptions
    private var adb: Adb? = null
    private val signal = Object()
    @Volatile private var fil: Thread? = null
    private var contexte = 0L
    private var contexteDe: String? = null
    private var essai: File? = null

    override fun onCreate() {
        super.onCreate()
        Journal.init(this)
        reglages = Reglages(this)
        transcriptions = Transcriptions(this)
        adb = Adb(this)
        // Événements de batterie : un réveil seulement quand une décision change (seuils de 10 et 30 %, branché ou non).
        registerReceiver(object : android.content.BroadcastReceiver() {
            private var cle: String? = null
            override fun onReceive(c: android.content.Context, i: Intent) {
                val (n, ch) = batterieDe(i)
                val k = Politique.cleBatterie(n, ch, reglages.batterieMinNeufPct, reglages.batterieMinPct)
                if (k != cle) { val avant = cle; cle = k; if (avant != null) { Journal.log("transcription : batterie ${n ?: "?"} %, ${if (ch) "en charge" else "débranché"}"); reveiller() } }
            }
        }, IntentFilter().apply { addAction(Intent.ACTION_BATTERY_CHANGED); addAction(Intent.ACTION_POWER_CONNECTED); addAction(Intent.ACTION_POWER_DISCONNECTED) })
    }

    /** Un événement arrivé pendant un tour n'est jamais perdu : le fil ne s'endort pas s'il a été réveillé entre-temps. */
    @Volatile private var reveille = false
    private fun reveiller() = synchronized(signal) { reveille = true; signal.notifyAll() }

    override fun onBind(intent: Intent?): IBinder = Binder()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ESSAI) essai = File(intent.getStringExtra("fichier") ?: "")
        demarrer()
        return START_STICKY
    }

    private fun demarrer() {
        reveiller()
        if (fil?.isAlive == true) return
        fil = Thread({ boucle() }, "transcription").apply { start() }
    }

    private fun boucle() {
        // Nice 9, pas THREAD_PRIORITY_BACKGROUND (10) : à partir de 10, Android range le fil (et les fils de ggml qu'il
        // crée) dans le groupe d'arrière-plan, sur les petits cœurs : 34 s par minute d'appel mesurées le 12/11.
        Process.setThreadPriority(9)
        var inactifDepuis = System.currentTimeMillis()
        while (true) {
            reessayer = false
            reveille = false
            val travail = try { unTour() } catch (e: Throwable) { Journal.erreur("transcription", e); false }
            if (travail) { inactifDepuis = System.currentTimeMillis(); continue }
            if (contexte != 0L && System.currentTimeMillis() - inactifDepuis > 120_000) liberer()
            // Rien à faire, ou une attente qu'un événement lèvera (batterie, nouvelle demande) : on dort sans limite.
            // Modèle chargé : réveil à 2 min pour le libérer. Mémoire ou autre moteur : nouvel essai à 60 s.
            val delai = when { reessayer -> 60_000L; contexte != 0L -> 120_000L; else -> 0L }
            synchronized(signal) { if (!reveille) signal.wait(delai) }
        }
    }

    @Volatile private var reessayer = false
    private var derniereAttente: String? = null

    /** État lisible (écran, `etat`) ; une attente n'est journalisée qu'à son changement, pas à chaque réveil. */
    private fun attendre(pourquoi: String) {
        if (pourquoi != derniereAttente) { derniereAttente = pourquoi; Journal.log("transcription : en attente, $pourquoi") }
        transcriptions.poserEtat("en attente : $pourquoi")
    }

    /** Un fichier ; vrai s'il a été traité (fait ou en échec), faux s'il n'y a rien à faire maintenant. */
    private fun unTour(): Boolean {
        essai?.let { f -> essai = null; return essayer(f) }
        val demandes = transcriptions.lireDemandes()
        if (demandes.isEmpty()) { derniereAttente = null; transcriptions.poserEtat("au repos"); return false }
        if (reglages.miroir) { attendre("mode essai, rien n'est transcrit"); return false }
        if (!reglages.transcriptionVoulue) { attendre("option « Transcrire » désactivée dans l'app"); return false }
        if (!reglages.modele.exists()) { attendre("modèle absent (à télécharger dans l'app)"); return false }
        val (niveau, charge) = batterie()
        val neuves = demandes.filter { it.mode == "neuf" || it.mode == "maintenant" }
        val reprises = demandes.filter { it.mode == "en_charge" }
        val cible = neuves.firstOrNull { permise(it.mode, niveau, charge) } ?: reprises.firstOrNull { permise(it.mode, niveau, charge) }
            ?: run { attendre(politique((neuves.firstOrNull() ?: reprises.first()).mode, niveau, charge) ?: "?"); return false }
        if (!cible.audio.exists()) { transcriptions.retirer(cible.stem); return true }
        if (moteurEtranger()) { reessayer = true; attendre("un autre moteur de transcription tourne"); return false }
        if (!memoireSuffisante()) { reessayer = true; attendre("mémoire disponible insuffisante pour charger le modèle"); return false }
        derniereAttente = null
        val neuf = cible.mode == "neuf"
        val cede: () -> Boolean = when (cible.mode) {
            "neuf" -> { { batterie().let { (n, c) -> !permise("neuf", n, c) } } }
            "maintenant" -> { { transcriptions.lireDemandes().any { it.mode == "neuf" } || batterie().let { (n, c) -> !permise("neuf", n, c) } } }
            else -> { { transcriptions.lireDemandes().any { it.mode == "neuf" } || batterie().let { (n, c) -> !permise("en_charge", n, c) } } }
        }
        transcriptions.poserEtat("en cours" + if (neuf) "" else " (reprise)", cible.stem)
        Journal.log("transcription de ${cible.audio.name}" + if (neuf) "" else " (refaite)")
        try {
            val debut = System.currentTimeMillis()
            val lignes = transcrire(cible.audio, cede) ?: run {
                Journal.log("transcription de ${cible.audio.name} en pause (batterie, ou un appel neuf passe d'abord)"); return false }
            val id = Decoupe.idModele("parakeet", reglages.modele.name)
            val recette = Decoupe.recette(id, Transcriptions.OUTIL, reglages.tronconS, reglages.chevauchementS) +
                " · ${java.time.LocalDate.now()}"
            transcriptions.ecrire(cible.audio, lignes.ifEmpty { listOf(Decoupe.AUCUNE_PAROLE) }, id, recette)
            transcriptions.retirer(cible.stem)
            val secondes = (System.currentTimeMillis() - debut) / 1000
            Journal.log("transcription de ${cible.audio.name} prête ($secondes s)")
            transcriptions.poserEtat("au repos", derniere = org.json.JSONObject().put("stem", cible.stem).put("le", System.currentTimeMillis()).put("secondes", secondes))
            sendBroadcast(Intent(ServiceSynchro.TRANSCRIPTION_PRETE).setPackage(packageName)
                .putExtra("stem", cible.stem).putExtra("flux", cible.flux))
        } catch (e: EchecMoteur) {
            Journal.log("transcription de ${cible.audio.name} impossible : ${e.message}")
            transcriptions.echec(cible.audio, neuf, Decoupe.idModele("parakeet", reglages.modele.name))
            transcriptions.retirer(cible.stem)
        } catch (e: OutOfMemoryError) {
            // Appel trop long pour la mémoire du processus (vu le 12/11 : 1 h 42, 394 Mo d'un seul bloc). Sans ceci,
            // la demande était reprise chaque minute en charge : 5 min de décodage puis le même échec, sans fin.
            Journal.log("transcription de ${cible.audio.name} impossible : mémoire insuffisante pour cet audio")
            liberer()
            transcriptions.echec(cible.audio, neuf, Decoupe.idModele("parakeet", reglages.modele.name))
            transcriptions.retirer(cible.stem)
        }
        return true
    }

    class EchecMoteur(message: String) : Exception(message)

    /** Lignes de la transcription, ou null si elle a cédé la place (reprise au tronçon). */
    private fun transcrire(audio: File, cede: () -> Boolean): List<String>? {
        // Chargeur qui décroche (vu le 12/11 : sept reprises en 10 min) : céder avant de décoder ou de charger le modèle.
        if (cede()) return null
        val avantDecodage = System.currentTimeMillis()
        // En flux, mémoire bornée quelle que soit la durée : le PCM 16 kHz va sur disque, chaque tronçon en est relu.
        val pcm = pcm16k(audio)
        val total = pcm.length() / 2
        Journal.log("audio : ${"%.1f".format(java.util.Locale.ROOT, total / 16_000.0 / 60)} min décodées en ${System.currentTimeMillis() - avantDecodage} ms")
        val duree = total / 16_000.0
        val cible = reglages.tronconS
        val chevauchement = reglages.chevauchementS
        val travail = File(transcriptions.dossier, "${audio.nameWithoutExtension}.${reglages.modele.nameWithoutExtension}" +
            ".t${Decoupe.g(cible)}c${Decoupe.g(chevauchement)}.troncons").apply { mkdirs() }
        val plan = File(travail, "plan.json")
        val morceaux: List<Pair<Double, Double>> = if (plan.exists()) JSONArray(plan.readText()).let { a ->
            (0 until a.length()).map { a.getJSONArray(it).let { p -> p.getDouble(0) to p.getDouble(1) } } }
        else Decoupe.troncons(duree, Decoupe.DetecteurSilences().also { d -> Audio.parcourirPcm(pcm) { x, n -> d.pousser(x, n) } }.finir(),
            cible, cible / 4).also { m ->
            plan.writeText(JSONArray(m.map { JSONArray().put(it.first).put(it.second) }).toString()) }
        val restants = morceaux.indices.filter { !File(travail, "%04d.json".format(it)).exists() }
        if (restants.isNotEmpty()) { if (cede()) return null; charger() }
        val debut = System.currentTimeMillis()
        for (i in restants) {
            if (cede()) return null
            val (a, b) = morceaux[i]
            val depart = if (i > 0) maxOf(0.0, a - chevauchement) else a
            val de = (depart * 16_000).toLong().coerceIn(0, total)
            val jusqua = (b * 16_000).toLong().coerceIn(de, total)
            val morceau = Audio.lirePcm(pcm, de, (jusqua - de).toInt())
            val flottants = FloatArray(morceau.size) { morceau[it] / 32768f }
            val sortie = Parakeet.transcrire(contexte, flottants, reglages.fils) ?: throw EchecMoteur("parakeet a échoué sur le tronçon $i")
            val jetons = sortie.lineSequence().filter { it.isNotEmpty() }.map { l ->
                val (t0, t1, mot, texte) = l.split("\t", limit = 4)
                Decoupe.Jeton(t0.toLong() / 100.0, t1.toLong() / 100.0, texte, mot == "1")
            }.toList()
            val lignes = Decoupe.lignesDepuisJetons(jetons, depart, aPartirDe = if (i > 0 && chevauchement != 0.0) a else null)
            File(travail, "%04d.json".format(i)).writeText(JSONArray(lignes).toString())
        }
        if (restants.isNotEmpty()) {
            val audioS = restants.sumOf { morceaux[it].second - morceaux[it].first }
            val s = (System.currentTimeMillis() - debut) / 1000.0
            Journal.log("parakeet : ${restants.size} tronçons, ${"%.1f".format(java.util.Locale.ROOT, audioS / 60)} min d'audio en " +
                "${"%.0f".format(java.util.Locale.ROOT, s)} s (${"%.0f".format(java.util.Locale.ROOT, s / maxOf(audioS, 1.0) * 60)} s par minute)")
        }
        val lignes = morceaux.indices.flatMap { i -> JSONArray(File(travail, "%04d.json".format(i)).readText()).let { a -> (0 until a.length()).map { a.getString(it) } } }
        travail.deleteRecursively()
        pcm.delete()
        return lignes
    }

    /** PCM 16 kHz mono de l'audio, sur disque (gardé jusqu'à la fin de la transcription, reprise au tronçon). */
    private fun pcm16k(audio: File): File {
        val f = File(transcriptions.dossier, "${audio.nameWithoutExtension}.pcm16")
        if (f.exists()) return f
        File(transcriptions.dossier, "${audio.nameWithoutExtension}.pcm").delete()  // ancien format, tout en mémoire
        val t0 = System.currentTimeMillis()
        val (n, _) = Audio.versPcm(audio, f) { 16_000 }
        Journal.log("audio : décodage et rééchantillonnage en flux, ${n / 16_000} s en ${System.currentTimeMillis() - t0} ms")
        return f
    }

    private fun charger() {
        val modele = reglages.modele
        if (contexte != 0L && contexteDe == modele.path) return
        liberer()
        if (!modele.exists()) throw EchecMoteur("modèle absent : ${modele.path}")
        val debut = System.currentTimeMillis()
        contexte = Parakeet.charger(modele.path)
        if (contexte == 0L) throw EchecMoteur("modèle illisible : ${modele.name}")
        contexteDe = modele.path
        Journal.log("parakeet : modèle chargé en ${System.currentTimeMillis() - debut} ms (${Parakeet.infos().trim()}, ${reglages.fils} fils)")
    }

    private fun liberer() {
        if (contexte != 0L) { Parakeet.liberer(contexte); contexte = 0L; contexteDe = null; Journal.log("parakeet : modèle libéré") }
    }

    /** Essai sans CRM ni état : `essai-transcription.txt` dans le dossier externe, avec la durée. */
    private fun essayer(f: File): Boolean {
        if (moteurEtranger()) { Journal.log("essai : un autre moteur tourne, essai reporté"); essai = f; return false }
        val debut = System.currentTimeMillis()
        val lignes = try { transcrire(f) { false } } catch (e: Exception) { listOf("échec : ${e.message}") }
        val s = (System.currentTimeMillis() - debut) / 1000.0
        File(reglages.dossierExterne, "essai-transcription.txt").writeText(
            (lignes ?: emptyList()).joinToString("\n") + "\n# ${f.name} : ${"%.1f".format(java.util.Locale.ROOT, s)} s\n")
        Journal.log("essai de transcription de ${f.name} : ${"%.1f".format(java.util.Locale.ROOT, s)} s")
        return true
    }

    private fun permise(mode: String, niveau: Int?, charge: Boolean) =
        Politique.permise(mode, niveau, charge, reglages.batterieMinNeufPct, reglages.batterieMinPct)

    private fun politique(mode: String, niveau: Int?, charge: Boolean) =
        Politique.attente(mode, niveau, charge, reglages.batterieMinNeufPct, reglages.batterieMinPct)

    private fun batterie(): Pair<Int?, Boolean> =
        registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))?.let { batterieDe(it) } ?: (null to false)

    private fun batterieDe(i: Intent): Pair<Int?, Boolean> {
        val niveau = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1).takeIf { it >= 0 }?.let { it * 100 / i.getIntExtra(BatteryManager.EXTRA_SCALE, 100) }
        val s = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        return niveau to (s == BatteryManager.BATTERY_STATUS_CHARGING || s == BatteryManager.BATTERY_STATUS_FULL)
    }


    private fun memoireSuffisante(): Boolean {
        if (contexte != 0L) return true
        val libre = File("/proc/meminfo").readLines().firstOrNull { it.startsWith("MemAvailable:") }?.split(Regex("\\s+"))?.get(1)?.toLongOrNull() ?: 0
        return libre >= reglages.memoireMinKo
    }

    /** Un parakeet-cli ou whisper-cli d'ailleurs (banc d'essai, agent Termux) : un seul moteur à la fois. */
    private fun moteurEtranger(): Boolean = try {
        adb?.texte("pidof parakeet-cli whisper-cli || true", 15_000)?.trim()?.isNotEmpty() == true
    } catch (_: Exception) { false }

    companion object {
        const val TRAVAIL = "site.veridian.telephonie.TRAVAIL"
        const val ESSAI = "site.veridian.telephonie.ESSAI"
    }
}

/** whisper.cpp, cible `parakeet`, compilée par le NDK (src/main/cpp). */
object Parakeet {
    init { System.loadLibrary("telephonie_stt") }

    /** Contexte du modèle (0 si illisible). */
    @JvmStatic external fun charger(chemin: String): Long
    @JvmStatic external fun liberer(contexte: Long)
    @JvmStatic external fun infos(): String

    /** Jetons, une ligne par jeton : « t0\tt1\tdébut_de_mot(0|1)\ttexte » (centièmes de s) ; null si le moteur échoue. */
    @JvmStatic external fun transcrireOctets(contexte: Long, pcm: FloatArray, fils: Int): ByteArray?

    fun transcrire(contexte: Long, pcm: FloatArray, fils: Int): String? = transcrireOctets(contexte, pcm, fils)?.toString(Charsets.UTF_8)
}
