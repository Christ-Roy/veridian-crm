package site.veridian.telephonie.contrat

import java.math.BigDecimal
import java.math.RoundingMode
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/**
 * Contrat du CRM, porté à l'identique de `ingestion/crm_telephonie.py` (et des fonctions de `telephone.py` qui
 * en dépendent). Un écart ici crée des doublons ou écrase une retouche faite à la main : chaque fonction est
 * vérifiée contre les sorties du Python (`outils/fixtures_contrat.py` → `src/test/resources/fixtures.json`).
 *
 * Un enregistrement est une `MutableMap<String, Any?>` aux clés du CRM ; les clés `_e164`, `_ms`, `_fichiers`
 * (champ FILES → chemins) et `_remplace` (champ → anciennes valeurs posées par l'outil) restent locales.
 */
typealias Enregistrement = MutableMap<String, Any?>

object Contrat {
    val TYPES_APPEL = mapOf("1" to "ENTRANT", "2" to "SORTANT", "3" to "MANQUE", "4" to "MESSAGERIE", "5" to "REJETE",
        "6" to "BLOQUE", "7" to "ENTRANT")
    val TYPES_SMS = mapOf("1" to "RECU", "2" to "ENVOYE", "3" to "BROUILLON", "4" to "ENVOYE", "5" to "ECHEC",
        "6" to "ENVOYE")
    val LIBELLES_DIRECTION = mapOf("ENTRANT" to "Entrant", "SORTANT" to "Sortant", "MANQUE" to "Manqué",
        "MESSAGERIE" to "Messagerie", "REJETE" to "Rejeté", "BLOQUE" to "Bloqué", "AUTRE" to "Appel")
    val LIBELLES_SENS = mapOf("RECU" to "Reçu", "ENVOYE" to "Envoyé", "BROUILLON" to "Brouillon", "ECHEC" to "Échec")
    const val TOLERANCE_ENREGISTREMENT_S = 90
    const val MAX_PIECES_JOINTES = 10
    const val ENREGISTREMENT_FIELD_UNIVERSAL_IDENTIFIER = "c01c8436-0ce4-4d41-b142-e067326f3236"
    const val PIECES_JOINTES_FIELD_UNIVERSAL_IDENTIFIER = "5ba4ce60-1e5b-4abc-86c8-e5fa019a077c"
    val CHAMPS_FICHIERS = mapOf("enregistrement" to ENREGISTREMENT_FIELD_UNIVERSAL_IDENTIFIER,
        "piecesJointes" to PIECES_JOINTES_FIELD_UNIVERSAL_IDENTIFIER)
    val CHAMPS = mapOf(
        "appels" to listOf("titre", "direction", "canal", "debutLe", "dureeSecondes", "numero", "nomSurTelephone",
            "transcription", "sourceTranscription", "moteurTranscription", "appareil", "idSource"),
        "textMessages" to listOf("apercu", "texte", "sens", "canal", "envoyeLe", "numero", "nomSurTelephone",
            "appareil", "idSource"),
    )
    val CHAMPS_TRANSCRIPTION = listOf("sourceTranscription", "moteurTranscription")
    val PARIS: ZoneId = ZoneId.of("Europe/Paris")

    // ------------------------------------------------------------ outils « comme Python »

    /** `str.isspace()` de Python : espaces Unicode, insécables et séparateurs \x1c-\x1f compris. */
    fun pyEspace(c: Int): Boolean = Character.isWhitespace(c) || Character.isSpaceChar(c) || c == 0x85

    fun pyStrip(s: String): String {
        val cp = s.codePoints().toArray()
        var a = 0
        var b = cp.size
        while (a < b && pyEspace(cp[a])) a++
        while (b > a && pyEspace(cp[b - 1])) b--
        return String(cp, a, b - a)
    }

    private fun pyRstrip(s: String): String {
        val cp = s.codePoints().toArray()
        var b = cp.size
        while (b > 0 && pyEspace(cp[b - 1])) b--
        return String(cp, 0, b)
    }

    /** `str.split()` sans argument. */
    fun pySplit(s: String): List<String> {
        val mots = mutableListOf<String>()
        val courant = StringBuilder()
        s.codePoints().forEach { c ->
            if (pyEspace(c)) {
                if (courant.isNotEmpty()) { mots += courant.toString(); courant.setLength(0) }
            } else courant.appendCodePoint(c)
        }
        if (courant.isNotEmpty()) mots += courant.toString()
        return mots
    }

    /** `str(x)` de Python pour les valeurs qui passent ici. */
    fun pyStr(x: Any?): String = when (x) {
        null -> "None"
        is Boolean -> if (x) "True" else "False"
        is Double -> if (x == Math.floor(x) && !x.isInfinite()) "${x.toLong()}.0" else x.toString()
        else -> x.toString()
    }

    /** Vérité de Python : None, "", 0, False, [], {} sont faux. */
    fun pyVrai(x: Any?): Boolean = when (x) {
        null -> false
        is String -> x.isNotEmpty()
        is Boolean -> x
        is Number -> x.toDouble() != 0.0
        is Collection<*> -> x.isNotEmpty()
        is Map<*, *> -> x.isNotEmpty()
        else -> true
    }

    private fun pyIsdigit(s: String) = s.isNotEmpty() && s.codePoints().allMatch { Character.isDigit(it) }

    /** Format `{x:5.1f}` de Python : arrondi au plus proche pair sur la valeur binaire exacte (Java arrondit au-dessus). */
    fun pyFormat(x: Double, decimales: Int, largeur: Int = 0): String =
        BigDecimal(x).setScale(decimales, RoundingMode.HALF_EVEN).toPlainString().padStart(largeur)

    /** `round(x, n)` de Python. */
    fun pyRound(x: Double, n: Int): Double = BigDecimal(x).setScale(n, RoundingMode.HALF_EVEN).toDouble()

    fun sha256(texte: String): String =
        MessageDigest.getInstance("SHA-256").digest(texte.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    fun sha1(texte: String): String =
        MessageDigest.getInstance("SHA-1").digest(texte.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    // ------------------------------------------------------------ normalisation

    private fun sansSeparateurs(brut: String): String {
        val sortie = StringBuilder()
        brut.codePoints().forEach { c -> if (!pyEspace(c) && c != '.'.code && c != '-'.code && c != '('.code &&
            c != ')'.code && c != '/'.code) sortie.appendCodePoint(c) }
        return sortie.toString()
    }

    /** E.164 pour un numéro de téléphone, null pour un code court, un nom (« CIC ») ou un numéro masqué. */
    fun normaliserNumero(brut: Any?): String? {
        if (brut == null) return null
        var texte = sansSeparateurs(pyStr(brut))
        if (texte.startsWith("00")) texte = "+" + texte.substring(2)
        if (texte.startsWith("+")) {
            var chiffres = texte.substring(1)
            if (pyIsdigit(chiffres) && chiffres.length in 8..15) {
                if (chiffres.startsWith("330") && chiffres.length == 12) chiffres = "33" + chiffres.substring(3)
                if (chiffres.startsWith("3333") && chiffres.length == 13) chiffres = chiffres.substring(2)
                return "+$chiffres"
            }
            return null
        }
        if (pyIsdigit(texte) && texte.length == 10 && texte.startsWith("0")) return "+33" + texte.substring(1)
        return null
    }

    fun numerosPersonne(personne: Map<String, Any?>): Set<String> {
        @Suppress("UNCHECKED_CAST")
        val phones = (personne["phones"] as? Map<String, Any?>) ?: emptyMap()
        val entrees = mutableListOf(phones["primaryPhoneNumber"] to phones["primaryPhoneCallingCode"])
        @Suppress("UNCHECKED_CAST")
        for (autre in (phones["additionalPhones"] as? List<Map<String, Any?>>) ?: emptyList()) {
            entrees += autre["number"] to autre["callingCode"]
        }
        val numeros = linkedSetOf<String>()
        for ((numeroBrut, indicatif) in entrees) {
            if (!pyVrai(numeroBrut)) continue
            val numero = sansSeparateurs(pyStr(numeroBrut))
            val e164 = if (numero.startsWith("+") || numero.startsWith("00") || !pyVrai(indicatif)) normaliserNumero(numero)
            else normaliserNumero(pyStr(indicatif) + numero.trimStart('0'))
            if (e164 != null) numeros += e164
        }
        return numeros
    }

    /** {E.164: id} ; un numéro porté par deux personnes est mis à part, jamais attribué au hasard. */
    fun indexTelephones(personnes: List<Map<String, Any?>>): Pair<Map<String, String>, Set<String>> {
        val index = LinkedHashMap<String, String>()
        val ambigus = linkedSetOf<String>()
        for (personne in personnes) {
            val id = personne["id"] as String
            for (numero in numerosPersonne(personne)) {
                if (numero in index && index[numero] != id) ambigus += numero
                index.putIfAbsent(numero, id)
            }
        }
        ambigus.forEach { index.remove(it) }
        return index to ambigus
    }

    private val ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss")

    /** `datetime.fromtimestamp(ms / 1000, utc).isoformat()` avec « Z » : microsecondes seulement si non nulles. */
    fun isoUtc(millisecondes: Long): String {
        val instant = Instant.ofEpochMilli(millisecondes)
        val base = ISO.format(instant.atZone(ZoneId.of("UTC")))
        val ms = Math.floorMod(millisecondes, 1000L)
        return if (ms == 0L) "${base}Z" else "$base.${"%06d".format(ms * 1000)}Z"
    }

    fun empreinte(vararg morceaux: Any?): String = sha1(morceaux.joinToString("\u001f") { pyStr(it) }).substring(0, 12)

    fun cleNumero(brut: Any?): String = normaliserNumero(brut) ?: (if (pyVrai(brut)) pyStrip(pyStr(brut)) else "masque")

    fun dureeLisible(secondes: Int): String = when {
        secondes < 60 -> "$secondes s"
        secondes < 3600 -> "${secondes / 60} min ${"%02d".format(secondes % 60)} s"
        else -> "${secondes / 3600} h ${"%02d".format(secondes % 3600 / 60)} min"
    }

    fun titreAppel(direction: String, duree: Int): String {
        val libelle = LIBELLES_DIRECTION[direction] ?: "Appel"
        if (direction == "SORTANT" && duree == 0) return "$libelle · sans réponse"
        if (direction in setOf("MANQUE", "REJETE", "BLOQUE") || duree == 0) return libelle
        return "$libelle · ${dureeLisible(duree)}"
    }

    fun titreAncien(direction: String?, duree: Int): String {
        val libelle = LIBELLES_DIRECTION[direction] ?: "Appel"
        if (direction in setOf("MANQUE", "REJETE", "BLOQUE") || duree == 0) return libelle
        return "$libelle · ${dureeLisible(duree)}"
    }

    fun apercuMessage(sens: String, texte: String?, longueur: Int = 90): String {
        var ligne = pySplit(texte ?: "").joinToString(" ")
        val points = ligne.codePoints().toArray()
        if (points.size > longueur) ligne = pyRstrip(String(points, 0, longueur - 1)) + "…"
        val libelle = LIBELLES_SENS[sens] ?: "SMS"
        return if (ligne.isNotEmpty()) "$libelle · $ligne" else libelle
    }

    private fun numeroAffiche(numero: Any?, e164: String?): String = e164 ?: (if (pyVrai(numero)) pyStrip(pyStr(numero)) else "")

    fun appel(millisecondes: Long, numero: Any?, duree: Int?, typeAndroid: Any?, nom: String?, appareil: String): Enregistrement {
        val direction = TYPES_APPEL[pyStr(typeAndroid)] ?: "AUTRE"
        val d = duree ?: 0
        val e164 = normaliserNumero(numero)
        return linkedMapOf(
            "idSource" to "appel:$millisecondes:${cleNumero(numero)}",
            "titre" to titreAppel(direction, d),
            "direction" to direction,
            "canal" to "TELEPHONE",
            "debutLe" to isoUtc(millisecondes),
            "dureeSecondes" to d,
            "numero" to numeroAffiche(numero, e164),
            "nomSurTelephone" to pyStrip(nom ?: ""),
            "appareil" to appareil,
            "_e164" to e164,
            "_ms" to millisecondes,
        )
    }

    fun messageVocal(millisecondes: Long, numero: Any?, duree: Int?, appareil: String, transcription: String = "",
                     sourceTranscription: String? = null, moteur: String? = null): Enregistrement {
        val vocal = appel(millisecondes, numero, duree, "4", "", appareil)
        vocal["idSource"] = "messagerie:$millisecondes:${cleNumero(numero)}"
        if (transcription.isNotEmpty()) {
            vocal["transcription"] = transcription
            if (!sourceTranscription.isNullOrEmpty()) vocal["sourceTranscription"] = sourceTranscription
            if (!moteur.isNullOrEmpty()) vocal["moteurTranscription"] = moteur
        }
        return vocal
    }

    fun message(millisecondes: Long, numero: Any?, typeAndroid: Any?, texte: String?, nom: String?, appareil: String,
                canal: String = "SMS", sens: String? = null): Enregistrement {
        val s = if (!sens.isNullOrEmpty()) sens else TYPES_SMS[pyStr(typeAndroid)] ?: "RECU"
        val t = texte ?: ""
        val e164 = normaliserNumero(numero)
        return linkedMapOf(
            "idSource" to "${canal.lowercase()}:$millisecondes:${cleNumero(numero)}:$s:${empreinte(t)}",
            "apercu" to apercuMessage(s, t),
            "texte" to t,
            "sens" to s,
            "canal" to canal,
            "envoyeLe" to isoUtc(millisecondes),
            "numero" to numeroAffiche(numero, e164),
            "nomSurTelephone" to pyStrip(nom ?: ""),
            "appareil" to appareil,
            "_e164" to e164,
        )
    }

    // ------------------------------------------------------------ sources

    private val LIGNE = Regex("Row: \\d+ (.*)$")

    /** Lignes « Row: N k=v, k=v » de `content query`, la dernière clé absorbant virgules et retours à la ligne. */
    fun parserContentQuery(sortie: String, cles: List<String>): List<MutableMap<String, String?>> {
        val lignes = mutableListOf<MutableMap<String, String?>>()
        for (ligne in splitlines(sortie)) {
            val m = LIGNE.find(ligne)?.takeIf { it.range.first == 0 }
            if (m == null) {
                if (lignes.isNotEmpty() && lignes.last()[cles.last()] != null && !ligne.startsWith("Row: ")) {
                    lignes.last()[cles.last()] = lignes.last()[cles.last()] + "\n" + ligne
                }
                continue
            }
            var reste = m.groupValues[1]
            val valeurs = LinkedHashMap<String, String>()
            for ((i, cle) in cles.withIndex()) {
                if (!reste.startsWith("$cle=")) break
                reste = reste.substring(cle.length + 1)
                if (i + 1 < cles.size) {
                    val fin = reste.indexOf(", ${cles[i + 1]}=")
                    if (fin < 0) break
                    valeurs[cle] = reste.substring(0, fin)
                    reste = reste.substring(fin + 2)
                } else valeurs[cle] = reste
            }
            if (valeurs.size == cles.size) lignes += valeurs.mapValuesTo(LinkedHashMap()) { (_, v) -> if (v == "NULL") null else v }
        }
        return lignes
    }

    /** `str.splitlines()` : \n, \r\n, \r et les séparateurs Unicode de ligne. */
    fun splitlines(texte: String): List<String> {
        val lignes = mutableListOf<String>()
        val courant = StringBuilder()
        var i = 0
        while (i < texte.length) {
            val c = texte[i]
            when (c) {
                '\r' -> { lignes += courant.toString(); courant.setLength(0); if (i + 1 < texte.length && texte[i + 1] == '\n') i++ }
                '\n', '\u000b', '\u000c', '\u001c', '\u001d', '\u001e', '\u0085', ' ', ' ' -> {
                    lignes += courant.toString(); courant.setLength(0)
                }
                else -> courant.append(c)
            }
            i++
        }
        if (courant.isNotEmpty()) lignes += courant.toString()
        return lignes
    }

    data class EnregistrementAudio(val debutMs: Long, val direction: String, val chemin: String, val transcription: String)

    private val NOM_JEMREC = Regex("(\\d{8})_(\\d{6})_(in|out)")
    private val FORMAT_NOM = DateTimeFormatter.ofPattern("yyyyMMddHHmmss")

    /** Début (ms) et direction d'un nom JemRec « AAAAMMJJ_HHMMSS_in|out », heure de Paris ; null sinon. */
    fun lireNomJemrec(stem: String): Pair<Long, String>? {
        val m = NOM_JEMREC.matchEntire(stem) ?: return null
        val local = LocalDateTime.parse(m.groupValues[1] + m.groupValues[2], FORMAT_NOM)
        val debut = ZonedDateTime.ofLocal(local, PARIS, null).toInstant().toEpochMilli()
        return debut to (if (m.groupValues[3] == "in") "ENTRANT" else "SORTANT")
    }

    /** Pose `_fichiers` (enregistrement) et `transcription` sur l'appel du même sens le plus proche. */
    /** Comme `associer_enregistrements` : l'appel du même sens le plus proche, puis, pour un fichier resté seul,
     *  l'appel décroché (durée > 0) le plus proche quel que soit son sens (le sens du nom n'est qu'un indice). */
    fun associerEnregistrements(appels: List<Enregistrement>, enregistrements: List<EnregistrementAudio>): List<String> {
        fun proches(e: EnregistrementAudio, filtre: (Enregistrement) -> Boolean) = appels.filter { filtre(it) &&
            Math.abs((it["_ms"] as Long) - e.debutMs) <= TOLERANCE_ENREGISTREMENT_S * 1000L && "_fichiers" !in it }
        fun poser(choisi: Enregistrement, e: EnregistrementAudio) {
            choisi["_fichiers"] = mapOf("enregistrement" to listOf(e.chemin))
            if (e.transcription.isNotEmpty()) choisi["transcription"] = e.transcription
        }
        val restants = mutableListOf<EnregistrementAudio>()
        for (e in enregistrements) {
            val candidats = proches(e) { it["direction"] == e.direction }
            if (candidats.isEmpty()) { restants += e; continue }
            poser(candidats.minBy { Math.abs((it["_ms"] as Long) - e.debutMs) }, e)
        }
        val orphelins = mutableListOf<String>()
        for (e in restants) {
            val candidats = proches(e) { ((it["dureeSecondes"] as Number?)?.toLong() ?: 0L) > 0L }
            if (candidats.isEmpty()) { orphelins += e.chemin.substringAfterLast('/'); continue }
            poser(candidats.minBy { Math.abs((it["_ms"] as Long) - e.debutMs) }, e)
        }
        return orphelins
    }

    // ------------------------------------------------------------ plan

    fun vide(valeur: Any?): Boolean = when (valeur) {
        null -> true
        is String -> valeur.isEmpty()
        is Collection<*> -> valeur.isEmpty()
        is Map<*, *> -> valeur.isEmpty() || valeur.values.none { pyVrai(it) }
        else -> false
    }

    private fun texte(x: Any?): String = (x as? String) ?: if (pyVrai(x)) pyStr(x) else ""

    /** Même numéro, même seconde, même sens (et même texte pour un SMS) : le même événement, quelle que soit la source. */
    fun cleSeconde(pluriel: String, e: Map<String, Any?>): List<Any?> =
        if (pluriel == "appels") listOf(e["numero"], texte(e["debutLe"]).take(19), e["direction"])
        else listOf(e["numero"], texte(e["envoyeLe"]).take(19), e["sens"], empreinte(texte(e["texte"])))

    data class Creation(val corps: Map<String, Any?>, val fichiers: Map<String, List<String>>?)
    /** `idSource` : celui du voulu (pour savoir quel élément de la file est concerné), hors du contrat Python. */
    data class Complement(val id: String, val champs: Map<String, Any?>, val fichiers: Map<String, List<String>>?, val idSource: String = "")
    data class Plan(val creations: List<Creation>, val complements: List<Complement>, val sansPersonne: Int)

    /** Créations et compléments. Un champ déjà rempli dans le CRM n'est jamais réécrit. */
    @Suppress("UNCHECKED_CAST")
    fun planifier(pluriel: String, voulus: List<Map<String, Any?>>, existants: List<Map<String, Any?>>,
                  index: Map<String, String>): Plan {
        val parSource = HashMap<Any?, Map<String, Any?>>()
        existants.forEach { if (pyVrai(it["idSource"])) parSource[it["idSource"]] = it }
        val parSeconde = HashMap<List<Any?>, Map<String, Any?>>()
        existants.forEach { parSeconde[cleSeconde(pluriel, it)] = it }
        val creations = mutableListOf<Creation>()
        val complements = mutableListOf<Complement>()
        var sansPersonne = 0
        val champsDuType = CHAMPS.getValue(pluriel)
        for (voulu in voulus) {
            val e164 = voulu["_e164"] as String?
            val personne = if (!e164.isNullOrEmpty()) index[e164] else null
            if (personne == null) sansPersonne++
            val existant = parSource[voulu["idSource"]] ?: parSeconde[cleSeconde(pluriel, voulu)]
            val fichiersVoulus = voulu["_fichiers"] as Map<String, List<String>>?
            if (existant == null) {
                val corps = LinkedHashMap<String, Any?>()
                champsDuType.forEach { if (it in voulu) corps[it] = voulu[it] }
                if (personne != null) corps["personId"] = personne
                creations += Creation(corps, fichiersVoulus)
                continue
            }
            val champs = LinkedHashMap<String, Any?>()
            champsDuType.forEach { if (it in voulu && !vide(voulu[it]) && vide(existant[it])) champs[it] = voulu[it] }
            for ((k, anciennesBrutes) in (voulu["_remplace"] as Map<String, Any?>?) ?: emptyMap()) {
                val liste = if (anciennesBrutes is String) listOf(anciennesBrutes) else (anciennesBrutes as List<String?>)
                val anciennes = liste.map { pyStrip(it ?: "") }.toSet()
                val actuelle = pyStrip(texte(existant[k]))
                val v = voulu[k]
                if (k in voulu && !vide(v) && actuelle in anciennes && actuelle != pyStrip(v as String)) {
                    champs[k] = v
                    if (k == "transcription") CHAMPS_TRANSCRIPTION.forEach { m -> if (pyVrai(voulu[m])) champs[m] = voulu[m] }
                }
            }
            val transcriptionVoulue = voulu["transcription"] as String?
            if (pluriel == "appels" && "transcription" !in champs && pyVrai(transcriptionVoulue) &&
                pyStrip(texte(existant["transcription"])) == pyStrip(transcriptionVoulue!!)) {
                // le CRM porte déjà exactement la nôtre : source et moteur peuvent la rejoindre
            } else if (pluriel == "appels" && "transcription" !in champs) {
                CHAMPS_TRANSCRIPTION.forEach { champs.remove(it) }
            }
            if (pluriel == "appels" && existant["titre"] != voulu["titre"] &&
                existant["titre"] == titreAncien(voulu["direction"] as String?, (voulu["dureeSecondes"] as Number).toInt())) {
                champs["titre"] = voulu["titre"]
            }
            if (personne != null && vide(existant["personId"])) champs["personId"] = personne
            val fichiers = fichiersVoulus?.filterKeys { vide(existant[it]) }?.takeIf { it.isNotEmpty() }
            if (champs.isNotEmpty() || fichiers != null) complements += Complement(existant["id"] as String, champs, fichiers, voulu["idSource"] as String)
        }
        return Plan(creations, complements, sansPersonne)
    }

    /** Moment de l'événement sur le téléphone (fin de l'appel, envoi du message), en secondes depuis l'époque. */
    fun dateEvenement(e: Map<String, Any?>): Double? {
        val texte = (e["debutLe"] as String?)?.takeIf { it.isNotEmpty() } ?: (e["envoyeLe"] as String?)?.takeIf { it.isNotEmpty() }
            ?: return null
        val moment = Instant.parse(texte).toEpochMilli() / 1000.0
        return moment + ((e["dureeSecondes"] as Number?)?.toDouble() ?: 0.0)
    }

    private val FORMAT_VOCAL = DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")

    /** « 20261112_093015_messagerie » : heure locale (Paris), comme les noms JemRec. */
    fun nomVocal(millisecondes: Long): String =
        FORMAT_VOCAL.format(Instant.ofEpochMilli(millisecondes).atZone(PARIS)) + "_messagerie"
}
