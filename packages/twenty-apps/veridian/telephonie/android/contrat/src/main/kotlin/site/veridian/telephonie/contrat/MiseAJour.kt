package site.veridian.telephonie.contrat

/**
 * Mise à jour de l'app à distance (Robert, 24/11/2026 : « il le faut »). Toutes les décisions sont ici, sans Android :
 * ce qu'un manifeste a le droit de dire, quand télécharger, quand installer, quand refuser. `MiseAJourApp` ne porte que
 * le réseau, le fichier et PackageInstaller.
 *
 * Le manifeste est un fichier public de la release GitHub du canal. Il n'a pas besoin d'être signé : l'APK l'est, et
 * Android comme l'app refusent un certificat différent du leur. Un manifeste faussé peut au pire retarder une mise à jour.
 * Le doute refuse ou attend, jamais n'installe.
 */
object MiseAJour {
    const val PAQUET = "site.veridian.telephonie"
    const val FORMAT = 1L
    private const val PUBLIC = "https://github.com/Christ-Roy/veridian-crm/releases/download/"

    /** `tag` : la release GitHub qui porte le canal. */
    enum class Canal(val valeur: String, val tag: String, val libelle: String) {
        STABLE("stable", "telephonie-android", "stable"),
        ESSAI("essai", "telephonie-android-essai", "d'essai");

        companion object {
            /** Toute valeur inconnue suit le canal stable. */
            fun de(valeur: String?) = entries.firstOrNull { it.valeur == valeur } ?: STABLE
        }
    }

    fun adresseManifeste(canal: Canal) = "$PUBLIC${canal.tag}/manifeste.json"
    fun adresseApk(canal: Canal, versionCode: Long) = "$PUBLIC${canal.tag}/telephonie-crm-$versionCode.apk"

    data class Manifeste(val canal: Canal, val versionCode: Long, val versionName: String, val taille: Long, val sha256: String,
                         val versionMinimale: Long, val pourcentage: Int, val minSdk: Int) {
        val url get() = adresseApk(canal, versionCode)
    }

    /** Une lecture : un manifeste complet, une suspension (coupe-circuit), ou rien d'utilisable. */
    sealed class Lecture {
        data class Bon(val m: Manifeste) : Lecture()
        data class Suspendu(val raison: String) : Lecture()
        data class Refuse(val raison: String) : Lecture()
    }

    const val TAILLE_MAX = 200_000_000L
    private val SHA256 = Regex("[0-9a-f]{64}")

    /** `j` : le JSON lu, entiers en Long. Le coupe-circuit se lit avant tout le reste : un manifeste réduit à lui suffit. */
    fun lire(j: Map<String, Any?>, canal: Canal): Lecture {
        fun refus(quoi: String) = Lecture.Refuse("manifeste refusé : $quoi")
        if (j["format"] != FORMAT) return refus("format inconnu (${j["format"]})")
        if (j["canal"] != canal.valeur) return refus("canal ${j["canal"]} au lieu de ${canal.valeur}")
        val suspendu = j["suspendu"] as? Boolean ?: return refus("suspendu absent")
        if (suspendu) return Lecture.Suspendu((j["raison"] as? String).orEmpty().take(200))
        val code = (j["versionCode"] as? Long)?.takeIf { it in 1..2_100_000_000L } ?: return refus("versionCode")
        val nom = (j["versionName"] as? String)?.takeIf { it.isNotBlank() && it.length <= 100 } ?: return refus("versionName")
        val taille = (j["taille"] as? Long)?.takeIf { it in 1..TAILLE_MAX } ?: return refus("taille")
        val sha = (j["sha256"] as? String)?.takeIf { SHA256.matches(it) } ?: return refus("sha256")
        if (j["url"] != adresseApk(canal, code)) return refus("adresse de l'APK")
        val minimale = (j["versionMinimale"] as? Long)?.takeIf { it in 0..code } ?: return refus("versionMinimale")
        val pourcentage = (j["pourcentage"] as? Long)?.takeIf { it in 0..100 } ?: return refus("pourcentage")
        val minSdk = (j["minSdk"] as? Long)?.takeIf { it in 1..1000 } ?: return refus("minSdk")
        return Lecture.Bon(Manifeste(canal, code, nom, taille, sha, minimale, pourcentage.toInt(), minSdk.toInt()))
    }

    // ------------------------------------------------------------ quand lire

    const val JOUR_MS = 24 * 3_600_000L
    /** Après une lecture ratée, pas de nouvel essai avant une heure. */
    const val ESSAI_MS = 3_600_000L
    /** Une session confiée à Android répond en quelques secondes ; au-delà, elle est tenue pour perdue. */
    const val REMISE_MS = 60_000L

    fun remiseEnCours(remiseMs: Long, maintenantMs: Long) = !ecoule(remiseMs, maintenantMs, REMISE_MS)

    /** L'accord demandé ne se redemande qu'un jour après, sauf si l'utilisateur vient d'autoriser (ou de retirer) l'installation. */
    fun gesteAttendu(demandeMs: Long, autoriseAlors: Boolean, autoriseMaintenant: Boolean, maintenantMs: Long) =
        autoriseAlors == autoriseMaintenant && !ecoule(demandeMs, maintenantMs, JOUR_MS)

    /** Avant d'installer, le manifeste doit avoir été relu depuis moins de 10 min : le coupe-circuit vaut jusqu'au bout. */
    const val FRAIS_MS = 600_000L

    /** Au plus une lecture réussie par jour. Horloge reculée (`lu` dans le futur) : on relit, on ne se bloque pas. */
    fun doitLire(luMs: Long, essaiMs: Long, maintenantMs: Long): Boolean =
        ecoule(luMs, maintenantMs, JOUR_MS) && ecoule(essaiMs, maintenantMs, ESSAI_MS)

    fun frais(luMs: Long, maintenantMs: Long) = !ecoule(luMs, maintenantMs, FRAIS_MS)

    private fun ecoule(avant: Long, maintenant: Long, delai: Long) = avant > maintenant || maintenant - avant >= delai

    // ------------------------------------------------------------ quand agir

    enum class Action { A_JOUR, ATTENDRE, REFUSER, TELECHARGER, INSTALLER }

    data class Decision(val action: Action, val raison: String)

    /**
     * `tranche` : 0 à 99, propre à l'appareil et stable (déploiement progressif). `occupe` : ce qui interdit d'interrompre
     * l'app. `fichierSha256` : empreinte du fichier déjà téléchargé ET vérifié. `echecs` : installations ratées de cette
     * empreinte. `gesteAttendu` : Android a demandé un accord il y a moins d'un jour. `remise` : une session vient d'être
     * confiée à Android, sa réponse n'est pas arrivée. `manuel` : bouton de l'écran.
     */
    data class Telephone(val versionCode: Long, val sdk: Int, val tranche: Int, val auto: Boolean, val nonLimite: Boolean,
                         val occupe: String?, val fichierSha256: String?, val echecs: Int = 0, val gesteAttendu: Boolean = false,
                         val remise: Boolean = false, val manuel: Boolean = false)

    const val ECHECS_MAX = 3

    fun decider(lecture: Lecture, t: Telephone): Decision {
        val m = when (lecture) {
            is Lecture.Refuse -> return Decision(Action.REFUSER, lecture.raison)
            is Lecture.Suspendu -> return Decision(Action.ATTENDRE, "mises à jour suspendues par l'éditeur" +
                if (lecture.raison.isBlank()) "" else " : ${lecture.raison}")
            is Lecture.Bon -> lecture.m
        }
        if (m.versionCode <= t.versionCode) return Decision(Action.A_JOUR, if (m.versionCode == t.versionCode) "à jour"
            else "à jour (version installée plus récente que celle du canal ${m.canal.libelle})")
        if (t.sdk < m.minSdk) return Decision(Action.REFUSER, "la version ${m.versionName} demande un Android plus récent")
        // Sous la version minimale, le déploiement progressif ne retient plus ; tout le reste (accord, réseau, appel) vaut.
        val obligatoire = t.versionCode < m.versionMinimale
        if (!t.auto && !t.manuel) return Decision(Action.ATTENDRE, "version ${m.versionName} disponible, mise à jour automatique coupée")
        if (!obligatoire && t.tranche >= m.pourcentage) return Decision(Action.ATTENDRE, "version ${m.versionName} en déploiement progressif (${m.pourcentage} %)")
        if (t.echecs >= ECHECS_MAX && !t.manuel) return Decision(Action.ATTENDRE, "version ${m.versionName} : ${t.echecs} essais ratés, touchez « Vérifier »")
        if (t.fichierSha256 != m.sha256) {
            if (!t.nonLimite) return Decision(Action.ATTENDRE, "version ${m.versionName} : attend le Wi-Fi ou un réseau non limité")
            if (t.occupe != null) return Decision(Action.ATTENDRE, "version ${m.versionName} : ${t.occupe}")
            return Decision(Action.TELECHARGER, "téléchargement de la version ${m.versionName}")
        }
        if (t.occupe != null) return Decision(Action.ATTENDRE, "version ${m.versionName} prête : ${t.occupe}")
        // Vu sur émulateur le 24/11 : deux événements à la même seconde remettaient deux sessions, la seconde annulait la première.
        if (t.remise) return Decision(Action.ATTENDRE, "version ${m.versionName} : installation en cours")
        if (t.gesteAttendu && !t.manuel) return Decision(Action.ATTENDRE, "version ${m.versionName} prête : Android attend votre accord (notification)")
        return Decision(Action.INSTALLER, "installation de la version ${m.versionName}")
    }

    /** 0 à 99, dérivé d'un nombre tiré au hasard sur l'appareil, qui n'en sort jamais. */
    fun tranche(graine: String): Int = (Contrat.sha1("tranche:$graine").take(8).toLong(16) % 100).toInt()

    // ------------------------------------------------------------ ne jamais interrompre

    /** L'enregistreur écrit son fichier dans les secondes qui suivent l'appel (contrôlé à 150 s par Enregistreur). */
    const val APRES_APPEL_MS = 180_000L
    const val FICHIER_VIVANT_MS = 60_000L
    /** Au-delà, un état « en cours » n'est que la trace d'un processus tué : il ne bloque plus. */
    const val TRANSCRIPTION_MAX_MS = 3 * 3_600_000L

    /**
     * Ce qui interdit de télécharger ou d'installer, ou null. `etatAppel` : 0 au repos (TelephonyManager), null si
     * illisible. `modeAudio` : 0 normal (AudioManager) ; tout autre mode est une sonnerie, un appel ou une visio.
     */
    fun occupation(etatAppel: Int?, modeAudio: Int, finAppelMs: Long, enregistrementEcritMs: Long, transcriptionEnCours: Boolean,
                   transcriptionEcriteMs: Long, maintenantMs: Long): String? = when {
        (etatAppel != null && etatAppel != 0) || modeAudio != 0 -> "un appel est en cours"
        maintenantMs - finAppelMs in 0 until APRES_APPEL_MS || maintenantMs - enregistrementEcritMs in 0 until FICHIER_VIVANT_MS ->
            "un enregistrement se termine"
        transcriptionEnCours && maintenantMs - transcriptionEcriteMs in 0 until TRANSCRIPTION_MAX_MS -> "une transcription est en cours"
        else -> null
    }

    // ------------------------------------------------------------ avant d'installer

    data class Paquet(val nom: String, val versionCode: Long, val certificats: Set<String>)

    /** Null si le fichier est celui du manifeste ; sinon pourquoi il ne l'est pas. */
    fun verifierFichier(m: Manifeste, taille: Long, sha256: String): String? = when {
        taille != m.taille -> "taille $taille au lieu de ${m.taille}"
        sha256 != m.sha256 -> "empreinte différente"
        else -> null
    }

    /** Null si l'APK peut remplacer l'app installée ; sinon pourquoi. Un certificat illisible est un refus. */
    fun verifierApk(m: Manifeste, apk: Paquet?, installe: Paquet): String? = when {
        apk == null -> "fichier illisible par Android"
        apk.nom != installe.nom || apk.nom != PAQUET -> "paquet ${apk.nom}"
        apk.certificats.isEmpty() || installe.certificats.isEmpty() -> "certificat illisible"
        apk.certificats != installe.certificats -> "certificat différent de celui de l'app installée"
        apk.versionCode != m.versionCode -> "versionCode ${apk.versionCode} au lieu de ${m.versionCode}"
        apk.versionCode <= installe.versionCode -> "version pas plus récente que l'installée"
        else -> null
    }
}
