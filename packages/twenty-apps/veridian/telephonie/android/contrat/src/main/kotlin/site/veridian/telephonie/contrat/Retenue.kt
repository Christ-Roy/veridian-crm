package site.veridian.telephonie.contrat

/**
 * Vie privée (Robert, 25/11/2026) : ce qui vient d'un numéro inconnu du CRM reste sur le téléphone, rien n'est jeté. Dès que le
 * numéro apparaît sur une personne, l'app relit le téléphone et envoie tout (Base.oublierNumeros). Un numéro porté par deux
 * personnes est « inconnu » : l'index l'écarte, on ne rattache jamais au hasard.
 */
object Retenue {
    enum class Mode(val valeur: String, val libelle: String) {
        FICHE("fiche", "Les personnes du CRM, plus la ligne des appels inconnus"),
        RIEN("rien", "Seulement les personnes du CRM"),
        TOUT("tout", "Tout, même les inconnus");

        companion object { fun de(v: String?) = entries.firstOrNull { it.valeur == v } ?: FICHE }
    }

    /** Ce que la ligne d'un appel inconnu ne montre pas : ni nom, ni audio, ni texte, ni ce qui les décrit. */
    val CONTENU = setOf("nomSurTelephone", "transcription", "sourceTranscription", "moteurTranscription", "_fichiers", "_remplace")

    data class Tri(val envoyes: List<Map<String, Any?>>, val retenus: List<Map<String, Any?>>, val reduits: Int)

    fun connu(voulu: Map<String, Any?>, index: Map<String, String>): Boolean =
        (voulu["_e164"] as String?).let { !it.isNullOrEmpty() && index.containsKey(it) }

    fun trier(pluriel: String, voulus: List<Map<String, Any?>>, index: Map<String, String>, mode: Mode): Tri {
        if (mode == Mode.TOUT) return Tri(voulus, emptyList(), 0)
        val (connus, inconnus) = voulus.partition { connu(it, index) }
        if (mode == Mode.RIEN || pluriel != "appels") return Tri(connus, inconnus, 0)
        val lignes = inconnus.map { v -> v.filterKeys { it !in CONTENU } }
        return Tri(connus + lignes, emptyList(), lignes.size)
    }
}
