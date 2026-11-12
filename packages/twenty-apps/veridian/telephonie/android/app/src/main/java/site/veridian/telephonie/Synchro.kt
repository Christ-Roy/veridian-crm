package site.veridian.telephonie

import android.content.Context
import android.content.Intent
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import site.veridian.telephonie.contrat.Contrat
import site.veridian.telephonie.contrat.Enregistrement
import java.io.File
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Le moteur : lire le téléphone (par type, incrémental), mettre en file, vider la file contre le CRM.
 *
 * Le brut d'abord, en parallèle (Robert, 12/11/2026) : un fil de lecture par type, un fil d'envoi des records,
 * deux fils de fichiers (audio, pièces jointes), la transcription dans un autre processus. Un SMS n'attend jamais un
 * audio ni une transcription. Le contrat (idSource, rapprochement à la seconde, compléter sans écraser, aucune
 * personne créée) est celui de `crm_telephonie.py`, porté dans le module `contrat`.
 *
 * Mode miroir : tout est lu et planifié contre le CRM réel, rien n'y est écrit ; le plan va dans `miroir.jsonl`.
 */
class Synchro private constructor(val ctx: Context) {
    val reglages = Reglages(ctx)
    val base = Base.de(ctx)
    val adb = Adb(ctx)
    val transcriptions = Transcriptions(ctx)
    val sources = Sources(ctx, reglages, adb)
    val acces = Acces(ctx, reglages)

    enum class Flux(val nom: String, val pluriel: String) {
        APPELS("appels", "appels"), SMS("sms", "textMessages"), MMS("mms", "textMessages"), MESSAGERIE("messagerie", "appels")
    }

    /** Null tant que l'accès manque ou attend une reconnexion : la file garde tout. */
    private fun twenty(): Twenty? {
        if (!reglages.configure || reglages.reconnexion != null) return null
        return Twenty(reglages.url!!, acces, essais = 2)
    }

    /** Après une connexion ou une reconnexion : tout ce qui attendait repart (le plan évite tout doublon). */
    fun reconnecte() {
        reglages.reconnexion = null
        Acces.effacerNotification(ctx)
        index = emptyMap(); indexLe = 0
        signalerTout()
        demanderVidange()
        televersements.forEach { it.reveiller() }
    }

    // ------------------------------------------------------------ lecture, un fil par type

    private class Demande(var complet: Boolean = false, val fenetres: MutableList<LongRange> = mutableListOf(), var signale: Long? = null)

    private val lecteurs = Flux.entries.associateWith { Executors.newSingleThreadExecutor() }
    private val demandes = HashMap<Flux, Demande>()

    /** Réveille la lecture d'un type. `fenetre` (ms) : relire aussi ces appels-là (enregistrement fini, transcription prête). */
    fun signaler(flux: Flux, complet: Boolean = false, fenetre: LongRange? = null) {
        val maintenant = System.currentTimeMillis()
        synchronized(demandes) {
            val d = demandes[flux]
            if (d != null) {
                d.complet = d.complet || complet; fenetre?.let { d.fenetres += it }; return
            }
            demandes[flux] = Demande(complet, fenetre?.let { mutableListOf(it) } ?: mutableListOf(), maintenant)
        }
        lecteurs.getValue(flux).execute {
            val d = synchronized(demandes) { demandes.remove(flux) } ?: return@execute
            try {
                lire(flux, d)
            } catch (e: Exception) {
                Journal.erreur("${flux.nom} : lecture", e)
            }
        }
    }

    fun signalerTout(complet: Boolean = false) = Flux.entries.forEach { signaler(it, complet) }

    private fun curseur(flux: Flux) = base.lire("curseur.${flux.nom}")?.toLongOrNull() ?: 0L

    private fun lire(flux: Flux, d: Demande) {
        val debut = System.currentTimeMillis()
        val curseur = curseur(flux)
        // 15 min de recouvrement : un SMS qui passe de la boîte d'envoi à « envoyé » ou « échec » est relu.
        val depuis = if (d.complet || curseur == 0L) 0L else curseur - 15 * 60_000
        val voulus: List<Enregistrement> = when (flux) {
            Flux.APPELS -> lireAppels(depuis, d.fenetres, d.complet || curseur == 0L)
            Flux.SMS -> sources.sms(depuis)
            Flux.MMS -> sources.mms(depuis)
            Flux.MESSAGERIE -> lireMessagerie() ?: return
        }
        var enfiles = 0
        var max = curseur
        val seuil = reglages.historiqueDepuisMs
        for (v in voulus) {
            val ms = Instant.parse((v["debutLe"] ?: v["envoyeLe"]) as String).toEpochMilli()
            if (flux != Flux.MESSAGERIE && ms > max) max = ms
            if (seuil > 0 && ms < seuil) continue
            val empreinte = Contrat.sha1(VERSION_PLAN + Json.canonique(v))
            if (base.enfiler(flux.pluriel, v["idSource"] as String, flux.nom, Json.texte(v), empreinte, Contrat.dateEvenement(v), d.signale)) enfiles++
        }
        if (max > curseur) base.ecrire("curseur.${flux.nom}", max.toString())
        if (enfiles > 0) {
            Journal.log("${flux.nom} : ${voulus.size} lus, $enfiles en file (${System.currentTimeMillis() - debut} ms" +
                (if (d.complet) ", relecture complète" else "") + ")")
            demanderVidange()
        }
    }

    private fun lireAppels(depuis: Long, fenetres: List<LongRange>, complet: Boolean): List<Enregistrement> {
        val parSource = LinkedHashMap<String, Enregistrement>()
        sources.appels(depuis).forEach { parSource[it["idSource"] as String] = it }
        fenetres.forEach { f -> sources.appels(f.first, f.last).forEach { parSource[it["idSource"] as String] = it } }
        val appels = parSource.values.toList()
        // Un enregistrement n'est associé que si tous les appels à ±90 s de lui sont lus (sinon il irait au mauvais).
        val marge = Contrat.TOLERANCE_ENREGISTREMENT_S * 1000L
        val couverts = if (complet) sources.enregistrements(transcriptions) else sources.enregistrements(transcriptions).filter { e ->
            (depuis > 0 && e.debutMs >= depuis + marge) || fenetres.any { e.debutMs >= it.first + marge && e.debutMs <= it.last - marge }
        }
        Contrat.associerEnregistrements(appels, couverts)
        for (a in appels) {
            @Suppress("UNCHECKED_CAST")
            val f = ((a["_fichiers"] as Map<String, List<String>>?)?.get("enregistrement"))?.firstOrNull()?.let { File(it) } ?: continue
            transcriptions.remplacements(f)?.let { a["_remplace"] = it }
            if (a["transcription"] != null) {
                transcriptions.source(f)?.let { a["sourceTranscription"] = it }
                transcriptions.moteur(f)?.let { a["moteurTranscription"] = it }
            }
        }
        return appels
    }

    private fun lireMessagerie(): List<Enregistrement>? = sources.vocaux(transcriptions)?.map { it.first }

    // ------------------------------------------------------------ envoi

    private val envoi = Executors.newSingleThreadExecutor()
    @Volatile private var vidangeDemandee = false
    private val verrouVidange = Any()

    fun demanderVidange() {
        if (vidangeDemandee) return
        vidangeDemandee = true
        envoi.execute { vidangeDemandee = false; vider() }
    }

    /** Vide la file ; rend vrai si elle est vide ou n'attend qu'un délai, faux si le CRM est injoignable. */
    fun vider(depuisTravail: Boolean = false): Boolean = synchronized(verrouVidange) {
        val tw = twenty() ?: run {
            Journal.log(if (reglages.reconnexion != null) "envoi : reconnexion à Twenty requise, ${base.taille()} en file"
                else "envoi : accès au CRM absent (écran de l'app)")
            return true
        }
        var tours = 0
        while (tours++ < 50) {
            val prets = base.prets(System.currentTimeMillis())
            if (prets.isEmpty()) break
            for ((pluriel, elements) in prets.groupBy { it.pluriel }) {
                try {
                    traiter(tw, pluriel, elements)
                } catch (e: ReconnexionRequise) {
                    // Rien n'est perdu ni compté comme échec : tout attend la reconnexion (notification affichée).
                    elements.forEach { base.reporter(it, 30_000, false) }
                    return true
                } catch (e: NonAbouti) {
                    elements.forEach { base.reporter(it, 30_000, false) }
                    Journal.log("envoi : CRM injoignable, ${base.taille()} en file, reprise au retour du réseau (${e.message})")
                    if (!depuisTravail) programmerTravail()
                    return false
                } catch (e: Refus) {
                    elements.forEach { base.reporter(it, minOf(300_000L, 30_000L shl minOf(it.essais, 4)), true) }
                    Journal.log("envoi : refusé par le CRM : ${e.message}")
                } catch (e: Exception) {
                    elements.forEach { base.reporter(it, minOf(300_000L, 30_000L shl minOf(it.essais, 4)), true) }
                    Journal.erreur("envoi", e)
                }
            }
        }
        if (!depuisTravail) base.prochainEssai()?.let { programmerTravail(maxOf(0L, it - System.currentTimeMillis())) }
        base.taille() == 0
    }

    private fun programmerTravail(apresMs: Long = 0) {
        val travail = OneTimeWorkRequestBuilder<Vidange>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInitialDelay(apresMs.coerceAtMost(600_000), TimeUnit.MILLISECONDS).build()
        WorkManager.getInstance(ctx).enqueueUniqueWork("vidange", ExistingWorkPolicy.REPLACE, travail)
    }

    @Suppress("UNCHECKED_CAST")
    private fun traiter(tw: Twenty, pluriel: String, elements: List<Base.Element>) {
        val debut = System.currentTimeMillis()
        val voulus = elements.map { Json.objet(it.voulu) }
        val existants = existants(tw, pluriel, voulus)
        val index = personnes(tw)
        if (pluriel == "appels") reprendreEtDemander(voulus, existants)
        val plan = Contrat.planifier(pluriel, voulus, existants, index)
        val parId = elements.associateBy { it.idSource }
        val aFaire = HashSet<String>()
        plan.creations.forEach { aFaire += it.corps["idSource"] as String }
        plan.complements.forEach { aFaire += it.idSource }
        val miroir = reglages.miroir
        if (miroir) {
            journaliserMiroir(pluriel, plan)
            for (c in plan.creations) parId[c.corps["idSource"]]?.let { noterDelai(it, "miroir", debut) }
            elements.forEach { base.termine(it, Json.objet(it.voulu)["_e164"] as String?) }
            return
        }
        // 1. le brut : records et champs, sans fichiers, en lots
        val creations = plan.creations.map { it.corps }
        for (lot in creations.chunked(50)) {
            tw.creerLot(pluriel, lot)
            lot.forEach { c -> parId[c["idSource"]]?.let { noterDelai(it, "ecriture", debut) } }
        }
        if (creations.isNotEmpty()) Journal.log("$pluriel : ${creations.size} créés en ${System.currentTimeMillis() - debut} ms")
        var completes = 0
        for (c in plan.complements) {
            if (c.champs.isNotEmpty()) { tw.modifier(pluriel, c.id, c.champs); completes++ }
            c.fichiers?.forEach { (champ, chemins) -> base.ajouterTeleversement(pluriel, c.id, c.idSource, champ, chemins) }
        }
        if (completes > 0) Journal.log("$pluriel : $completes complétés")
        if (plan.complements.any { it.fichiers != null }) televersements.forEach { it.reveiller() }
        // 2. vérification : ce qui a été écrit est replanifié (ses fichiers partent alors), le reste sort de la file
        for (e in elements) {
            val idSource = e.idSource
            val creeOuComplete = plan.creations.any { it.corps["idSource"] == idSource } ||
                plan.complements.any { it.idSource == idSource && it.champs.isNotEmpty() }
            when {
                idSource !in aFaire -> base.termine(e, Json.objet(e.voulu)["_e164"] as String?)
                base.televersementEnAttente(pluriel, idSource) -> base.reporter(e, 600_000, false)
                creeOuComplete && e.essais < 3 -> base.reporter(e, 1_000, true)
                else -> { Journal.log("$pluriel : complément qui ne prend pas, laissé"); base.termine(e, Json.objet(e.voulu)["_e164"] as String?) }
            }
        }
    }

    /** Les records du CRM qui peuvent correspondre : par fenêtre de dates (à la seconde), tout le type si la file est grosse. */
    private fun existants(tw: Twenty, pluriel: String, voulus: List<Map<String, Any?>>): List<Map<String, Any?>> {
        val filtreAppareil = "appareil[eq]:${reglages.appareil}"
        if (voulus.size > 40) return tw.toutLister(pluriel, filtreAppareil)
        val champ = if (pluriel == "appels") "debutLe" else "envoyeLe"
        val dates = voulus.map { Instant.parse(it[champ] as String) }
        val min = dates.min().epochSecond - 1
        val max = dates.max().epochSecond + 2
        return tw.toutLister(pluriel, "and($filtreAppareil,$champ[gte]:\"${Instant.ofEpochSecond(min)}\",$champ[lte]:\"${Instant.ofEpochSecond(max)}\")")
    }

    @Volatile private var index: Map<String, String> = emptyMap()
    @Volatile private var indexLe = 0L
    private val rafraichissement = Executors.newSingleThreadExecutor()
    @Volatile private var rafraichissementEnCours = false

    /** Index des numéros du CRM. Jamais sur le chemin critique : gardé sur disque (un redémarrage repart avec), rendu
     *  tout de suite, rafraîchi à côté toutes les 30 min. Seul le tout premier chargement, sans copie, attend. */
    private fun personnes(tw: Twenty): Map<String, String> {
        if (index.isEmpty()) chargerIndexDisque()
        if (index.isEmpty()) { rafraichirIndex(tw); return index }
        if (System.currentTimeMillis() - indexLe > 1_800_000 && !rafraichissementEnCours) {
            rafraichissementEnCours = true
            rafraichissement.execute { try { rafraichirIndex(tw) } catch (e: Exception) { Journal.erreur("personnes", e) } finally { rafraichissementEnCours = false } }
        }
        return index
    }

    private fun chargerIndexDisque() {
        val texte = base.lire("personnes.index") ?: return
        try {
            val j = org.json.JSONObject(texte)
            index = j.getJSONObject("index").let { o -> o.keys().asSequence().associateWith { o.getString(it) } }
            indexLe = j.getLong("le")
        } catch (_: Exception) {}
    }

    @Synchronized
    private fun rafraichirIndex(tw: Twenty) {
        val debut = System.currentTimeMillis()
        val nouveau = Contrat.indexTelephones(tw.toutLister("people")).first
        val apparus = nouveau.keys - index.keys
        val premier = index.isEmpty()
        index = nouveau; indexLe = System.currentTimeMillis()
        base.ecrire("personnes.index", org.json.JSONObject().put("le", indexLe).put("index", org.json.JSONObject(nouveau)).toString())
        Journal.log("personnes : ${nouveau.size} numéros en ${System.currentTimeMillis() - debut} ms")
        if (!premier && apparus.isNotEmpty()) {
            // Une personne ou un numéro ajouté au CRM : ses appels et messages déjà portés sont rattachés.
            val n = base.oublierNumeros(apparus)
            Journal.log("personnes : ${apparus.size} numéros nouveaux, $n événements à rattacher")
            if (n > 0) signalerTout(complet = true)
        }
    }

    /** Au démarrage du service : l'index part en avance, le premier événement ne l'attend pas. */
    fun prechauffer() = rafraichissement.execute {
        try { chargerIndexDisque(); twenty()?.let { if (System.currentTimeMillis() - indexLe > 1_800_000) rafraichirIndex(it) } }
        catch (e: Exception) { Journal.erreur("personnes (préchauffage)", e) }
    }

    /** Transcription déjà au CRM : reprise ; sinon, en écriture, demande au processus de transcription. */
    @Suppress("UNCHECKED_CAST")
    private fun reprendreEtDemander(voulus: List<Map<String, Any?>>, existants: List<Map<String, Any?>>) {
        val parSource = existants.associateBy { it["idSource"] }
        val parSeconde = existants.associateBy { Contrat.cleSeconde("appels", it) }
        var demandees = 0
        for (v in voulus) {
            val audio = (v["_fichiers"] as Map<String, List<String>>?)?.get("enregistrement")?.firstOrNull()?.let { File(it) } ?: continue
            if (v["sourceTranscription"] == "GOOGLE") continue
            val existant = parSource[v["idSource"]] ?: parSeconde[Contrat.cleSeconde("appels", v)]
            val texteCrm = existant?.get("transcription") as String?
            if (transcriptions.texte(audio).isEmpty() && !texteCrm.isNullOrBlank()) {
                transcriptions.reprendre(audio, texteCrm, existant?.get("sourceTranscription") as String?, existant?.get("moteurTranscription") as String?)
            } else if (!reglages.miroir && reglages.transcriptionActive && transcriptions.aTranscrire(audio)) {
                transcriptions.demander(audio, "neuf", if ((v["idSource"] as String).startsWith("messagerie:")) "messagerie" else "appels")
                demandees++
            }
        }
        if (demandees > 0) reveillerTranscription()
    }

    fun reveillerTranscription() {
        try {
            ctx.startService(Intent(ctx, ServiceTranscription::class.java).setAction(ServiceTranscription.TRAVAIL))
        } catch (e: Exception) { Journal.erreur("transcription : démarrage", e) }
    }

    /** Transcription prête (processus de transcription) : l'appel ou le message vocal est relu, puis complété. */
    fun transcriptionPrete(stem: String, flux: String) {
        if (flux == "messagerie") { signaler(Flux.MESSAGERIE); return }
        val (debut, _) = Contrat.lireNomJemrec(stem) ?: return
        signaler(Flux.APPELS, fenetre = (debut - 180_000)..(debut + 180_000))
    }

    /** En charge : refaire celles d'un autre modèle (ancien Parakeet, whisper), comme `ameliorer_anciennes`. */
    fun demanderAmeliorations() {
        if (reglages.miroir || !reglages.ameliorerAnciennes || !reglages.transcriptionActive) return
        val id = site.veridian.telephonie.contrat.Decoupe.idModele("parakeet", reglages.modele.name)
        val audios = sources.enregistrements(transcriptions).map { File(it.chemin) } +
            (File(ctx.filesDir, "messagerie").listFiles()?.toList() ?: emptyList())
        var n = 0
        for (a in audios) if (transcriptions.aAmeliorer(a, id) && transcriptions.texte(a).isNotEmpty()) {
            transcriptions.demander(a, "en_charge", if (a.name.contains("_messagerie")) "messagerie" else "appels"); n++
        }
        if (n > 0) { Journal.log("transcription : $n à refaire en ${id} (en charge)"); reveillerTranscription() }
    }

    private fun noterDelai(e: Base.Element, mode: String, debutCycle: Long) {
        val moment = e.evenement ?: return
        val fin = System.currentTimeMillis() / 1000.0
        if (fin - moment >= 3600) return
        Journal.delai(e.flux, fin - moment, mode)
        val detecte = e.signale?.let { (System.currentTimeMillis() - it) / 1000.0 }
        Journal.log("${e.flux} : ${if (mode == "miroir") "aurait été créé" else "créé"} ${"%.1f".format(java.util.Locale.ROOT, fin - moment)} s " +
            "après l'événement (détecté il y a ${detecte?.let { "%.1f".format(java.util.Locale.ROOT, it) } ?: "?"} s, " +
            "envoi ${(System.currentTimeMillis() - debutCycle)} ms)")
    }

    /** Le plan du mode miroir, une ligne par action, dans les fichiers privés (copié par la commande `etat`). */
    private fun journaliserMiroir(pluriel: String, plan: Contrat.Plan) {
        val f = File(ctx.filesDir, "miroir.jsonl")
        val le = Instant.now().toString()
        val lignes = StringBuilder()
        for (c in plan.creations) lignes.append(Json.texte(mapOf("le" to le, "pluriel" to pluriel, "action" to "creer",
            "idSource" to c.corps["idSource"], "champs" to c.corps, "fichiers" to c.fichiers?.mapValues { it.value.size }))).append('\n')
        for (c in plan.complements) lignes.append(Json.texte(mapOf("le" to le, "pluriel" to pluriel, "action" to "completer",
            "idSource" to c.idSource, "id" to c.id, "champs" to c.champs, "fichiers" to c.fichiers?.mapValues { it.value.size }))).append('\n')
        if (lignes.isNotEmpty()) f.appendText(lignes.toString())
    }

    // ------------------------------------------------------------ fichiers : deux fils (audio, pièces jointes)

    inner class FilFichiers(private val audio: Boolean) : Thread("televersement-${if (audio) "audio" else "pieces"}") {
        private val signal = Object()
        fun reveiller() = synchronized(signal) { signal.notifyAll() }

        override fun run() {
            while (true) {
                val t = base.prochainTeleversement(audio, System.currentTimeMillis())
                val tw = twenty()
                if (t == null || tw == null || reglages.miroir) { synchronized(signal) { signal.wait(60_000) }; continue }
                val seuil = reglages.echecsAvantWifi
                if (seuil > 0 && t.essais >= seuil && reseauFacture()) {
                    // `audio_wifi_apres_echecs` échecs de suite sur réseau facturé : le fichier attend un réseau non
                    // facturé (le record et le texte sont déjà partis). 0 (défaut, forfait illimité de Robert) : tout réseau.
                    base.televersementAttendWifi(t.id, 600_000)
                    programmerWifi()
                    Journal.log("fichier : ${t.essais} échecs sur réseau mobile, attend le Wi-Fi")
                    continue
                }
                val debut = System.currentTimeMillis()
                try {
                    val portes = t.chemins.map { File(it) }.filter { it.exists() }.map { porter(tw, t.champ, it) }
                    if (portes.isEmpty()) { base.televersementFait(t.id); continue }
                    tw.modifier(t.pluriel, t.recordId, mapOf(t.champ to portes))
                    base.televersementFait(t.id)
                    Journal.log("${t.pluriel} : ${portes.size} fichier(s) porté(s) en ${System.currentTimeMillis() - debut} ms")
                    base.reveiller(t.pluriel, t.idSource)
                    demanderVidange()
                } catch (e: ReconnexionRequise) {
                    continue  // twenty() rend null au tour suivant : le fil attend la reconnexion
                } catch (e: NonAbouti) {
                    // Sans limite tant que le record existe : 30 s, 1, 2, 4… jusqu'à 30 min entre deux essais.
                    val delai = minOf(1_800_000L, 30_000L shl minOf(t.essais, 6))
                    base.televersementReporte(t.id, delai)
                    Journal.log("fichier remis à ${delai / 1000} s (essai ${t.essais + 1}) : ${e.message}")
                    programmerTravail(delai)
                } catch (e: Exception) {
                    base.televersementReporte(t.id, minOf(300_000L, 30_000L shl minOf(t.essais, 4)))
                    Journal.erreur("fichier refusé, retenté", e)
                }
            }
        }

        private fun porter(tw: Twenty, champ: String, source: File): Map<String, Any?> {
            var envoye = source
            if (champ == "enregistrement") {
                val illisible = source.extension.lowercase() in setOf("amr", "awb", "3gp")
                val opus = Audio.versOpus(source, File(ctx.cacheDir, "${source.nameWithoutExtension}.${System.nanoTime()}.ogg"))
                if (opus != null && (illisible || opus.length() < source.length())) envoye = opus else opus?.delete()
            }
            try {
                val nom = source.nameWithoutExtension + "." + envoye.extension
                return mapOf("fileId" to tw.televerser(envoye, Contrat.CHAMPS_FICHIERS.getValue(champ), nom), "label" to nom)
            } finally {
                if (envoye != source) envoye.delete()
            }
        }
    }

    private fun reseauFacture(): Boolean {
        val cm = ctx.getSystemService(android.net.ConnectivityManager::class.java)
        return cm.isActiveNetworkMetered
    }

    /** Réseau non facturé (Wi-Fi) : les fichiers qui l'attendaient repartent. */
    fun reveillerFichiers() {
        base.televersementsLibres()
        televersements.forEach { it.reveiller() }
    }

    private fun programmerWifi() {
        val travail = OneTimeWorkRequestBuilder<Vidange>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build()).build()
        WorkManager.getInstance(ctx).enqueueUniqueWork("fichiers-wifi", ExistingWorkPolicy.KEEP, travail)
    }

    val televersements = listOf(FilFichiers(true), FilFichiers(false)).onEach { it.isDaemon = true; it.start() }

    companion object {
        /** Changer les règles du plan change toutes les empreintes : tout est replanifié une fois. */
        const val VERSION_PLAN = "2026-11-12-apk"

        @Volatile private var instance: Synchro? = null
        fun de(ctx: Context): Synchro = instance ?: synchronized(this) { instance ?: Synchro(ctx.applicationContext).also { instance = it } }
    }
}
