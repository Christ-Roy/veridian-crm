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
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Transcription sur le téléphone, hors ligne, dans le processus `:transcription` : Parakeet TDT 0.6B v3 q8_0 par
 * whisper.cpp (JNI), en tronçons de 30 s coupés au milieu d'un silence, sans chevauchement, un fichier et un moteur
 * à la fois, le plus récent d'abord. Chaque tronçon fait est gardé : un arrêt (mémoire, batterie) reprend au
 * tronçon. Pause sous 30 % de batterie hors charge ; mémoire disponible vérifiée avant de charger le modèle ;
 * aucun autre parakeet-cli ou whisper-cli ne doit tourner (vu par le shell). Une retranscription en masse attend la
 * charge et cède la place à un appel neuf.
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
    }

    override fun onBind(intent: Intent?): IBinder = Binder()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ESSAI) essai = File(intent.getStringExtra("fichier") ?: "")
        demarrer()
        return START_STICKY
    }

    private fun demarrer() {
        synchronized(signal) { signal.notifyAll() }
        if (fil?.isAlive == true) return
        fil = Thread({ boucle() }, "transcription").apply { start() }
    }

    private fun boucle() {
        // Nice 9, pas THREAD_PRIORITY_BACKGROUND (10) : à partir de 10, Android range le fil (et les fils de ggml qu'il
        // crée) dans le groupe d'arrière-plan, sur les petits cœurs : 34 s par minute d'appel mesurées le 12/11.
        Process.setThreadPriority(9)
        var inactifDepuis = System.currentTimeMillis()
        while (true) {
            val travail = try { unTour() } catch (e: Throwable) { Journal.erreur("transcription", e); false }
            if (travail) { inactifDepuis = System.currentTimeMillis(); continue }
            if (contexte != 0L && System.currentTimeMillis() - inactifDepuis > 120_000) liberer()
            synchronized(signal) { signal.wait(60_000) }
        }
    }

    /** Un fichier ; vrai s'il a été traité (fait ou en échec), faux s'il n'y a rien à faire maintenant. */
    private fun unTour(): Boolean {
        essai?.let { f -> essai = null; return essayer(f) }
        val demandes = transcriptions.lireDemandes()
        if (demandes.isEmpty()) return false
        if (reglages.miroir) return false
        val (niveau, charge) = batterie()
        val permise = charge || (niveau != null && niveau >= reglages.batterieMinPct)
        val neuves = demandes.filter { it.mode == "neuf" || it.mode == "maintenant" }
        val cible = (if (permise) neuves.firstOrNull() else null) ?: (if (charge) demandes.firstOrNull { it.mode == "en_charge" } else null)
            ?: return false
        if (!cible.audio.exists()) { transcriptions.retirer(cible.stem); return true }
        if (moteurEtranger()) { Journal.log("transcription : un autre moteur tourne, attente"); return false }
        if (!memoireSuffisante()) { Journal.log("transcription : mémoire insuffisante, attente"); return false }
        val neuf = cible.mode == "neuf"
        val cede: () -> Boolean = when (cible.mode) {
            "neuf" -> { { !batteriePermise() } }
            "maintenant" -> { { transcriptions.lireDemandes().any { it.mode == "neuf" } || !batteriePermise() } }
            else -> { { transcriptions.lireDemandes().any { it.mode == "neuf" } || !batterie().second } }
        }
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
            Journal.log("transcription de ${cible.audio.name} prête (${(System.currentTimeMillis() - debut) / 1000} s)")
            sendBroadcast(Intent(ServiceSynchro.TRANSCRIPTION_PRETE).setPackage(packageName)
                .putExtra("stem", cible.stem).putExtra("flux", cible.flux))
        } catch (e: EchecMoteur) {
            Journal.log("transcription de ${cible.audio.name} impossible : ${e.message}")
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
        val pcm = pcm16k(audio)
        Journal.log("audio : ${"%.1f".format(java.util.Locale.ROOT, pcm.size / 16_000.0 / 60)} min décodées en ${System.currentTimeMillis() - avantDecodage} ms")
        val duree = pcm.size / 16_000.0
        val cible = reglages.tronconS
        val chevauchement = reglages.chevauchementS
        val travail = File(transcriptions.dossier, "${audio.nameWithoutExtension}.${reglages.modele.nameWithoutExtension}" +
            ".t${Decoupe.g(cible)}c${Decoupe.g(chevauchement)}.troncons").apply { mkdirs() }
        val plan = File(travail, "plan.json")
        val morceaux: List<Pair<Double, Double>> = if (plan.exists()) JSONArray(plan.readText()).let { a ->
            (0 until a.length()).map { a.getJSONArray(it).let { p -> p.getDouble(0) to p.getDouble(1) } } }
        else Decoupe.troncons(duree, Decoupe.silences(pcm), cible, cible / 4).also { m ->
            plan.writeText(JSONArray(m.map { JSONArray().put(it.first).put(it.second) }).toString()) }
        val restants = morceaux.indices.filter { !File(travail, "%04d.json".format(it)).exists() }
        if (restants.isNotEmpty()) { if (cede()) return null; charger() }
        val debut = System.currentTimeMillis()
        for (i in restants) {
            if (cede()) return null
            val (a, b) = morceaux[i]
            val depart = if (i > 0) maxOf(0.0, a - chevauchement) else a
            val de = (depart * 16_000).toInt().coerceIn(0, pcm.size)
            val jusqua = (b * 16_000).toInt().coerceIn(de, pcm.size)
            val flottants = FloatArray(jusqua - de) { pcm[de + it] / 32768f }
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
        File(transcriptions.dossier, "${audio.nameWithoutExtension}.pcm").delete()
        return lignes
    }

    /** PCM 16 kHz mono, gardé sur disque le temps de la transcription (un arrêt ne refait pas le décodage). */
    private fun pcm16k(audio: File): ShortArray {
        val f = File(transcriptions.dossier, "${audio.nameWithoutExtension}.pcm")
        if (f.exists()) {
            val octets = f.readBytes()
            return ShortArray(octets.size / 2).also { ByteBuffer.wrap(octets).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(it) }
        }
        val t0 = System.currentTimeMillis()
        val brut = Audio.decoder(audio)
        val t1 = System.currentTimeMillis()
        val pcm = Audio.reechantillonner(brut, 16_000)
        Journal.log("audio : décodage ${t1 - t0} ms (${brut.taux} Hz), rééchantillonnage ${System.currentTimeMillis() - t1} ms")
        val b = ByteBuffer.allocate(pcm.size * 2).order(ByteOrder.LITTLE_ENDIAN)
        b.asShortBuffer().put(pcm)
        File(f.path + ".part").apply { writeBytes(b.array()); renameTo(f) }
        return pcm
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

    private fun batterie(): Pair<Int?, Boolean> {
        val i = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return null to false
        val niveau = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1).takeIf { it >= 0 }?.let { it * 100 / i.getIntExtra(BatteryManager.EXTRA_SCALE, 100) }
        val s = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        return niveau to (s == BatteryManager.BATTERY_STATUS_CHARGING || s == BatteryManager.BATTERY_STATUS_FULL)
    }

    private fun batteriePermise() = batterie().let { (n, c) -> c || (n != null && n >= reglages.batterieMinPct) }

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
