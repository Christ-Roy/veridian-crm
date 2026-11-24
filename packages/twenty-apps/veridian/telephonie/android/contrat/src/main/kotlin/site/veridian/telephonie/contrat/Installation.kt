package site.veridian.telephonie.contrat

/**
 * Les objets Appels et SMS dans le CRM du client, sans technicien (Robert, 24/11/2026). Après la connexion, l'app
 * demande au CRM de s'en assurer : `POST {CRM}/api/veridian/apps/telephonie/assurer`, jeton OAuth du membre.
 *
 * Contrat de la route : 200 {app, etat: installee|mise_a_jour|deja_installee|en_cours, version} ; 403
 * {error: "app_non_maison"} ; 401 ; 404 tant qu'elle n'est pas servie (Twenty d'ailleurs, serveur pas à jour).
 *
 * Tout ce qui décide est ici, sans Android : la file n'envoie rien tant que les objets manquent (`retient`), et rien
 * n'en sort. Sans la route (404) ou avec une clé API, rien n'est retenu : c'est le comportement d'avant.
 */
object Installation {
    const val CHEMIN = "/api/veridian/apps/telephonie/assurer"
    val OBJETS = listOf("appels", "textMessages")

    enum class Presence { PRESENT, ABSENT, INCONNU }

    /** Ce que la route a répondu. */
    enum class Reponse { INSTALLEE, EN_COURS, NON_MAISON, INTERDIT, NON_SERVIE, A_RETENTER }

    enum class Etat { INCONNU, PRET, INSTALLATION, NON_PROPOSE, REFUSE, NON_GERE, A_RETENTER }

    private val OBJET_ABSENT = Regex("object '(\\w+)' not found", RegexOption.IGNORE_CASE)
    /** Le corps arrive en JSON : les guillemets autour du champ y sont échappés. */
    private val CHAMP_ABSENT = Regex("Object (\\w+) doesn't have any \\\\?\"\\w+\\\\?\" field")
    private val SINGULIERS = listOf("appel", "textMessage")
    private val ETAT = Regex("\"etat\"\\s*:\\s*\"([a-z_]+)\"")

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

    fun lire(code: Int, corps: String): Reponse = when {
        code in 200..299 -> when (ETAT.find(corps)?.groupValues?.get(1)) {
            "installee", "mise_a_jour", "deja_installee" -> Reponse.INSTALLEE
            "en_cours" -> Reponse.EN_COURS
            else -> Reponse.A_RETENTER
        }
        code == 403 && "app_non_maison" in corps -> Reponse.NON_MAISON
        code == 401 || code == 403 -> Reponse.INTERDIT
        code == 404 -> Reponse.NON_SERVIE
        else -> Reponse.A_RETENTER
    }

    /** `retient` : la file garde tout et n'envoie rien. `reessayerMs` : prochain passage, null s'il n'y a rien à attendre. */
    data class Decision(val etat: Etat, val retient: Boolean, val reessayerMs: Long?)

    private val ATTENTES_S = longArrayOf(2, 3, 5, 8, 13, 20, 30)

    /** Attente entre deux passages pendant l'installation : de 2 s à 60 s. */
    fun attenteMs(passage: Int): Long = (ATTENTES_S.getOrNull(passage) ?: 60L) * 1000

    /** Attente après un essai non abouti : de 30 s à 10 min. */
    fun repriseMs(passage: Int): Long = minOf(600_000L, 30_000L shl minOf(passage, 5))

    /** Les objets manquent et la route a répondu. */
    fun absents(reponse: Reponse, passage: Int): Decision = when (reponse) {
        Reponse.INSTALLEE, Reponse.EN_COURS -> Decision(Etat.INSTALLATION, true, attenteMs(passage))
        Reponse.NON_MAISON -> Decision(Etat.NON_PROPOSE, true, 6 * 3_600_000L)
        Reponse.INTERDIT -> Decision(Etat.REFUSE, true, 1_800_000L)
        Reponse.NON_SERVIE -> Decision(Etat.NON_GERE, false, null)
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
            Etat.NON_PROPOSE -> "Les appels et SMS ne sont pas encore proposés dans votre CRM. Demandez à Veridian de les activer, " +
                "l'envoi démarrera tout seul.$attente"
            Etat.REFUSE -> "Votre compte n'a pas le droit d'ajouter les appels et SMS à ce CRM. Demandez à un administrateur de " +
                "l'espace de connecter l'app une fois avec son compte.$attente"
            Etat.A_RETENTER -> "Votre CRM n'a pas répondu à la préparation des appels et SMS. Nouvel essai automatique.$attente"
            Etat.NON_GERE -> "L'app Téléphonie n'est pas installée dans ce CRM. Un administrateur doit l'ajouter une fois.$attente"
            Etat.INCONNU, Etat.PRET -> ""
        }
    }

    /**
     * La suite des passages. `sonde` : les objets existent-ils ? `demander` : appel de la route. `peutDemander` : connexion
     * OAuth d'un membre (une clé API au rôle Téléphone ne peut rien installer).
     */
    class Installateur(private val sonde: () -> Presence, private val demander: () -> Reponse, private val peutDemander: () -> Boolean) {
        @Volatile var decision = Decision(Etat.INCONNU, false, null)
            private set
        private var passage = 0
        private var derniere: Reponse? = null
        private var vuAbsent = false

        /** Un passage. `forcer` (connexion, bouton Réessayer) : la route est appelée même si les objets sont là (mise à jour). */
        @Synchronized
        fun passer(forcer: Boolean = false): Decision {
            if (forcer) { passage = 0; derniere = null }
            decision = suite(forcer)
            if (decision.etat == Etat.PRET) { passage = 0; derniere = null; vuAbsent = false } else passage++
            return decision
        }

        private fun suite(forcer: Boolean): Decision {
            val avant = sonde()
            if (avant == Presence.PRESENT && !attendLaFin() && !forcer) return PRET
            if (avant == Presence.ABSENT) vuAbsent = true
            // Réseau absent : on ne sait rien de neuf, ce qui était retenu le reste.
            if (avant == Presence.INCONNU) return Decision(if (decision.retient) decision.etat else Etat.INCONNU, decision.retient, repriseMs(passage))
            if (!peutDemander()) return if (avant == Presence.PRESENT) PRET else Decision(Etat.NON_GERE, false, null)
            val reponse = if (aRedemander()) demander().also { derniere = it } else derniere!!
            if (avant == Presence.PRESENT) return if (attendLaFin()) absents(reponse, passage) else PRET
            // Deuxième sonde : une installation déjà finie ouvre l'envoi tout de suite.
            return if (sonde() == Presence.PRESENT && !attendLaFin()) PRET else absents(reponse, passage)
        }

        /** Objets apparus pendant une installation encore en cours : la relation vers la Personne peut manquer. Borné. */
        private fun attendLaFin() = vuAbsent && derniere == Reponse.EN_COURS && passage < PASSAGES_EN_COURS

        private fun aRedemander(): Boolean = when (derniere) {
            null, Reponse.A_RETENTER, Reponse.EN_COURS, Reponse.NON_MAISON, Reponse.INTERDIT, Reponse.NON_SERVIE -> true
            // Installée d'après la route, mais objets pas encore lisibles (cache) : la sonde suffit, la route un passage sur quatre.
            Reponse.INSTALLEE -> passage % 4 == 0
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
