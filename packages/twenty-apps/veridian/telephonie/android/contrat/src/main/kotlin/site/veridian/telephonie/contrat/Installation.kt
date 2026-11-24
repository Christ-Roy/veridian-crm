package site.veridian.telephonie.contrat

/**
 * Les objets Appels et SMS dans le CRM du client, sans technicien (Robert, 24/11/2026 : « des app à activer nativement
 * dans le crm »). L'app les sonde ; s'ils manquent, elle demande l'activation native, avec le jeton OAuth du membre :
 * `triggerInstallApplication(input: {universalIdentifier})` sur `/metadata`, puis le suivi du travail.
 *
 * Mesuré sur le staging le 24/11/2026 (Twenty 2.56.1), tout en HTTP 200 :
 *  - accepté : `{data: {triggerInstallApplication: {jobId}}}`, AVANT toute garde : le travail dit la suite ;
 *  - garde de l'instance : le travail passe à FAILED, `failedReason` « … is not allowed on workspace … » (5 s plus tard) ;
 *  - membre sans la permission APPLICATIONS : `FORBIDDEN`, subCode `PERMISSION_DENIED` ;
 *  - app inconnue de l'instance : `NOT_FOUND` ; Twenty sans cette mutation : `GRAPHQL_VALIDATION_FAILED`.
 *
 * Tout ce qui décide est ici, sans Android : la file n'envoie rien tant que les objets manquent (`retient`), et rien
 * n'en sort. App inconnue de l'instance, ou clé API : rien n'est retenu, c'est le comportement d'avant.
 */
object Installation {
    const val CHEMIN = "/metadata"
    /** Le plugin Téléphonie (`src/identifiants.ts`, jamais changé). */
    const val APPLICATION = "e3df4b02-559e-4624-b985-3fd49cfd1725"
    const val DECLENCHER = "mutation TriggerInstallApplication(\$input: TriggerInstallApplicationInput!) " +
        "{ triggerInstallApplication(input: \$input) { jobId } }"
    const val SUIVRE = "query(\$app: String!, \$travail: String) " +
        "{ findInstallApplicationJobStatus(universalIdentifier: \$app, jobId: \$travail) { state failedReason } }"
    val OBJETS = listOf("appels", "textMessages")

    enum class Presence { PRESENT, ABSENT, INCONNU }

    /** Ce que le CRM a répondu à la demande, ou au suivi du travail. */
    enum class Reponse { INSTALLEE, EN_COURS, NON_PROPOSEE, INTERDIT, NON_SERVIE, ECHEC, A_RETENTER }

    /** `travail` : l'identifiant à suivre, quand la demande est acceptée. */
    data class Demande(val reponse: Reponse, val travail: String? = null)

    enum class Etat { INCONNU, PRET, INSTALLATION, NON_PROPOSE, REFUSE, NON_GERE, A_RETENTER }

    private val OBJET_ABSENT = Regex("object '(\\w+)' not found", RegexOption.IGNORE_CASE)
    /** Le corps arrive en JSON : les guillemets autour du champ y sont échappés. */
    private val CHAMP_ABSENT = Regex("Object (\\w+) doesn't have any \\\\?\"\\w+\\\\?\" field")
    private val SINGULIERS = listOf("appel", "textMessage")
    private val ERREURS = Regex("\"errors\"\\s*:\\s*\\[\\s*\\{")
    private val TRAVAIL = Regex("\"jobId\"\\s*:\\s*\"([^\"]+)\"")
    private val ETAT_TRAVAIL = Regex("\"state\"\\s*:\\s*\"([A-Z_]+)\"")
    /** La garde d'installation de l'instance (VER-173), dans le message de l'erreur ou du travail. */
    private const val PAS_PROPOSEE = "is not allowed on workspace"

    /**
     * L'objet, ou l'un des champs que l'app écrit, n'existe pas dans cet espace. Relevé sur le staging le 24/11/2026 : 400
     * « object 'appels' not found. eg: companies », puis, champs pas encore tous créés, 400 « Object appel doesn't have
     * any "titre" field » : Twenty rend l'objet lisible avant tous ses champs (migrations différées).
     */
    fun modeleAbsent(code: Int?, corps: String): Boolean = code == 400 &&
        (OBJET_ABSENT.find(corps)?.groupValues?.get(1) in OBJETS || CHAMP_ABSENT.find(corps)?.groupValues?.get(1) in SINGULIERS)

    /** La sonde d'un objet : une lecture filtrée sur chaque champ écrit et sur la relation vers la Personne. Sans donnée. */
    fun cheminSonde(objet: String): String {
        val filtre = (Contrat.CHAMPS.getValue(objet) + "personId").joinToString(",", "and(", ")") { "$it[is]:NULL" }
        return "/rest/$objet?limit=1&depth=0&filter=" + java.net.URLEncoder.encode(filtre, "UTF-8")
    }

    /** Lecture d'une sonde. Un 403 prouve que l'objet existe : c'est le droit qui manque. */
    fun presence(code: Int, corps: String): Presence = when {
        code in 200..299 || code == 403 -> Presence.PRESENT
        modeleAbsent(code, corps) -> Presence.ABSENT
        else -> Presence.INCONNU
    }

    /** Les deux objets : un seul manque, et l'espace n'est pas prêt. */
    fun ensemble(presences: List<Presence>): Presence = when {
        Presence.ABSENT in presences -> Presence.ABSENT
        presences.isNotEmpty() && presences.all { it == Presence.PRESENT } -> Presence.PRESENT
        else -> Presence.INCONNU
    }

    private fun codeErreur(code: String, corps: String) = Regex("\"code\"\\s*:\\s*\"$code\"").containsMatchIn(corps)

    /** Une réponse qui n'est pas un succès de GraphQL, ou null si elle en est un. */
    private fun refus(code: Int, corps: String): Reponse? = when {
        code == 403 -> Reponse.INTERDIT
        code == 404 -> Reponse.NON_SERVIE
        code !in 200..299 -> Reponse.A_RETENTER
        !ERREURS.containsMatchIn(corps) -> null
        PAS_PROPOSEE in corps -> Reponse.NON_PROPOSEE
        codeErreur("FORBIDDEN", corps) -> Reponse.INTERDIT
        codeErreur("NOT_FOUND", corps) || codeErreur("GRAPHQL_VALIDATION_FAILED", corps) -> Reponse.NON_SERVIE
        else -> Reponse.A_RETENTER  // UNAUTHENTICATED (la sonde, juste avant, renouvelle le jeton), désinstallation en cours, panne
    }

    /** Réponse à `DECLENCHER`. Accepter n'est pas installer : seul le travail le dit. */
    fun lireDemande(code: Int, corps: String): Demande {
        refus(code, corps)?.let { return Demande(it) }
        val travail = TRAVAIL.find(corps)?.groupValues?.get(1) ?: return Demande(Reponse.A_RETENTER)
        return Demande(Reponse.EN_COURS, travail)
    }

    /** Réponse à `SUIVRE`. Un travail que le CRM ne connaît plus est à redemander. */
    fun lireTravail(code: Int, corps: String): Reponse {
        refus(code, corps)?.let { return it }
        return when (ETAT_TRAVAIL.find(corps)?.groupValues?.get(1)) {
            "COMPLETED" -> Reponse.INSTALLEE
            "FAILED" -> if (PAS_PROPOSEE in corps) Reponse.NON_PROPOSEE else Reponse.ECHEC
            null -> Reponse.A_RETENTER
            else -> Reponse.EN_COURS
        }
    }

    /** `retient` : la file garde tout et n'envoie rien. `reessayerMs` : prochain passage, null s'il n'y a rien à attendre. */
    data class Decision(val etat: Etat, val retient: Boolean, val reessayerMs: Long?)

    private val ATTENTES_S = longArrayOf(2, 3, 5, 8, 13, 20, 30)

    /** Attente entre deux passages pendant l'installation : de 2 s à 60 s. */
    fun attenteMs(passage: Int): Long = (ATTENTES_S.getOrNull(passage) ?: 60L) * 1000

    /** Attente après un essai non abouti : de 30 s à 10 min. */
    fun repriseMs(passage: Int): Long = minOf(600_000L, 30_000L shl minOf(passage, 5))

    /** Après une installation ratée : de 1 min à 1 h. */
    fun echecMs(passage: Int): Long = minOf(3_600_000L, 60_000L shl minOf(passage, 6))

    /** Les objets manquent et le CRM a répondu. `reessayerMs` : la sonde reprend, la demande n'est pas toujours refaite. */
    fun absents(reponse: Reponse, passage: Int): Decision = when (reponse) {
        Reponse.INSTALLEE, Reponse.EN_COURS -> Decision(Etat.INSTALLATION, true, attenteMs(passage))
        // L'activation peut venir d'un autre : la sonde, légère, reprend seule.
        Reponse.NON_PROPOSEE -> Decision(Etat.NON_PROPOSE, true, 1_800_000L)
        Reponse.INTERDIT -> Decision(Etat.REFUSE, true, 300_000L)
        Reponse.NON_SERVIE -> Decision(Etat.NON_GERE, false, null)
        Reponse.ECHEC -> Decision(Etat.A_RETENTER, true, echecMs(passage))
        Reponse.A_RETENTER -> Decision(Etat.A_RETENTER, true, repriseMs(passage))
    }

    /** Ce que l'écran et la notification disent, en français simple. Vide quand tout va bien. */
    fun message(etat: Etat, enFile: Int): String {
        val attente = when {
            enFile > 1 -> " $enFile appels et SMS attendent sur le téléphone, rien n'est perdu."
            enFile == 1 -> " 1 appel ou SMS attend sur le téléphone, rien n'est perdu."
            else -> " Rien n'est perdu."
        }
        return when (etat) {
            Etat.INSTALLATION -> "Votre CRM se prépare : les appels et SMS s'installent sur les fiches de vos contacts. " +
                "Cela prend une à deux minutes, l'envoi démarre tout seul ensuite.$attente"
            Etat.NON_PROPOSE -> "Téléphonie n'est pas encore proposé dans votre CRM. Demandez à Veridian de le proposer, " +
                "l'envoi démarrera tout seul.$attente"
            Etat.REFUSE -> "Un administrateur doit activer Téléphonie dans Paramètres > Applications. " +
                "Dès que c'est fait, l'envoi démarre tout seul.$attente"
            Etat.A_RETENTER -> "Votre CRM n'a pas répondu à la préparation des appels et SMS. Nouvel essai automatique.$attente"
            Etat.NON_GERE -> "L'app Téléphonie n'est pas installée dans ce CRM. Un administrateur doit l'ajouter une fois.$attente"
            Etat.INCONNU, Etat.PRET -> ""
        }
    }

    /**
     * La suite des passages. `sonde` : les objets existent-ils ? `declencher` : demande d'activation ; `suivre` : où en est
     * son travail. `peutDemander` : connexion OAuth d'un membre (une clé API au rôle Téléphone n'active rien).
     */
    class Installateur(private val sonde: () -> Presence, private val declencher: () -> Demande, private val suivre: (String) -> Reponse,
                       private val peutDemander: () -> Boolean) {
        @Volatile var decision = Decision(Etat.INCONNU, false, null)
            private set
        private var passage = 0
        private var derniere: Reponse? = null
        private var travail: String? = null
        private var vuAbsent = false

        /** Un passage. `forcer` (connexion, bouton Réessayer) : si les objets manquent, l'activation est redemandée tout de suite. */
        @Synchronized
        fun passer(forcer: Boolean = false): Decision {
            if (forcer) { passage = 0; derniere = null; travail = null }
            decision = suite()
            if (decision.etat == Etat.PRET) { passage = 0; derniere = null; travail = null; vuAbsent = false } else passage++
            return decision
        }

        private fun suite(): Decision {
            val avant = sonde()
            if (avant == Presence.PRESENT && !attendLaFin()) return PRET
            if (avant == Presence.ABSENT) vuAbsent = true
            // Réseau absent : on ne sait rien de neuf, ce qui était retenu le reste.
            if (avant == Presence.INCONNU) return Decision(if (decision.retient) decision.etat else Etat.INCONNU, decision.retient, repriseMs(passage))
            if (!peutDemander()) return if (avant == Presence.PRESENT) PRET else Decision(Etat.NON_GERE, false, null)
            val reponse = reponse()
            if (avant == Presence.PRESENT) return if (attendLaFin()) absents(reponse, passage) else PRET
            // Deuxième sonde : une installation déjà finie ouvre l'envoi tout de suite.
            return if (sonde() == Presence.PRESENT && !attendLaFin()) PRET else absents(reponse, passage)
        }

        private fun reponse(): Reponse {
            val enCours = travail
            val r = if (derniere == Reponse.EN_COURS && enCours != null) suivre(enCours)
                else if (aRedemander()) declencher().let { travail = it.travail; it.reponse } else derniere!!
            derniere = r
            return r
        }

        /** Objets apparus pendant une installation encore en cours : la relation vers la Personne peut manquer. Borné. */
        private fun attendLaFin() = vuAbsent && derniere == Reponse.EN_COURS && passage < PASSAGES_EN_COURS

        private fun aRedemander(): Boolean = when (derniere) {
            null, Reponse.A_RETENTER, Reponse.ECHEC, Reponse.EN_COURS, Reponse.NON_SERVIE -> true
            // Installée d'après le travail, mais objets pas encore lisibles (cache) : la sonde suffit, la demande un passage sur quatre.
            Reponse.INSTALLEE -> passage % 4 == 0
            // Refusée : la sonde verra l'activation faite par un autre ; la demande, une fois par heure ou toutes les 6 h.
            Reponse.INTERDIT, Reponse.NON_PROPOSEE -> passage % 12 == 0
        }

        private companion object {
            val PRET = Decision(Etat.PRET, false, null)
            const val PASSAGES_EN_COURS = 15
        }
    }
}

/**
 * Ce que devient un élément de la file après un plan écrit au CRM. Vu le 24/11/2026 : les refus comptaient comme des
 * vérifications ; un élément refusé trois fois (objets pas encore installés) sortait de la file aussitôt sa fiche
 * créée, donc avant que son enregistrement ou ses pièces jointes partent.
 */
enum class Suite {
    /** Le CRM porte tout : sort de la file. */ TERMINE,
    /** Un fichier est en cours d'envoi : reste en file jusqu'à ce qu'il soit porté. */ ATTEND_FICHIER,
    /** Fiche créée : replanifiée tout de suite (ses fichiers partent alors), compteur remis à zéro. */ REVERIFIE_A_NEUF,
    /** Fiche complétée : replanifiée, trois fois au plus. */ REVERIFIE,
    /** Un complément que le CRM ne garde pas : laissé, pour ne pas boucler. */ LAISSE;

    companion object {
        fun de(aFaire: Boolean, cree: Boolean, complete: Boolean, fichierEnAttente: Boolean, essais: Int): Suite = when {
            !aFaire -> TERMINE
            fichierEnAttente -> ATTEND_FICHIER
            cree -> REVERIFIE_A_NEUF
            complete && essais < 3 -> REVERIFIE
            else -> LAISSE
        }
    }
}

/** L'adresse du CRM, telle qu'un client la tape. */
object Adresse {
    const val DOMAINE_VERIDIAN = "crm.app.veridian.site"

    /** « monentreprise » → l'espace Veridian ; « monespace.twenty.com/… » → son origine https. */
    fun normaliser(saisie: String): String {
        val s = saisie.trim()
        val (schema, reste) = if ("://" in s) s.substringBefore("://").lowercase() to s.substringAfter("://") else "https" to s
        val hote = reste.substringBefore('/').substringBefore('?').substringBefore('#').trim().lowercase()
        val nomSeul = '.' !in hote && ':' !in hote && hote != "localhost" && hote.isNotEmpty()
        return "$schema://" + if (nomSeul) "$hote.$DOMAINE_VERIDIAN" else hote
    }
}
