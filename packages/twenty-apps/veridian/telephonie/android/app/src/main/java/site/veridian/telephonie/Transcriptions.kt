package site.veridian.telephonie

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * État des transcriptions, partagé par les deux processus (fichiers dans `files/transcriptions/`), comme
 * `telephone.py` : `<stem>.txt` le texte (vide = échec réel, on ne relance pas), `<stem>.moteur`
 * « famille:modèle\trecette », `<stem>.anciennes.json` celles que l'outil avait posées (seules remplaçables au CRM).
 * Les demandes (`demandes/<stem>.json`) sont écrites par la synchronisation et prises par le processus de
 * transcription, du plus récent au plus ancien.
 */
class Transcriptions(ctx: Context) {
    val dossier = File(ctx.filesDir, "transcriptions").apply { mkdirs() }
    val demandes = File(dossier, "demandes").apply { mkdirs() }

    fun fichier(audio: File, suffixe: String = ".txt") = File(dossier, audio.nameWithoutExtension + suffixe)

    fun texte(audio: File): String = fichier(audio).let { if (it.exists()) site.veridian.telephonie.contrat.Contrat.pyStrip(it.readText()) else "" }

    /** Version de l'app : un échec du moteur est retenté une fois, et une seule, après une nouvelle version. */
    private val version: String = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).longVersionCode.toString() } catch (_: Exception) { "?" }

    /** Échec noté par une AUTRE version de l'app (ou avant que la version soit notée) : une nouvelle chance. */
    private fun echecAncien(audio: File): Boolean {
        val f = fichier(audio, ".moteur")
        if (!f.exists()) return false
        val champs = f.readText().trim().split("\t")
        return champs[0].startsWith("echec") && champs.getOrNull(1) != "v$version"
    }

    fun aTranscrire(audio: File) = !fichier(audio).exists() || (texte(audio).isEmpty() && echecAncien(audio))

    /** « parakeet:parakeet-tdt-0.6b-v3-q8_0 » ; vide si inconnu. */
    fun moteurDe(audio: File): String {
        val f = fichier(audio, ".moteur")
        if (!f.exists()) return ""
        val (famille, _, modele) = f.readText().trim().split("\t")[0].let { Triple(it.substringBefore(':'), ':', it.substringAfter(':', "")) }
        val m = if (famille in SOURCES && modele.endsWith(".bin")) site.veridian.telephonie.contrat.Decoupe.idModele(famille, modele) else modele
        return "$famille:$m"
    }

    private fun infos(audio: File): Pair<String?, String?> {
        if (texte(audio).isEmpty()) return null to null
        val (famille, modele) = moteurDe(audio).let { it.substringBefore(':') to it.substringAfter(':', "") }
        val source = SOURCES[famille]
        val f = fichier(audio, ".moteur")
        val detail = if (f.exists()) f.readText().trim().split("\t").drop(1) else emptyList()
        val moteur = if (source != null && (detail.isNotEmpty() || modele.isNotEmpty())) (detail.firstOrNull() ?: modele) else null
        return source to moteur
    }

    fun source(audio: File) = infos(audio).first
    fun moteur(audio: File) = infos(audio).second

    fun anciennes(audio: File): List<String> {
        val f = fichier(audio, ".anciennes.json")
        val liste = if (f.exists()) JSONArray(f.readText()).let { a -> (0 until a.length()).map { a.getString(it) } }.toMutableList() else mutableListOf()
        fichier(audio, ".ancienne.txt").let { if (it.exists()) liste += it.readText() }
        return liste
    }

    fun remplacements(audio: File): Map<String, Any?>? = anciennes(audio).takeIf { it.isNotEmpty() }?.let { mapOf("transcription" to it) }

    /** Transcription d'un autre modèle que celui voulu (ancien Parakeet, whisper), pas encore refaite. */
    fun aAmeliorer(audio: File, idVoulu: String) = fichier(audio).exists() && moteurDe(audio) != "parakeet:$idVoulu" &&
        (moteurDe(audio) != "echec-parakeet:$idVoulu" || echecAncien(audio))

    /** Reprise du CRM : un appel déjà transcrit (pixel-appels, Termux) ne repasse pas par un moteur. */
    fun reprendre(audio: File, texteCrm: String, sourceCrm: String?, moteurCrm: String?) {
        val f = fichier(audio)
        if (f.exists() && texte(audio).isNotEmpty()) return
        f.writeText(texteCrm)
        val famille = (sourceCrm ?: "").lowercase()
        if (famille in SOURCES && !moteurCrm.isNullOrEmpty()) fichier(audio, ".moteur").writeText("$famille:$moteurCrm\n")
    }

    /** Écrit une transcription faite ici : l'ancienne passe dans l'historique (seule remplaçable au CRM). */
    fun ecrire(audio: File, lignes: List<String>, idModele: String, recette: String) {
        val f = fichier(audio)
        if (f.exists() && f.readText().isNotBlank()) {
            val liste = anciennes(audio) + f.readText()
            fichier(audio, ".anciennes.json").writeText(JSONArray(liste).toString())
            fichier(audio, ".ancienne.txt").delete()
        }
        f.writeText(lignes.joinToString("\n") + "\n")
        fichier(audio, ".moteur").writeText("parakeet:$idModele\t$recette\n")
    }

    fun echec(audio: File, neuf: Boolean, idModele: String) {
        if (neuf) { fichier(audio).writeText(""); fichier(audio, ".moteur").writeText("echec:\tv$version\n") }
        else fichier(audio, ".moteur").writeText("echec-parakeet:$idModele\tv$version\n")
    }

    // ------------------------------------------------------------ demandes

    data class Demande(val stem: String, val audio: File, val mode: String, val flux: String)

    fun demander(audio: File, mode: String, flux: String) {
        val f = File(demandes, audio.nameWithoutExtension + ".json")
        if (f.exists() && mode == "en_charge") return
        val provisoire = File(demandes, ".${f.name}.part")
        provisoire.writeText(JSONObject().put("audio", audio.path).put("mode", mode).put("flux", flux).toString())
        provisoire.renameTo(f)
    }

    fun lireDemandes(): List<Demande> = (demandes.listFiles { f -> f.name.endsWith(".json") } ?: emptyArray()).mapNotNull {
        try {
            val j = JSONObject(it.readText())
            Demande(it.nameWithoutExtension, File(j.getString("audio")), j.optString("mode", "neuf"), j.optString("flux", "appels"))
        } catch (_: Exception) { it.delete(); null }
    }.sortedByDescending { it.stem }

    fun retirer(stem: String) { File(demandes, "$stem.json").delete() }

    companion object {
        val SOURCES = mapOf("parakeet" to "PARAKEET", "whisper" to "WHISPER")
        const val OUTIL = "libparakeet (whisper.cpp d2c6f05, jni)"
    }
}
