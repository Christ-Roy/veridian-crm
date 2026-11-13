package site.veridian.telephonie.contrat

/**
 * Décisions de l'app sans Android, testées par le JDK seul (CI) : quand une transcription peut tourner, et quand un
 * appel décroché n'a pas d'enregistrement.
 */
object Politique {
    /** Seuils par défaut : un appel neuf part dès qu'il arrive, sauf sous 10 % débranché (Robert, 13/11/2026 : le
     *  seuil de 30 % retenait les appels du soir, batterie à 22 %, alors qu'un appel de 90 s coûte quelques secondes de
     *  calcul). Les reprises en masse (« en charge ») restent sur secteur et au-dessus de 30 %. */
    const val NEUF_MIN_PCT = 10
    const val EN_CHARGE_MIN_PCT = 30

    /** Pourquoi une demande attend, ou null si elle peut partir. */
    fun attente(mode: String, niveau: Int?, enCharge: Boolean, neufMinPct: Int = NEUF_MIN_PCT, enChargeMinPct: Int = EN_CHARGE_MIN_PCT): String? =
        when (mode) {
            // Niveau illisible : on ne bloque pas un appel neuf sur une mesure absente, la charge seule suffit à trancher.
            "neuf", "maintenant" -> if (enCharge || niveau == null || niveau >= neufMinPct) null
                else "batterie $niveau % débranché (sous $neufMinPct %) : reprise au branchement"
            else -> when {
                !enCharge -> "reprise d'anciennes transcriptions : attend le chargeur"
                niveau != null && niveau < enChargeMinPct -> "reprise d'anciennes transcriptions : attend $enChargeMinPct % en charge (batterie $niveau %)"
                else -> null
            }
        }

    fun permise(mode: String, niveau: Int?, enCharge: Boolean, neufMinPct: Int = NEUF_MIN_PCT, enChargeMinPct: Int = EN_CHARGE_MIN_PCT) =
        attente(mode, niveau, enCharge, neufMinPct, enChargeMinPct) == null

    /** Clé de l'état de batterie qui change une décision : un réveil n'a lieu que quand elle change (pas à chaque %). */
    fun cleBatterie(niveau: Int?, enCharge: Boolean, neufMinPct: Int = NEUF_MIN_PCT, enChargeMinPct: Int = EN_CHARGE_MIN_PCT) =
        "${enCharge}:${niveau == null || niveau >= neufMinPct}:${niveau == null || niveau >= enChargeMinPct}"

    /**
     * Un appel décroché (durée > 0) sans enregistrement qui commence à ±tolérance de lui : l'enregistreur n'a pas
     * tourné. `debutsEnregistrements` : débuts (ms) lus dans les noms des fichiers de JemRec, toutes directions (on
     * juge l'enregistreur, pas le rapprochement).
     */
    fun nonEnregistre(debutAppelMs: Long, dureeS: Long, debutsEnregistrements: List<Long>,
                      toleranceS: Int = Contrat.TOLERANCE_ENREGISTREMENT_S): Boolean =
        dureeS > 0 && debutsEnregistrements.none { Math.abs(it - debutAppelMs) <= toleranceS * 1000L }
}
