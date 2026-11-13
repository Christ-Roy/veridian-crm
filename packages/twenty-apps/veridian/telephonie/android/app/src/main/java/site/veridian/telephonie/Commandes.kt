package site.veridian.telephonie

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.io.File

/**
 * Commandes par adb, réservées au shell (permission DUMP) :
 *
 *   am broadcast -a site.veridian.telephonie.COMMANDE -n site.veridian.telephonie/.Commandes --es c <commande> [...]
 *
 *  - `demarrer` : démarre le service (il n'est pas exporté) ;
 *  - `configurer` : importe acces.json et reglages.json déposés dans /sdcard/Android/data/<paquet>/files/ (puis effacés) ;
 *  - `mode` --es valeur miroir|ecriture : passer en écriture oublie les empreintes (tout est replanifié une fois) ;
 *  - `etat` : écrit etat.json (aussi écrit seul par le service à chaque nouvelle ligne de journal), et copie délais et
 *    plan miroir dans le dossier externe (pour adb pull) ; le journal y est déjà, écrit en direct ;
 *  - `relire` [--ez complet true] : relit le téléphone ;
 *  - `retranscrire` --es fichier <stem,…> | --es depuis AAAA-MM-JJ [--es jusqua …] | --es moteur <texte> | --ez tout true
 *    [--ez maintenant true] : comme `telephone.py retranscrire` ;
 *  - `rattraper` [--es depuis AAAA-MM-JJ] : appels enregistrés sans transcription remis en file (72 h par défaut) ;
 *  - `essai-transcription` --es fichier <chemin audio> : transcrit sans toucher au CRM, résultat dans essai-transcription.txt.
 */
class Commandes : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val s = Synchro.de(ctx)
        val r = goAsync()
        Thread {
            try {
                val sortie = executer(ctx, s, intent)
                Journal.log("commande ${intent.getStringExtra("c")} : $sortie")
                r.resultData = sortie
            } catch (e: Exception) {
                Journal.erreur("commande ${intent.getStringExtra("c")}", e)
                r.resultData = "erreur : ${e.message}"
            } finally { r.finish() }
        }.start()
    }

    private fun executer(ctx: Context, s: Synchro, i: Intent): String = when (i.getStringExtra("c")) {
        "configurer" -> s.reglages.importer().also { s.adb.fermer(); ServiceSynchro.demarrer(ctx, origine = "configurer"); s.reconnecte() }
        "mode" -> {
            val v = i.getStringExtra("valeur") ?: error("valeur attendue : miroir ou ecriture")
            require(v == "miroir" || v == "ecriture") { "miroir ou ecriture" }
            val avant = s.reglages.mode
            s.reglages.mode = v
            if (v == "ecriture" && avant != "ecriture") { s.base.oublierTout(); s.signalerTout(complet = true) }
            ServiceSynchro.demarrer(ctx, origine = "mode")
            "mode $avant → $v"
        }
        "demarrer" -> { ServiceSynchro.demarrer(ctx, origine = "commande"); "service démarré" }
        "relire" -> { s.signalerTout(complet = i.getBooleanExtra("complet", false)); "relecture demandée" }
        "etat" -> etat(ctx, s).also { if (i.getBooleanExtra("synchro", false)) s.base.exporterSynchro(File(s.reglages.dossierExterne, "synchro.tsv")) }
        "effacer-exports" -> { listOf("synchro.tsv", "miroir.jsonl", "journal.log", "delais.tsv", "etat.json", "essai-transcription.txt")
            .forEach { File(s.reglages.dossierExterne, it).delete() }; "exports effacés" }
        "retranscrire" -> retranscrire(s, i)
        "rattraper" -> {
            val depuis = i.getStringExtra("depuis")?.let { java.time.LocalDate.parse(it).atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli() }
            val n = if (depuis != null) s.rattraper(depuis, "commande") else s.rattraper(origine = "commande")
            "$n transcription(s) remise(s) en file"
        }
        "essai-transcription" -> {
            val f = File(i.getStringExtra("fichier") ?: error("--es fichier"))
            ctx.startService(Intent(ctx, ServiceTranscription::class.java).setAction(ServiceTranscription.ESSAI).putExtra("fichier", f.path))
            "essai lancé sur ${f.name}"
        }
        else -> "commandes : configurer, mode, relire, etat, retranscrire, rattraper, essai-transcription"
    }

    private fun etat(ctx: Context, s: Synchro): String {
        val externe = s.reglages.dossierExterne.apply { mkdirs() }
        for (nom in listOf("delais.tsv", "miroir.jsonl")) {
            val f = File(ctx.filesDir, nom)
            if (f.exists()) f.copyTo(File(externe, nom), overwrite = true) else File(externe, nom).delete()
        }
        return exporterEtat(ctx, s).toString()
    }

    companion object {
        /** etat.json dans le dossier externe : réglages, file, adb, enregistrement, transcription. Sans donnée
         *  personnelle (un nom d'enregistrement n'est qu'une date et un sens). */
        fun exporterEtat(ctx: Context, s: Synchro): JSONObject {
            val j = JSONObject().put("le", java.time.LocalDateTime.now().toString()).put("reglages", s.reglages.resume())
                .put("file", s.base.taille()).put("televersements", s.base.taille("televersements"))
                .put("synchro", s.base.taille("synchro")).put("adb", s.adb.etat)
                .put("enregistrement", Enregistreur.instance?.resume() ?: "non vérifié")
                .put("transcription", s.transcriptions.resume()).put("transcription_etat", s.transcriptions.lireEtat() ?: JSONObject.NULL)
                .put("demandes_transcription", org.json.JSONArray(s.transcriptions.lireDemandes().map { "${it.stem}:${it.mode}:${it.audio.exists()}:${s.transcriptions.fichier(it.audio).exists()}" }))
                .put("curseurs", JSONObject().also { o -> Synchro.Flux.entries.forEach { f -> o.put(f.nom, s.base.lire("curseur.${f.nom}")) } })
                .put("version", ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName)
            try {
                val externe = s.reglages.dossierExterne.apply { mkdirs() }
                File(externe, ".etat.json.part").apply { writeText(j.toString(1)); renameTo(File(externe, "etat.json")) }
            } catch (e: Exception) { Journal.erreur("état exporté", e) }
            return j
        }
    }

    private fun retranscrire(s: Synchro, i: Intent): String {
        val fichiers = i.getStringExtra("fichier")?.split(",")?.map { it.trim().removeSuffix(".ogg") }?.toSet()
        val depuis = i.getStringExtra("depuis"); val jusqua = i.getStringExtra("jusqua"); val moteur = i.getStringExtra("moteur")
        val tout = i.getBooleanExtra("tout", false); val maintenant = i.getBooleanExtra("maintenant", false)
        if (fichiers == null && depuis == null && jusqua == null && moteur == null && !tout) return "préciser fichier, depuis/jusqua, moteur ou tout"
        val audios = s.sources.enregistrements(s.transcriptions).map { File(it.chemin) } +
            (File(s.ctx.filesDir, "messagerie").listFiles()?.filter { it.name.contains("_messagerie.") }?.sorted() ?: emptyList())
        val choisis = audios.filter { a -> s.transcriptions.fichier(a).exists() }.filter { a ->
            val stem = a.nameWithoutExtension
            val jour = "${stem.take(4)}-${stem.substring(4, 6)}-${stem.substring(6, 8)}"
            (fichiers == null || stem in fichiers) && (depuis == null || jour >= depuis) && (jusqua == null || jour <= jusqua) &&
                (moteur == null || moteur in (s.transcriptions.moteur(a) ?: s.transcriptions.moteurDe(a).ifEmpty { "inconnu" }))
        }
        choisis.forEach { s.transcriptions.demander(it, if (maintenant) "maintenant" else "en_charge", if (it.name.contains("_messagerie")) "messagerie" else "appels") }
        s.reveillerTranscription()
        return "${choisis.size} transcription(s) en file : " + choisis.take(10).joinToString(", ") { it.nameWithoutExtension }
    }

}
