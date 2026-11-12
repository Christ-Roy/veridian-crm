package site.veridian.telephonie.contrat

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

/**
 * Découpe et mise en forme de la transcription, portées de `telephone.py` : tronçons coupés au milieu d'un
 * silence (`troncons`), silences comme `ffmpeg silencedetect=noise=-35dB:d=0.3` sur du PCM 16 bits mono à
 * 16 kHz (`silences`), jetons Parakeet remis en lignes « [  0.0-  2.0] texte » (`lignesDepuisJetons`).
 */
object Decoupe {
    const val AUCUNE_PAROLE = "(aucune parole détectée)"

    /** Un jeton de Parakeet : début et fin en secondes, texte SentencePiece (« ▁ » = début de mot). */
    data class Jeton(val debut: Double, val fin: Double, val texte: String, val debutMot: Boolean)

    private const val FINS_DE_PHRASE = ".?!…"

    fun lignesDepuisJetons(jetons: List<Jeton>, decalage: Double = 0.0, phraseMinS: Double = 2.0, silenceS: Double = 1.2,
                           ligneMaxS: Double = 12.0, aPartirDe: Double? = null): List<String> {
        class Mot(val debut: Double, var fin: Double, var texte: String)
        var mots = mutableListOf<Mot>()
        for (j in jetons) {
            if (j.debutMot || mots.isEmpty()) mots += Mot(j.debut, j.fin, j.texte.replace("▁", ""))
            else { mots.last().fin = maxOf(mots.last().fin, j.fin); mots.last().texte += j.texte }
        }
        if (aPartirDe != null) mots = mots.filter { it.debut + decalage >= aPartirDe - 0.05 }.toMutableList()
        val lignes = mutableListOf<String>()
        var courante = mutableListOf<Mot>()
        for ((i, mot) in mots.withIndex()) {
            if (mot.texte.isEmpty()) continue
            courante += mot
            val suivant = if (i + 1 < mots.size) mots[i + 1].debut else null
            val duree = mot.fin - courante[0].debut
            val dernier = mot.texte.codePointBefore(mot.texte.length)
            if (suivant == null || (FINS_DE_PHRASE.codePoints().anyMatch { it == dernier } && duree >= phraseMinS) ||
                suivant - mot.fin > silenceS || duree >= ligneMaxS) {
                lignes += "[${Contrat.pyFormat(courante[0].debut + decalage, 1, 5)}-" +
                    "${Contrat.pyFormat(maxOf(mot.fin, courante[0].debut) + decalage, 1, 5)}] " +
                    courante.joinToString(" ") { it.texte }
                courante = mutableListOf()
            }
        }
        return lignes
    }

    /** [(début, fin)] d'environ `cible` secondes, coupés au milieu du silence le plus proche (à ±marge), sinon net. */
    fun troncons(duree: Double, silences: List<Pair<Double, Double>>, cible: Double = 90.0, marge: Double = 30.0): List<Pair<Double, Double>> {
        val coupes = mutableListOf(0.0)
        while (duree - coupes.last() > cible + marge / 2) {
            val voulu = coupes.last() + cible
            val milieux = silences.map { (a, b) -> (a + b) / 2 }.filter { voulu - marge <= it && it <= voulu + marge }
            coupes += if (milieux.isNotEmpty()) milieux.minBy { Math.abs(it - voulu) } else voulu
        }
        coupes += duree
        return coupes.zipWithNext().filter { (a, b) -> b - a > 0.05 }.map { (a, b) -> Contrat.pyRound(a, 2) to Contrat.pyRound(b, 2) }
    }

    /** Valeur imprimée par ffmpeg (`%.6g` de ts × base de temps, multiplication comme `av_q2d(tb) * ts`), relue par le Python. */
    private fun g6(x: Double): Double = if (x == 0.0) 0.0 else BigDecimal(x).round(MathContext(6, RoundingMode.HALF_EVEN)).toDouble()

    /**
     * `silencedetect=noise=-35dB:d=0.3` sur du PCM 16 bits mono : un échantillon est muet si |x| < 582
     * (0,01778 × 32767 tronqué, comme ffmpeg) ; le silence est noté dès 0,3 s de muets, de son premier
     * échantillon au premier échantillon parlé (ou à la fin du flux).
     */
    fun silences(pcm: ShortArray, taux: Int = 16_000, bruitDb: Double = -35.0, dureeS: Double = 0.3): List<Pair<Double, Double>> {
        val bruit = (Math.pow(10.0, bruitDb / 20) * Short.MAX_VALUE).toInt().toShort()
        val notifier = Math.round(dureeS * taux)
        val bornes = mutableListOf<Pair<Double, Double>>()
        var muets = 0L
        var debut: Long = Long.MIN_VALUE
        for (i in pcm.indices) {
            val x = pcm[i]
            if (x < bruit && x > -bruit) {
                if (debut == Long.MIN_VALUE) {
                    muets++
                    if (muets >= notifier) debut = i + 1 - notifier
                }
            } else {
                if (debut != Long.MIN_VALUE) bornes += maxOf(0.0, g6(debut * (1.0 / taux))) to g6(i * (1.0 / taux))
                muets = 0
                debut = Long.MIN_VALUE
            }
        }
        if (debut != Long.MIN_VALUE) bornes += maxOf(0.0, g6(debut * (1.0 / taux))) to g6(pcm.size * (1.0 / taux))
        return bornes
    }

    /** `{x:g}` de Python pour une durée de réglage (30 → « 30 », 7.5 → « 7.5 »). */
    fun g(x: Double): String = if (x == Math.floor(x)) x.toLong().toString() else BigDecimal(x).round(MathContext(6)).stripTrailingZeros().toPlainString()

    /** « parakeet-tdt-0.6b-v3-q8_0 » depuis « ggml-parakeet-tdt-0.6b-v3-q8_0.bin ». */
    fun idModele(moteur: String, nomFichier: String): String {
        val nom = nomFichier.removePrefix("ggml-").removeSuffix(".bin")
        return if (nom.startsWith(moteur)) nom else "$moteur-$nom"
    }

    /** Ce qui a produit une transcription, assez précis pour cibler et refaire celles-là. */
    fun recette(idModele: String, outil: String, tronconS: Double, chevauchementS: Double): String {
        val texte = "$idModele · $outil · tronçons ${g(tronconS)} s"
        return texte + if (chevauchementS != 0.0) " · chevauchement ${g(chevauchementS)} s" else ""
    }
}
