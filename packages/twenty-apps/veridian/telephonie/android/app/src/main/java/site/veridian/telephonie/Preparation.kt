package site.veridian.telephonie

import org.json.JSONException
import site.veridian.telephonie.contrat.Installation
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Les objets Appels et SMS existent-ils dans le CRM connecté ? Sinon, l'app demande leur activation native, attend
 * qu'ils se lisent, et retient l'envoi jusque-là. Toutes les décisions sont dans `contrat/Installation.kt` (testées
 * sans Android) ; ici, les requêtes, les délais et le journal. Un seul fil : deux passages ne se croisent jamais.
 *
 * Connexion par clé API (téléphone déjà configuré) : rien n'est demandé ni retenu.
 */
class Preparation(private val synchro: Synchro) {
    private val fil = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "preparation").apply { isDaemon = true } }
    private var prevu: ScheduledFuture<*>? = null
    @Volatile private var enCours = false
    private var forcePrevu = false
    @Volatile private var prochain = 0L
    @Volatile private var sansSuite = false

    private val installateur = Installation.Installateur(sonde = ::sonder, declencher = ::declencher, suivre = ::suivre,
        peutDemander = { synchro.reglages.acces == Reglages.ACCES_OAUTH })

    val etat get() = installateur.decision.etat
    /** Vrai : la file garde tout, aucun envoi. */
    val retient get() = installateur.decision.retient

    fun message(): String = Installation.message(etat, synchro.base.taille())

    /** Un passage tout de suite. `forcer` (connexion, bouton Réessayer) : l'activation manquante est redemandée tout de suite. */
    fun verifier(origine: String, forcer: Boolean = false) {
        if (!forcer && enCours) return
        programmer(origine, forcer, 0)
    }

    /** Le CRM vient de répondre que les objets n'existent pas (retirés après coup, ou jamais installés). */
    fun objetsAbsents() = if (etat == Installation.Etat.PRET) verifier("objets absents") else verifierSiDu("objets absents")

    /** Délai avant le prochain passage, pour le réveil par WorkManager. */
    fun dansMs(): Long = (prochain - System.currentTimeMillis()).coerceIn(60_000, 600_000)

    /** Un passage s'il est dû (ou si rien n'est prévu) ; sinon celui qui est prévu suffit. */
    fun verifierSiDu(origine: String) {
        if (System.currentTimeMillis() >= prochain) verifier(origine)
    }

    /** Fil de l'écran de connexion : rend la main quand le CRM est prêt, quand il n'y a plus rien à attendre, ou au délai. */
    fun attendre(delaiMs: Long) {
        val fin = System.currentTimeMillis() + delaiMs
        do {
            Thread.sleep(500)
            val attendu = enCours || etat == Installation.Etat.INCONNU || etat == Installation.Etat.INSTALLATION
        } while (attendu && !sansSuite && System.currentTimeMillis() < fin)
    }

    @Synchronized
    private fun programmer(origine: String, forcer: Boolean, delaiMs: Long) {
        prevu?.cancel(false)
        if (forcer) forcePrevu = true
        if (delaiMs == 0L) { enCours = true; sansSuite = false }
        prevu = fil.schedule({ passer(origine) }, delaiMs, TimeUnit.MILLISECONDS)
        prochain = System.currentTimeMillis() + delaiMs
    }

    private fun passer(origine: String) {
        val forcer = synchronized(this) { forcePrevu.also { forcePrevu = false } }
        val avant = installateur.decision
        var suivant: Long? = null
        try {
            if (synchro.twenty() == null) { sansSuite = true; return }
            val d = installateur.passer(forcer)
            suivant = d.reessayerMs
            if (d.etat != avant.etat) Journal.log("préparation du CRM : ${avant.etat} → ${d.etat} ($origine, ${synchro.base.taille()} en file)")
            if (d.etat == Installation.Etat.PRET && (avant.retient || avant.etat == Installation.Etat.NON_GERE)) synchro.crmPret()
        } catch (e: ReconnexionRequise) {
            sansSuite = true  // la reconnexion relance tout (Synchro.reconnecte)
        } catch (e: Exception) {
            Journal.erreur("préparation du CRM", e)
            suivant = Installation.repriseMs(0)
        } finally {
            synchronized(this) {
                // Un passage forcé demandé pendant celui-ci (bouton, reconnexion) est déjà en route : il n'est pas remplacé.
                if (!forcePrevu) {
                    enCours = false
                    prochain = Long.MAX_VALUE
                    if (suivant != null) programmer("suite", false, suivant)
                    // App inconnue de ce CRM ou clé API : relu par le filet (30 min), jamais à chaque refus.
                    else if (retient || etat == Installation.Etat.NON_GERE) prochain = System.currentTimeMillis() + 29 * 60_000L
                }
            }
        }
    }

    private fun sonder(): Installation.Presence {
        val tw = synchro.twenty() ?: return Installation.Presence.INCONNU
        return Installation.ensemble(Installation.OBJETS.map { objet ->
            try {
                tw.requete("GET", Installation.cheminSonde(objet))
                Installation.Presence.PRESENT
            } catch (e: Refus) { Installation.presence(e.code ?: 0, e.corps) } catch (e: NonAbouti) { Installation.Presence.INCONNU }
        })
    }

    /** GraphQL de Twenty : code et corps bruts (l'erreur est dans le corps, en HTTP 200). Deux essais par requête. */
    private fun metadata(requete: String, variables: Map<String, Any?>): Pair<Int, String> {
        val tw = Twenty(synchro.reglages.url ?: return 0 to "", synchro.acces, essais = 2)
        return try {
            200 to tw.requete("POST", Installation.CHEMIN, mapOf("query" to requete, "variables" to variables), refus401 = false).toString()
        } catch (e: Refus) { (e.code ?: 0) to e.corps } catch (e: NonAbouti) { 0 to ""
        } catch (e: JSONException) { 0 to "" }  // une page web à la place de l'API
    }

    private fun declencher(): Installation.Demande {
        val (code, corps) = metadata(Installation.DECLENCHER, mapOf("input" to mapOf("universalIdentifier" to Installation.APPLICATION)))
        return Installation.lireDemande(code, corps).also { Journal.log("préparation du CRM : activation demandée, ${it.reponse}") }
    }

    private fun suivre(travail: String): Installation.Reponse {
        val (code, corps) = metadata(Installation.SUIVRE, mapOf("app" to Installation.APPLICATION, "travail" to travail))
        return Installation.lireTravail(code, corps).also { if (it != Installation.Reponse.EN_COURS) Journal.log("préparation du CRM : activation $it") }
    }
}
